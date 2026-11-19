pub mod background;
pub mod ringbuffer;
pub mod session;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;

use crate::modules::proc::capture::{self, Limits};
#[cfg(windows)]
use crate::modules::workspace::validate_wsl_distro_name;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

use background::{BackgroundLogResponse, BackgroundProc, BackgroundProcInfo};
use session::{SessionRunOutput, ShellSession};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 300;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[derive(Serialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
}

/// Runs a one-shot command via the user's login shell. Output is capped and
/// the process is force-killed on timeout. We deliberately do NOT pipe into
/// the user's interactive PTY — that would fight their input. AI tool calls
/// are presented in chat as their own structured result.
#[tauri::command]
pub async fn shell_run_command(
    app: tauri::AppHandle,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
) -> Result<CommandOutput, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let dur = clamp_timeout(timeout_secs);

    // Authorization canonicalizes the cwd and the run blocks until exit, so
    // both belong on the blocking pool, never on an async worker.
    tauri::async_runtime::spawn_blocking(move || {
        authorize_spawn_cwd(
            &app.state::<WorkspaceRegistry>(),
            cwd.as_deref(),
            &workspace,
        )?;
        let cwd_path = cwd
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        run_blocking(trimmed, cwd_path, workspace, dur)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn clamp_timeout(timeout_secs: Option<u64>) -> Duration {
    Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    )
}

pub(crate) fn run_blocking_inner(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    run_blocking(command, cwd, workspace, dur)
}

fn run_blocking(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    let mut cmd = build_oneshot_command(&command, &workspace, cwd.as_deref())?;
    if let (WorkspaceEnv::Local, Some(dir)) = (&workspace, cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    let captured = capture::run(
        &mut cmd,
        dur,
        Limits {
            stdout: MAX_OUTPUT_BYTES,
            stderr: MAX_OUTPUT_BYTES,
            stop_on_stdout_cap: false,
        },
    )
    .map_err(|e| {
        log::warn!("shell_run_command failed: {e}");
        e.to_string()
    })?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&captured.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&captured.stderr).into_owned(),
        exit_code: captured.exit_code,
        timed_out: captured.timed_out,
        truncated: captured.stdout_truncated || captured.stderr_truncated,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Persistent agent shell state + background process state.
// ──────────────────────────────────────────────────────────────────────────

pub struct ShellState {
    sessions: RwLock<HashMap<u32, Arc<ShellSession>>>,
    bg: RwLock<HashMap<u32, Arc<BackgroundProc>>>,
    next_session_id: AtomicU32,
    next_bg_id: AtomicU32,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            bg: RwLock::new(HashMap::new()),
            next_session_id: AtomicU32::new(1),
            next_bg_id: AtomicU32::new(1),
        }
    }
}

#[tauri::command]
pub async fn shell_session_open(
    app: tauri::AppHandle,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    // wsl_home spawns wsl.exe on Windows and authorization hits the disk.
    let registry_app = app.clone();
    let (initial, workspace) = tauri::async_runtime::spawn_blocking(move || {
        authorize_spawn_cwd(
            &registry_app.state::<WorkspaceRegistry>(),
            cwd.as_deref(),
            &workspace,
        )?;
        let initial = match cwd.as_deref().filter(|s| !s.is_empty()) {
            Some(c) => c.to_string(),
            None => {
                if let WorkspaceEnv::Wsl { distro } = &workspace {
                    crate::modules::workspace::wsl_home(distro.clone())?
                } else {
                    crate::modules::fs::to_canon(
                        dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
                    )
                }
            }
        };
        Ok::<_, String>((initial, workspace))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(register_session(&app, initial, workspace))
}

fn register_session(app: &tauri::AppHandle, initial: String, workspace: WorkspaceEnv) -> u32 {
    let state = app.state::<ShellState>();
    let session = Arc::new(ShellSession::new(initial, workspace));
    let id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap().insert(id, session);
    id
}

#[tauri::command]
pub async fn shell_session_run(
    app: tauri::AppHandle,
    id: u32,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
) -> Result<SessionRunOutput, String> {
    let session = app
        .state::<ShellState>()
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| "no shell session".to_string())?;
    let dur = clamp_timeout(timeout_secs);
    tauri::async_runtime::spawn_blocking(move || {
        let effective_workspace = workspace
            .clone()
            .unwrap_or_else(|| session.workspace.clone());
        authorize_spawn_cwd(
            &app.state::<WorkspaceRegistry>(),
            cwd.as_deref(),
            &effective_workspace,
        )?;
        session.run(command, cwd, workspace, dur)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn shell_session_close(state: tauri::State<ShellState>, id: u32) -> Result<(), String> {
    state.sessions.write().unwrap().remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn shell_bg_spawn(
    app: tauri::AppHandle,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    tauri::async_runtime::spawn_blocking(move || {
        authorize_spawn_cwd(
            &app.state::<WorkspaceRegistry>(),
            cwd.as_deref(),
            &workspace,
        )?;
        let proc = background::spawn(command, cwd, workspace)?;
        let state = app.state::<ShellState>();
        let id = state.next_bg_id.fetch_add(1, Ordering::Relaxed);
        state.bg.write().unwrap().insert(id, proc);
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<ShellState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<BackgroundLogResponse, String> {
    let proc = state
        .bg
        .read()
        .unwrap()
        .get(&handle)
        .cloned()
        .ok_or_else(|| "no background handle".to_string())?;
    Ok(proc.read_logs(since_offset.unwrap_or(0)))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<ShellState>, handle: u32) -> Result<(), String> {
    if let Some(proc) = state.bg.read().unwrap().get(&handle).cloned() {
        proc.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn shell_bg_list(state: tauri::State<ShellState>) -> Result<Vec<BackgroundProcInfo>, String> {
    let map = state.bg.read().unwrap();
    let mut out = Vec::with_capacity(map.len());
    for (id, p) in map.iter() {
        out.push(p.info(*id));
    }
    out.sort_by_key(|i| i.handle);
    Ok(out)
}

pub(crate) fn build_oneshot_command(
    command: &str,
    #[cfg_attr(not(windows), allow(unused_variables))] workspace: &WorkspaceEnv,
    #[cfg_attr(not(windows), allow(unused_variables))] cwd: Option<&str>,
) -> Result<Command, String> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        validate_wsl_distro_name(distro)?;
        let mut cmd = Command::new("wsl.exe");
        cmd.arg("-d").arg(distro);
        if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
            cmd.arg("--cd").arg(cwd);
        }
        cmd.arg("--exec").arg("sh").arg("-lc").arg(command);
        return Ok(cmd);
    }
    #[cfg(unix)]
    {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
        for (key, value) in crate::modules::workspace::child_env_overrides() {
            match value {
                Some(v) => {
                    cmd.env(key, v);
                }
                None => {
                    cmd.env_remove(key);
                }
            }
        }
        Ok(cmd)
    }
    #[cfg(windows)]
    {
        let shell = crate::modules::pty::shell_init::windows_shell_path();
        let mut cmd = Command::new(&shell);
        let is_cmd = shell
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("cmd.exe"))
            .unwrap_or(false);
        if is_cmd {
            cmd.arg("/C").arg(command);
        } else {
            cmd.arg("-NoProfile").arg("-Command").arg(command);
        }
        Ok(cmd)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn run(cmd: &str, timeout_secs: u64) -> CommandOutput {
        run_blocking_inner(
            cmd.into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(timeout_secs),
        )
        .expect("run")
    }

    #[test]
    fn run_blocking_captures_stdout_and_zero_exit() {
        let out = run("printf 'hello\\n'", 5);
        assert_eq!(out.stdout, "hello\n");
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out);
        assert!(!out.truncated);
    }

    #[test]
    fn run_blocking_captures_stderr_and_nonzero_exit() {
        let out = run("printf 'oops\\n' >&2; exit 3", 5);
        assert!(out.stderr.contains("oops"));
        assert_eq!(out.exit_code, Some(3));
    }

    #[test]
    fn run_blocking_times_out_long_running_command() {
        let out = run("sleep 10", 1);
        assert!(out.timed_out);
        assert_eq!(out.exit_code, None);
    }

    #[test]
    fn run_blocking_truncates_huge_output() {
        let big = MAX_OUTPUT_BYTES + 4096;
        let out = run(&format!("head -c {big} /dev/zero"), 10);
        assert!(out.truncated);
        assert!(out.stdout.len() <= MAX_OUTPUT_BYTES);
    }

    #[test]
    fn build_oneshot_command_uses_sh_minus_c_on_unix() {
        let cmd = build_oneshot_command("echo hi", &WorkspaceEnv::Local, None).unwrap();
        assert_eq!(cmd.get_program(), "/bin/sh");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args, vec!["-c", "echo hi"]);
    }
}
