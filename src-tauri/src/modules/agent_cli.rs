//! Headless wrapper around installed coding-agent CLIs (Claude Code, Codex,
//! cursor-agent, OpenCode). The webview never spawns processes itself: it asks
//! this module to detect which binaries exist and to run one in headless
//! streaming mode, with stdout lines relayed verbatim over a Tauri `Channel`.
//! Per-CLI event parsing lives on the frontend (one parser per CLI); Rust stays
//! a generic, injection-safe spawner so adding a CLI never touches Rust.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use shared_child::SharedChild;
use tauri::ipc::Channel;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

type ChildMap = Arc<Mutex<HashMap<u32, Arc<SharedChild>>>>;

#[derive(Default)]
pub struct AgentCliState {
    children: ChildMap,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentCliEvent {
    /// One line of stdout (typically a single JSON event from the CLI).
    Stdout { line: String },
    /// One line of stderr (diagnostics, progress, auth prompts).
    Stderr { line: String },
    /// Process exited. `code` is None if terminated by signal.
    Exit { code: Option<i32> },
    /// Spawn or wiring failure before/while running.
    Error { message: String },
}

/// PATH as seen by the user's login shell. A GUI-launched app inherits a
/// minimal PATH that usually omits `~/.local/bin`, `~/.npm-global/bin`, nvm,
/// etc. We resolve the real PATH once and reuse it for both detection and
/// spawning so the agent (and the tools it shells out to) behave as in a
/// terminal. Falls back to the inherited PATH if the probe fails.
fn login_path() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE.get_or_init(|| {
        if let Some(p) = probe_login_path() {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        std::env::var("PATH").unwrap_or_default()
    })
}

#[cfg(unix)]
fn probe_login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let out = Command::new(shell)
        .arg("-lc")
        .arg("printf %s \"$PATH\"")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
fn probe_login_path() -> Option<String> {
    // Windows GUI apps inherit the full user+system PATH already.
    None
}

#[cfg(windows)]
fn executable_exts() -> Vec<String> {
    std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_start_matches('.').to_ascii_lowercase())
        .collect()
}

/// Resolve a bare binary name to an absolute path by scanning `login_path()`.
/// Mirrors `command -v` semantics without spawning a shell per lookup.
fn resolve_bin(bin: &str) -> Option<PathBuf> {
    if bin.is_empty() {
        return None;
    }
    // An explicit path is used as-is when it points at a real file.
    if bin.contains('/') || bin.contains('\\') {
        let p = PathBuf::from(bin);
        return p.is_file().then_some(p);
    }
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in login_path().split(sep).filter(|s| !s.is_empty()) {
        let base = PathBuf::from(dir).join(bin);
        if base.is_file() {
            return Some(base);
        }
        #[cfg(windows)]
        for ext in executable_exts() {
            let cand = PathBuf::from(dir).join(format!("{bin}.{ext}"));
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// Map each requested binary name to its absolute path, or `None` if not found.
#[tauri::command]
pub async fn agent_cli_which(bins: Vec<String>) -> HashMap<String, Option<String>> {
    bins.into_iter()
        .map(|b| {
            let resolved = resolve_bin(&b).map(|p| p.to_string_lossy().into_owned());
            (b, resolved)
        })
        .collect()
}

/// Spawn a CLI agent in headless mode. `argv[0]` is the binary (bare name or
/// absolute path); the remaining entries are passed verbatim as separate
/// arguments (no shell, so the prompt cannot inject). Streams stdout/stderr
/// lines over `on_event` and resolves once the child has been launched; the
/// `Exit` event marks completion. `id` is a frontend-chosen handle for cancel.
#[tauri::command]
pub async fn agent_cli_spawn(
    id: u32,
    argv: Vec<String>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<AgentCliEvent>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, AgentCliState>,
) -> Result<(), String> {
    let Some((bin, args)) = argv.split_first() else {
        return Err("empty argv".into());
    };
    if bin.trim().is_empty() {
        return Err("empty binary".into());
    }

    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;

    let program = resolve_bin(bin).ok_or_else(|| format!("{bin} not found on PATH"))?;

    let mut cmd = Command::new(&program);
    cmd.args(args)
        .env("PATH", login_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.current_dir(dir);
    }
    crate::modules::proc::hide_console(&mut cmd);

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| {
        log::warn!("agent_cli_spawn failed for {bin}: {e}");
        e.to_string()
    })?);

    let stdout_pipe = child.take_stdout();
    let stderr_pipe = child.take_stderr();
    state.children.lock().unwrap().insert(id, Arc::clone(&child));

    if let Some(pipe) = stdout_pipe {
        let ch = on_event.clone();
        thread::spawn(move || stream_lines(pipe, &ch, true));
    }
    if let Some(pipe) = stderr_pipe {
        let ch = on_event.clone();
        thread::spawn(move || stream_lines(pipe, &ch, false));
    }

    let waiter = Arc::clone(&child);
    let children = Arc::clone(&state.children);
    thread::spawn(move || {
        let code = waiter.wait().ok().and_then(|s| s.code());
        let _ = on_event.send(AgentCliEvent::Exit { code });
        children.lock().unwrap().remove(&id);
    });

    Ok(())
}

/// Kill a running agent by its spawn `id`. No-op if already gone.
#[tauri::command]
pub async fn agent_cli_kill(id: u32, state: tauri::State<'_, AgentCliState>) -> Result<(), String> {
    let child = state.children.lock().unwrap().remove(&id);
    if let Some(child) = child {
        let _ = child.kill();
    }
    Ok(())
}

fn stream_lines<R: std::io::Read>(pipe: R, ch: &Channel<AgentCliEvent>, stdout: bool) {
    let reader = BufReader::new(pipe);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let event = if stdout {
            AgentCliEvent::Stdout { line }
        } else {
            AgentCliEvent::Stderr { line }
        };
        if ch.send(event).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_path_is_non_empty() {
        // Either the login-shell probe or the inherited PATH must yield something.
        assert!(!login_path().is_empty());
    }

    #[test]
    fn resolve_bin_rejects_missing() {
        assert!(resolve_bin("definitely-not-a-real-binary-zzz-9000").is_none());
        assert!(resolve_bin("").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_bin_finds_path_binary() {
        let p = resolve_bin("sh").expect("sh should resolve on PATH");
        assert!(p.is_absolute());
        assert!(p.is_file());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_bin_honors_explicit_path() {
        assert_eq!(resolve_bin("/bin/sh"), Some(PathBuf::from("/bin/sh")));
        assert!(resolve_bin("/nonexistent/dir/nope").is_none());
    }
}
