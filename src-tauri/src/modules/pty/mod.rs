mod agent_detect;
mod da_filter;
#[cfg(windows)]
mod job;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;

use portable_pty::PtySize;
use tauri::ipc::{Channel, Response};

use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry, authorize_user_spawn_cwd};
use session::Session;

pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    // Starts at 1 so freshly-handed-out ids are never 0, which the frontend
    // sometimes treats as "unset". Increments monotonically; never reused.
    next_id: AtomicU32,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl PtyState {
    pub(super) fn take(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.write().unwrap().remove(&id)
    }
}

fn path_string(path: PathBuf) -> String {
    crate::modules::fs::to_canon(path)
}

fn local_home_cwd(registry: &WorkspaceRegistry) -> Option<String> {
    let home = dirs::home_dir()?.canonicalize().ok()?;
    if !home.is_dir() {
        return None;
    }
    let canonical = registry.authorize(&home).ok()?;
    Some(path_string(canonical))
}

fn trimmed_cwd(cwd: Option<&str>) -> Option<String> {
    cwd.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn resolve_pty_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Option<String>, String> {
    if workspace.is_ssh() {
        return Ok(trimmed_cwd(cwd));
    }
    match authorize_user_spawn_cwd(registry, cwd, workspace) {
        Ok(resolved) => {
            if matches!(workspace, WorkspaceEnv::Local) {
                Ok(resolved.map(path_string))
            } else {
                Ok(trimmed_cwd(cwd))
            }
        }
        Err(e) if matches!(workspace, WorkspaceEnv::Local) => {
            log::warn!("pty_open: cwd rejected, falling back to home: {e}");
            Ok(local_home_cwd(registry))
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtyState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    blocks: Option<bool>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let blocks = blocks.unwrap_or(false);
    let cwd = resolve_pty_cwd(&registry, cwd.as_deref(), &workspace).map_err(|e| {
        log::warn!("pty_open: cwd rejected: {e}");
        e
    })?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = tauri::async_runtime::spawn_blocking(move || {
        session::spawn(
            id, app, cols, rows, cwd, workspace, blocks, on_data, on_exit,
        )
        .map(|(s, _)| s)
    })
    .await
    .map_err(|e| {
        log::error!("pty_open join failed: {e}");
        e.to_string()
    })?
    .map_err(|e| {
        log::error!("pty_open failed: {e}");
        e
    })?;
    state.sessions.write().unwrap().insert(id, session);
    // The shell can exit before this insert (instant failure, `exit` in an rc
    // file); the waiter's reap then ran with the id absent. Re-check and reap
    // so the pseudoconsole isn't stranded.
    let exited = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .map(|s| s.exited.load(Ordering::Acquire))
        .unwrap_or(false);
    if exited {
        if let Some(s) = state.take(id) {
            thread::Builder::new()
                .name(format!("terax-pty-drop-{id}"))
                .spawn(move || session::drop_session(s))
                .expect("spawn pty drop thread");
        }
    }
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

// Input is the latency-critical path: raw body + id header skips JSON
// serialization of every keystroke on both sides of the IPC boundary.
#[tauri::command]
pub fn pty_write(
    state: tauri::State<PtyState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("x-pty-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "pty_write: missing x-pty-id header".to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("pty_write: expected raw body".to_string());
    };
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            log::warn!("pty_write: unknown id={id}");
            "no session".to_string()
        })?;
    // Bind to a local so the MutexGuard temporary drops before `session` —
    // see rustc note on tail-expression temporary drop order.
    let result = session
        .writer
        .lock()
        .unwrap()
        .write_all(bytes)
        .map_err(|e| {
            // EPIPE is expected if the child already exited.
            log::debug!("pty_write id={id} failed: {e}");
            e.to_string()
        });
    result
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            log::warn!("pty_resize: unknown id={id}");
            "no session".to_string()
        })?;
    let result = session
        .master
        .lock()
        .unwrap()
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            log::warn!("pty_resize id={id} failed: {e}");
            e.to_string()
        });
    result
}

#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    if let Some(s) = session {
        if let Err(e) = s.killer.lock().unwrap().kill() {
            // Non-fatal: the child may already have exited on its own (e.g. the
            // user ran `exit`). Log so this isn't invisible during debugging.
            log::debug!("pty_close: kill id={id} returned {e}");
        }
        log::info!("pty closed id={id}");
        // Detached: on Windows `ClosePseudoConsole` can block until conhost
        // drains, which would freeze this Tauri worker thread and stall IPC.
        thread::Builder::new()
            .name(format!("terax-pty-drop-{id}"))
            .spawn(move || {
                let t0 = std::time::Instant::now();
                session::drop_session(s);
                log::info!(
                    "pty session id={id} dropped in {}ms",
                    t0.elapsed().as_millis()
                );
            })
            .expect("spawn pty drop thread");
    } else {
        log::debug!("pty_close: unknown id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn pty_has_foreground_process(state: tauri::State<PtyState>, id: u32) -> Result<bool, String> {
    let sessions = state.sessions.read().unwrap();
    let session = sessions.get(&id).ok_or_else(|| {
        log::warn!("pty_has_foreground_process: unknown session id={id}");
        "no session".to_string()
    })?;
    let shell_pid = session.shell_pid;
    if shell_pid == 0 {
        return Ok(false);
    }
    Ok(shell_has_children(shell_pid))
}

// Foreground-only check for the renderer hibernation path: true while a job
// owns the tty (tcgetpgrp != shell pgid). Stricter and cheaper than
// pty_has_foreground_process, which counts background children too.
#[tauri::command]
pub fn pty_has_foreground_job(state: tauri::State<PtyState>, id: u32) -> Result<bool, String> {
    let sessions = state.sessions.read().unwrap();
    let session = sessions.get(&id).ok_or_else(|| {
        log::warn!("pty_has_foreground_job: unknown session id={id}");
        "no session".to_string()
    })?;
    let shell_pid = session.shell_pid;
    if shell_pid == 0 {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        let leader = session.master.lock().unwrap().process_group_leader();
        Ok(matches!(leader, Some(pid) if pid > 0 && pid as u32 != shell_pid))
    }
    #[cfg(windows)]
    {
        Ok(shell_has_children(shell_pid))
    }
}

// pgrep -P exits 0 when shell_pid has at least one child, 1 when none.
#[cfg(unix)]
fn shell_has_children(shell_pid: u32) -> bool {
    std::process::Command::new("pgrep")
        .args(["-P", &shell_pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn shell_has_children(shell_pid: u32) -> bool {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32, Process32First, Process32Next, TH32CS_SNAPPROCESS,
    };
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32 = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32>() as u32;
        let mut found = false;
        if Process32First(snapshot, &mut entry) != 0 {
            loop {
                if entry.th32ParentProcessID == shell_pid {
                    found = true;
                    break;
                }
                if Process32Next(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        found
    }
}

// A fresh webview load orphans the previous frontend's sessions in this still
// running process; reap them on boot before any new tab spawns.
#[tauri::command]
pub fn pty_close_all(state: tauri::State<PtyState>) -> Result<usize, String> {
    let drained: Vec<(u32, Arc<Session>)> = {
        let mut sessions = state.sessions.write().unwrap();
        sessions.drain().collect()
    };
    let count = drained.len();
    for (id, s) in drained {
        if let Err(e) = s.killer.lock().unwrap().kill() {
            log::debug!("pty_close_all: kill id={id} returned {e}");
        }
        thread::Builder::new()
            .name(format!("terax-pty-drop-{id}"))
            .spawn(move || session::drop_session(s))
            .expect("spawn pty drop thread");
    }
    if count > 0 {
        log::info!("pty_close_all: reaped {count} orphaned session(s)");
    }
    Ok(count)
}

#[tauri::command]
pub fn pty_shell_name() -> String {
    shell_init::detect_shell_name()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn tempdir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "terax-pty-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).expect("tempdir");
        fs::canonicalize(dir).expect("canonical tempdir")
    }

    #[test]
    fn resolve_pty_cwd_registers_existing_local_cwd() {
        let dir = tempdir("existing");
        let reg = WorkspaceRegistry::default();
        let s = path_string(dir.clone());
        let resolved = resolve_pty_cwd(&reg, Some(&s), &WorkspaceEnv::Local).expect("resolved cwd");

        assert_eq!(resolved.as_deref(), Some(s.as_str()));
        assert!(reg.is_authorized(&dir));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn resolve_pty_cwd_falls_back_to_home_for_missing_local_cwd() {
        let Some(home) = dirs::home_dir()
            .and_then(|p| p.canonicalize().ok())
            .filter(|p| p.is_dir())
            .map(path_string)
        else {
            return;
        };
        let mut missing = std::env::temp_dir();
        missing.push(format!("terax-pty-missing-{}", std::process::id()));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        let resolved = resolve_pty_cwd(&reg, Some(&s), &WorkspaceEnv::Local).expect("fallback cwd");

        assert_eq!(resolved.as_deref(), Some(home.as_str()));
    }

    #[test]
    fn resolve_pty_cwd_keeps_ssh_cwd_remote() {
        let reg = WorkspaceRegistry::default();
        let env = WorkspaceEnv::Ssh {
            host: "victus".into(),
            user: Some("kaan".into()),
            port: None,
            root: None,
        };
        let resolved = resolve_pty_cwd(&reg, Some("/remote/project"), &env).expect("ssh cwd");

        assert_eq!(resolved.as_deref(), Some("/remote/project"));
    }
}
