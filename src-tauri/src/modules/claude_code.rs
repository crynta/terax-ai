// Bridge to locally installed agent CLIs (Claude Code, Codex): runs them in
// their non-interactive JSON-stream modes and forwards each stdout line to
// the webview as events, so the chat can use the user's local logins and
// subscriptions instead of API keys.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct ClaudeCodeState {
    procs: Mutex<HashMap<String, Child>>,
    resolved_bins: Mutex<HashMap<String, String>>,
}

impl ClaudeCodeState {
    /// App exit: agents must not keep editing files after Terax is gone.
    pub fn kill_all(&self) {
        for (_, mut child) in self.procs.lock().unwrap().drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum RunEvent {
    Line { line: String },
    Done { code: i32, stderr: String },
}

fn event_name(run_id: &str) -> String {
    format!("terax-cc-{run_id}")
}

fn bin_name(agent: &str) -> Result<&'static str, String> {
    match agent {
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        _ => Err(format!("unknown CLI agent {agent}")),
    }
}

/// CLI arguments per agent. The prompt always goes in via stdin — both CLIs
/// read it there ("-" for codex), which sidesteps arg-quoting entirely.
fn build_args(agent: &str, session_id: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match agent {
        "claude" => {
            args.extend(
                ["-p", "--output-format", "stream-json", "--verbose"]
                    .iter()
                    .map(|s| s.to_string()),
            );
            if let Some(sid) = session_id {
                args.push("--resume".into());
                args.push(sid.into());
            }
        }
        "codex" => {
            args.push("exec".into());
            if let Some(sid) = session_id {
                args.push("resume".into());
                args.push(sid.into());
            }
            args.extend(
                ["--json", "--skip-git-repo-check", "-"]
                    .iter()
                    .map(|s| s.to_string()),
            );
        }
        _ => {}
    }
    args
}

// GUI apps don't inherit the user's interactive PATH (nvm, homebrew, …), so
// ask their login shell where the binary lives. Cached after the first hit.
fn resolve_bin(state: &ClaudeCodeState, agent: &str) -> Result<String, String> {
    let bin = bin_name(agent)?;
    if let Some(path) = state.resolved_bins.lock().unwrap().get(agent).cloned() {
        return Ok(path);
    }

    #[cfg(unix)]
    let lookup = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        Command::new(shell)
            .args(["-lc", &format!("command -v {bin}")])
            .output()
    };
    #[cfg(windows)]
    let lookup = Command::new("where").arg(bin).output();

    let out = lookup.map_err(|e| format!("failed to look up {bin} CLI: {e}"))?;
    let path = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if path.is_empty() {
        return Err(format!(
            "{bin} CLI not found. Install it and sign in (`{bin}` in a terminal) first."
        ));
    }
    state
        .resolved_bins
        .lock()
        .unwrap()
        .insert(agent.to_string(), path.clone());
    Ok(path)
}

/// Spawns one non-interactive agent turn. Every stdout line is emitted as
/// `terax-cc-<run_id>`, followed by a final Done event.
///
/// async: the login-shell binary lookup and pipe plumbing must never touch
/// the main thread. Pipes are serviced by dedicated threads — stdin gets its
/// own writer, so a >64KB prompt can't deadlock against a child that starts
/// talking on stdout immediately (both CLIs do).
#[tauri::command]
pub async fn cli_agent_run(
    app: AppHandle,
    state: State<'_, ClaudeCodeState>,
    agent: String,
    run_id: String,
    prompt: String,
    session_id: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let bin = resolve_bin(&state, &agent)?;
    let args = build_args(&agent, session_id.as_deref().filter(|s| !s.is_empty()));

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        if std::path::Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {bin}: {e}"))?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take();

    // Register BEFORE any pipe work so cli_agent_kill can always find the
    // child, even while the prompt is still being written.
    state.procs.lock().unwrap().insert(run_id.clone(), child);

    if let Some(mut stdin) = stdin {
        std::thread::spawn(move || {
            // A failed write means the child died — the reader thread will
            // surface that via Done; nothing useful to do here.
            let _ = stdin.write_all(prompt.as_bytes());
            // Drop closes the pipe — both CLIs read the prompt until EOF.
        });
    }

    // stderr must be drained CONCURRENTLY with stdout: a child that fills
    // the stderr pipe while we sit in the stdout loop deadlocks otherwise.
    // Keep only a bounded tail while reading.
    let stderr_handle = stderr.map(|s| {
        std::thread::spawn(move || {
            let mut tail = String::new();
            for l in BufReader::new(s).lines().map_while(Result::ok) {
                tail.push_str(&l);
                tail.push('\n');
                if tail.len() > 4096 {
                    let mut cut = tail.len() - 2048;
                    while !tail.is_char_boundary(cut) {
                        cut += 1;
                    }
                    tail.drain(..cut);
                }
            }
            tail
        })
    });

    std::thread::spawn(move || {
        let event = event_name(&run_id);
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(l) => l,
                // One bad UTF-8 line must not silently truncate the whole
                // stream; real IO errors (broken pipe) end it.
                Err(e) if e.kind() == std::io::ErrorKind::InvalidData => continue,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit(&event, RunEvent::Line { line });
        }

        let stderr_tail = stderr_handle
            .and_then(|h| h.join().ok())
            .unwrap_or_default();

        let code = {
            let cc_state: State<'_, ClaudeCodeState> = app.state();
            let child = cc_state.procs.lock().unwrap().remove(&run_id);
            match child {
                Some(mut c) => c.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1),
                None => -1, // killed via cli_agent_kill
            }
        };
        let _ = app.emit(
            &event,
            RunEvent::Done {
                code,
                stderr: stderr_tail,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn cli_agent_kill(
    state: State<'_, ClaudeCodeState>,
    run_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.procs.lock().unwrap().remove(&run_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Fast availability probe for Settings / model picker UI. async — the
/// login-shell lookup can take seconds with heavy shell inits (nvm).
#[tauri::command]
pub async fn cli_agent_available(
    state: State<'_, ClaudeCodeState>,
    agent: String,
) -> Result<bool, String> {
    Ok(resolve_bin(&state, &agent).is_ok())
}
