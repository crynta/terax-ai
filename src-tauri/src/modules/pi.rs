use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use shared_child::SharedChild;
use tauri::ipc::Channel;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const DETECT_TIMEOUT_SECS: u64 = 5;
const LIST_TIMEOUT_SECS: u64 = 15;
const MAX_CAPTURE_BYTES: usize = 512 * 1024;

#[derive(Default)]
pub struct PiState {
    runs: Arc<Mutex<HashMap<String, Arc<SharedChild>>>>,
    next_run_id: AtomicU32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDetectResult {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiModelRecord {
    provider: String,
    model: String,
    context_tokens: Option<u64>,
    max_output_tokens: Option<u64>,
    thinking: bool,
    images: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PiRunEvent {
    Line { line: String },
    Stderr { line: String },
    End {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        success: bool,
    },
    Error { message: String },
}

#[tauri::command]
pub async fn pi_detect(executable_path: Option<String>) -> Result<PiDetectResult, String> {
    let Some(path) = resolve_pi_executable(executable_path.as_deref()) else {
        return Ok(PiDetectResult {
            installed: false,
            path: None,
            version: None,
            error: Some("pi executable not found".to_string()),
        });
    };
    let cwd = stable_pi_cwd();
    let output = run_capture(
        &path,
        ["--version"],
        cwd.as_deref(),
        Duration::from_secs(DETECT_TIMEOUT_SECS),
    );
    match output {
        Ok(out) if out.exit_code == Some(0) => Ok(PiDetectResult {
            installed: true,
            path: Some(path_to_string(&path)),
            version: Some(out.stdout.trim().to_string()),
            error: None,
        }),
        Ok(out) => Ok(PiDetectResult {
            installed: false,
            path: Some(path_to_string(&path)),
            version: None,
            error: Some(
                first_non_empty(&out.stderr, &out.stdout)
                    .unwrap_or("pi failed")
                    .to_string(),
            ),
        }),
        Err(e) => Ok(PiDetectResult {
            installed: false,
            path: Some(path_to_string(&path)),
            version: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn pi_list_models(executable_path: Option<String>) -> Result<Vec<PiModelRecord>, String> {
    let path = resolve_pi_executable(executable_path.as_deref())
        .ok_or_else(|| "pi executable not found".to_string())?;
    let cwd = stable_pi_cwd();
    let out = run_capture(
        &path,
        ["--offline", "--list-models"],
        cwd.as_deref(),
        Duration::from_secs(LIST_TIMEOUT_SECS),
    )?;
    if out.exit_code != Some(0) {
        return Err(first_non_empty(&out.stderr, &out.stdout)
            .unwrap_or("pi --list-models failed")
            .to_string());
    }
    let mut models = parse_model_table(&out.stdout);
    if models.is_empty() {
        models = parse_model_table(&out.stderr);
    }
    log::info!("pi_list_models returned {} models", models.len());
    Ok(models)
}

#[tauri::command]
pub fn pi_run(
    state: tauri::State<PiState>,
    registry: tauri::State<WorkspaceRegistry>,
    executable_path: Option<String>,
    cwd: Option<String>,
    session_id: String,
    model: String,
    prompt: String,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<PiRunEvent>,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("empty prompt".to_string());
    }
    validate_session_id(&session_id)?;
    let path = resolve_pi_executable(executable_path.as_deref())
        .ok_or_else(|| "pi executable not found".to_string())?;
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Err("Pi provider is currently available for local workspaces only.".to_string());
    }
    let cwd_path = authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let fallback_cwd = if cwd_path.is_none() {
        stable_pi_cwd()
    } else {
        None
    };

    let mut cmd = Command::new(path);
    cmd.arg("--mode")
        .arg("json")
        .arg("--print")
        .arg("--session-id")
        .arg(&session_id)
        .arg("--model")
        .arg(&model)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let (WorkspaceEnv::Local, Some(dir)) =
        (&workspace, cwd_path.as_ref().or(fallback_cwd.as_ref()))
    {
        cmd.current_dir(dir);
    }
    crate::modules::proc::hide_console(&mut cmd);

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let mut stdin = child.take_stdin().ok_or_else(|| {
        let _ = child.kill();
        "no stdin pipe".to_string()
    })?;
    let stdout = child.take_stdout().ok_or_else(|| {
        let _ = child.kill();
        "no stdout pipe".to_string()
    })?;
    let stderr = child.take_stderr().ok_or_else(|| {
        let _ = child.kill();
        "no stderr pipe".to_string()
    })?;

    let id = format!("pi-{}", state.next_run_id.fetch_add(1, Ordering::Relaxed));
    state
        .runs
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::clone(&child));
    let runs = Arc::clone(&state.runs);
    let run_id = id.clone();

    thread::spawn(move || {
        let writer_child = Arc::clone(&child);
        let prompt_for_writer = prompt;
        thread::spawn(move || {
            if stdin.write_all(prompt_for_writer.as_bytes()).is_err() {
                let _ = writer_child.kill();
                return;
            }
            let _ = stdin.write_all(b"\n");
        });

        let stderr_channel = on_event.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if stderr_channel.send(PiRunEvent::Stderr { line }).is_err() {
                    break;
                }
            }
        });

        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if on_event.send(PiRunEvent::Line { line }).is_err() {
                        let _ = child.kill();
                        break;
                    }
                }
                Err(e) => {
                    let _ = on_event.send(PiRunEvent::Error {
                        message: e.to_string(),
                    });
                    let _ = child.kill();
                    break;
                }
            }
        }
        let status = child.wait().ok();
        let code = status.as_ref().and_then(|s| s.code());
        let success = status.as_ref().is_some_and(|s| s.success());
        runs.lock().unwrap().remove(&run_id);
        let _ = on_event.send(PiRunEvent::End {
            exit_code: code,
            success,
        });
    });

    Ok(id)
}

#[tauri::command]
pub fn pi_cancel(state: tauri::State<PiState>, run_id: String) -> Result<(), String> {
    if let Some(child) = state.runs.lock().unwrap().remove(&run_id) {
        let _ = child.kill();
    }
    Ok(())
}

#[derive(Debug)]
struct Captured {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

fn run_capture<I, S>(
    executable: &Path,
    args: I,
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<Captured, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut cmd = Command::new(executable);
    for arg in args {
        cmd.arg(arg.as_ref());
    }
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let mut stdout = child
        .take_stdout()
        .ok_or_else(|| "no stdout pipe".to_string())?;
    let mut stderr = child
        .take_stderr()
        .ok_or_else(|| "no stderr pipe".to_string())?;
    let stdout_handle = thread::spawn(move || drain_limited(&mut stdout));
    let stderr_handle = thread::spawn(move || drain_limited(&mut stderr));
    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });

    let status = match rx.recv_timeout(timeout) {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("pi command timed out".to_string());
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("pi wait thread disconnected".to_string());
        }
    };
    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    Ok(Captured {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code: status.code(),
    })
}

fn drain_limited<R: std::io::Read>(reader: &mut R) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() < MAX_CAPTURE_BYTES {
                    let take = (MAX_CAPTURE_BYTES - out.len()).min(n);
                    out.extend_from_slice(&buf[..take]);
                }
            }
            Err(_) => break,
        }
    }
    out
}

fn resolve_pi_executable(configured: Option<&str>) -> Option<PathBuf> {
    let configured = configured.map(str::trim).filter(|s| !s.is_empty());
    if let Some(path) = configured {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
        return None;
    }
    find_on_path("pi")
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    for dir in env::split_paths(&paths) {
        for candidate in executable_candidates(&dir, name) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        vec![
            dir.join(format!("{name}.exe")),
            dir.join(format!("{name}.cmd")),
            dir.join(format!("{name}.bat")),
            dir.join(name),
        ]
    }
    #[cfg(not(windows))]
    {
        vec![dir.join(name)]
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn stable_pi_cwd() -> Option<PathBuf> {
    dirs::home_dir().filter(|path| path.is_dir())
}

fn first_non_empty<'a>(a: &'a str, b: &'a str) -> Option<&'a str> {
    let a = a.trim();
    if !a.is_empty() {
        return Some(a);
    }
    let b = b.trim();
    if !b.is_empty() {
        return Some(b);
    }
    None
}

fn validate_session_id(id: &str) -> Result<(), String> {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return Err("session id is empty".to_string());
    };
    if !first.is_ascii_alphanumeric() {
        return Err("session id must start with an alphanumeric character".to_string());
    }
    let mut last = first;
    for ch in chars {
        if !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.') {
            return Err("session id contains invalid characters".to_string());
        }
        last = ch;
    }
    if !last.is_ascii_alphanumeric() {
        return Err("session id must end with an alphanumeric character".to_string());
    }
    Ok(())
}

pub(crate) fn parse_model_table(output: &str) -> Vec<PiModelRecord> {
    output
        .lines()
        .skip_while(|line| !line.trim_start().starts_with("provider"))
        .skip(1)
        .filter_map(parse_model_row)
        .collect()
}

fn parse_model_row(line: &str) -> Option<PiModelRecord> {
    let mut parts = line.split_whitespace();
    let provider = parts.next()?.to_string();
    let model = parts.next()?.to_string();
    let context_tokens = parse_token_count(parts.next()?);
    let max_output_tokens = parse_token_count(parts.next()?);
    let thinking = parse_yes_no(parts.next()?);
    let images = parse_yes_no(parts.next()?);
    Some(PiModelRecord {
        provider,
        model,
        context_tokens,
        max_output_tokens,
        thinking,
        images,
    })
}

fn parse_yes_no(value: &str) -> bool {
    value.eq_ignore_ascii_case("yes")
}

fn parse_token_count(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (number, mult) = match trimmed.chars().last()? {
        'K' | 'k' => (&trimmed[..trimmed.len() - 1], 1_000.0),
        'M' | 'm' => (&trimmed[..trimmed.len() - 1], 1_000_000.0),
        _ => (trimmed, 1.0),
    };
    let parsed = number.parse::<f64>().ok()?;
    Some((parsed * mult).round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pi_model_table() {
        let rows = parse_model_table(
            "provider        model                   context  max-out  thinking  images\n\
             github-copilot  claude-sonnet-4.6       1M       32K      yes       yes\n\
             opencode        gpt-5.4-mini            400K     128K     yes       yes\n\
             openai          gpt-4o                  128K     4.1K     no        yes\n",
        );
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].provider, "github-copilot");
        assert_eq!(rows[0].model, "claude-sonnet-4.6");
        assert_eq!(rows[0].context_tokens, Some(1_000_000));
        assert_eq!(rows[2].max_output_tokens, Some(4_100));
        assert!(!rows[2].thinking);
    }

    #[test]
    fn parses_model_table_from_pi_stderr_shape() {
        let stderr = "provider        model                   context  max-out  thinking  images\n\
                      github-copilot  claude-opus-4.8       200K     64K      yes       yes\n";
        let rows = parse_model_table(stderr);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].provider, "github-copilot");
        assert_eq!(rows[0].model, "claude-opus-4.8");
        assert_eq!(rows[0].context_tokens, Some(200_000));
    }

    #[test]
    fn validates_pi_session_ids() {
        assert!(validate_session_id("terax-s-abc_123").is_ok());
        assert!(validate_session_id("-bad").is_err());
        assert!(validate_session_id("bad!").is_err());
        assert!(validate_session_id("bad-").is_err());
    }
}
