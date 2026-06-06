pub mod background;
pub mod ringbuffer;
pub mod session;

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;

use crate::modules::capabilities::{
    AppCapabilityState, WorkflowCapabilityState, WorkflowPolicyContext,
};
use crate::modules::sync;
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
/// the user's interactive PTY - that would fight their input. AI tool calls
/// are presented in chat as their own structured result.
#[tauri::command]
pub async fn shell_run_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    app_audit: tauri::State<'_, AppCapabilityState>,
) -> Result<CommandOutput, String> {
    app_audit
        .execute_app_capability_async("app.shell_command", || async move {
            let trimmed = command.trim().to_string();
            if trimmed.is_empty() {
                return Err("empty command".into());
            }

            let workspace = WorkspaceEnv::from_option(workspace);
            authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
            let cwd_path = cwd
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            let dur = Duration::from_secs(
                timeout_secs
                    .unwrap_or(DEFAULT_TIMEOUT_SECS)
                    .clamp(1, MAX_TIMEOUT_SECS),
            );

            run_blocking_on_worker(trimmed, cwd_path, workspace, dur).await
        })
        .await
}

pub(crate) fn run_blocking_inner(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    run_blocking(command, cwd, workspace, dur)
}

async fn run_blocking_on_worker(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_blocking(command, cwd, workspace, dur))
        .await
        .map_err(|e| e.to_string())?
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

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| {
        log::warn!("shell_run_command spawn failed: {e}");
        e.to_string()
    })?);
    let mut stdout_pipe = child.take_stdout().ok_or_else(|| {
        let _ = child.kill();
        "no stdout pipe".to_string()
    })?;
    let mut stderr_pipe = child.take_stderr().ok_or_else(|| {
        let _ = child.kill();
        "no stderr pipe".to_string()
    })?;

    let stdout_handle = thread::spawn(move || drain(&mut stdout_pipe));
    let stderr_handle = thread::spawn(move || drain(&mut stderr_pipe));

    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });

    let (exit_code, timed_out) = match rx.recv_timeout(dur) {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let _ = child.wait();
            (None, true)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("shell wait thread disconnected".into());
        }
    };

    let (stdout_bytes, stdout_truncated) = stdout_handle.join().unwrap_or((Vec::new(), false));
    let (stderr_bytes, stderr_truncated) = stderr_handle.join().unwrap_or((Vec::new(), false));

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        exit_code,
        timed_out,
        truncated: stdout_truncated || stderr_truncated,
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

impl ShellState {
    pub fn background_logs(
        &self,
        handle: u32,
        since_offset: u64,
    ) -> Result<BackgroundLogResponse, String> {
        let proc = sync::read(&self.bg, "shell background processes")?
            .get(&handle)
            .cloned()
            .ok_or_else(|| "no background handle".to_string())?;
        proc.read_logs(since_offset)
    }
}

#[tauri::command]
pub fn shell_session_open(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    app_audit: tauri::State<AppCapabilityState>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    app_audit.execute_app_capability("app.shell_session", || {
        let workspace = WorkspaceEnv::from_option(workspace);
        authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
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
        let session = Arc::new(ShellSession::new(initial, workspace));
        let id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
        sync::write(&state.sessions, "shell sessions")?.insert(id, session);
        Ok(id)
    })
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command wrappers expose IPC fields directly"
)]
pub async fn shell_session_run(
    state: tauri::State<'_, ShellState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    app_audit: tauri::State<'_, AppCapabilityState>,
    id: u32,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
) -> Result<SessionRunOutput, String> {
    app_audit
        .execute_app_capability_async("app.shell_session", || async move {
            let session = {
                let sessions = sync::read(&state.sessions, "shell sessions")?;
                sessions
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| "no shell session".to_string())?
            };
            let effective_workspace = workspace
                .clone()
                .unwrap_or_else(|| session.workspace.clone());
            authorize_spawn_cwd(&registry, cwd.as_deref(), &effective_workspace)?;
            let dur = Duration::from_secs(
                timeout_secs
                    .unwrap_or(DEFAULT_TIMEOUT_SECS)
                    .clamp(1, MAX_TIMEOUT_SECS),
            );
            run_session_on_worker(session, command, cwd, workspace, dur).await
        })
        .await
}

async fn run_session_on_worker(
    session: Arc<ShellSession>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    dur: Duration,
) -> Result<SessionRunOutput, String> {
    tauri::async_runtime::spawn_blocking(move || session.run(command, cwd, workspace, dur))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn shell_session_close(state: tauri::State<ShellState>, id: u32) -> Result<(), String> {
    sync::write(&state.sessions, "shell sessions")?.remove(&id);
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowShellSpawnRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub workspace: WorkspaceEnv,
    pub approved: bool,
    pub document_id: String,
    pub node_id: String,
}

impl WorkflowShellSpawnRequest {
    fn policy_context(&self) -> WorkflowPolicyContext {
        WorkflowPolicyContext {
            approved: self.approved,
            document_id: self.document_id.clone(),
            node_id: self.node_id.clone(),
        }
    }
}

pub fn workflow_shell_bg_spawn_inner(
    state: &ShellState,
    registry: &WorkspaceRegistry,
    audit: &WorkflowCapabilityState,
    request: WorkflowShellSpawnRequest,
) -> Result<u32, String> {
    let context = request.policy_context();
    audit.execute_workflow_capability(&context, "workflow.shell_command", || {
        shell_bg_spawn_inner(
            state,
            registry,
            request.command,
            request.cwd,
            request.workspace,
        )
    })
}

fn shell_bg_spawn_inner(
    state: &ShellState,
    registry: &WorkspaceRegistry,
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<u32, String> {
    authorize_spawn_cwd(registry, cwd.as_deref(), &workspace)?;
    let proc = background::spawn(command, cwd, workspace)?;
    let id = state.next_bg_id.fetch_add(1, Ordering::Relaxed);
    sync::write(&state.bg, "shell background processes")?.insert(id, proc);
    Ok(id)
}

#[tauri::command]
pub fn workflow_shell_bg_spawn(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    audit: tauri::State<WorkflowCapabilityState>,
    request: WorkflowShellSpawnRequest,
) -> Result<u32, String> {
    workflow_shell_bg_spawn_inner(&state, &registry, &audit, request)
}

#[tauri::command]
pub fn shell_bg_spawn(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    app_audit: tauri::State<AppCapabilityState>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    app_audit.execute_app_capability("app.shell_background", || {
        shell_bg_spawn_inner(
            &state,
            &registry,
            command,
            cwd,
            WorkspaceEnv::from_option(workspace),
        )
    })
}

#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<ShellState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<BackgroundLogResponse, String> {
    let proc = sync::read(&state.bg, "shell background processes")?
        .get(&handle)
        .cloned()
        .ok_or_else(|| "no background handle".to_string())?;
    proc.read_logs(since_offset.unwrap_or(0))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<ShellState>, handle: u32) -> Result<(), String> {
    let proc = sync::read(&state.bg, "shell background processes")?
        .get(&handle)
        .cloned();
    if let Some(proc) = proc {
        proc.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn shell_bg_list(state: tauri::State<ShellState>) -> Result<Vec<BackgroundProcInfo>, String> {
    let map = sync::read(&state.bg, "shell background processes")?;
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

fn drain<R: Read>(reader: &mut R) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= MAX_OUTPUT_BYTES {
                    truncated = true;
                    continue;
                }
                let take = (MAX_OUTPUT_BYTES - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

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

    #[tokio::test(flavor = "current_thread")]
    async fn run_blocking_on_worker_yields_async_executor() {
        let did_run = Arc::new(AtomicBool::new(false));
        let did_run_task = Arc::clone(&did_run);
        tokio::spawn(async move {
            tokio::task::yield_now().await;
            did_run_task.store(true, Ordering::SeqCst);
        });

        let out = run_blocking_on_worker(
            "sleep 1".into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(5),
        )
        .await
        .expect("run");

        assert_eq!(out.exit_code, Some(0));
        assert!(
            did_run.load(Ordering::SeqCst),
            "blocking command work must yield the async executor"
        );
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
