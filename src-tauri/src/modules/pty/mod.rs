//! Pseudo-terminal (PTY) management: session create/write/resize/close, output streaming via Tauri channels, and agent detection (OSC 777).

mod agent_detect;
mod da_filter;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;

use portable_pty::PtySize;
use tauri::ipc::{Channel, Response};

use crate::modules::capabilities::AppCapabilityState;
use crate::modules::sync;
use crate::modules::workspace::{authorize_user_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
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
    fn take(&self, id: u32) -> Result<Option<Arc<Session>>, String> {
        Ok(sync::write(&self.sessions, "pty sessions")?.remove(&id))
    }
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command wrappers expose IPC fields directly"
)]
pub async fn pty_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtyState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    app_audit: tauri::State<'_, AppCapabilityState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    blocks: Option<bool>,
    shell: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let cwd = authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)
        .map(|cwd| cwd.map(|path| crate::modules::fs::to_canon(&path)))
        .map_err(|e| {
            log::warn!("pty_open: cwd rejected: {e}");
            e
        })?;
    let blocks = blocks.unwrap_or(false);
    // Opening an interactive shell is the highest-risk OS surface; record it in
    // the capability audit so the ledger accounts for every shell spawn.
    app_audit
        .execute_app_capability_async("app.pty_session", || async move {
            let id = state.next_id.fetch_add(1, Ordering::Relaxed);
            let session = tauri::async_runtime::spawn_blocking(move || {
                session::spawn(
                    id, app, cols, rows, cwd, workspace, blocks, shell, on_data, on_exit,
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
            sync::write(&state.sessions, "pty sessions")?.insert(id, session);
            let exited = sync::read(&state.sessions, "pty sessions")?
                .get(&id)
                .map(|session| session.exited.load(Ordering::Acquire))
                .unwrap_or(false);
            if exited {
                if let Some(session) = state.take(id)? {
                    thread::Builder::new()
                        .name(format!("terax-pty-drop-{id}"))
                        .spawn(move || session::drop_session(session))
                        .map_err(|error| format!("spawn pty drop thread: {error}"))?;
                }
            }
            log::info!("pty opened id={id} cols={cols} rows={rows}");
            Ok(id)
        })
        .await
}

#[tauri::command]
pub fn pty_write(
    state: tauri::State<PtyState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("x-pty-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "pty_write: missing x-pty-id header".to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("pty_write: expected raw body".to_string());
    };
    let session = {
        let sessions = sync::read(&state.sessions, "pty sessions")?;
        sessions.get(&id).cloned().ok_or_else(|| {
            log::warn!("pty_write: unknown id={id}");
            "no session".to_string()
        })?
    };
    // Bind to a local so the MutexGuard temporary drops before `session` -
    // see rustc note on tail-expression temporary drop order.
    let result = sync::mutex(&session.writer, "pty writer")?
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
    let session = {
        let sessions = sync::read(&state.sessions, "pty sessions")?;
        sessions.get(&id).cloned().ok_or_else(|| {
            log::warn!("pty_resize: unknown id={id}");
            "no session".to_string()
        })?
    };
    let result = session
        .master
        .lock()
        .map_err(|error| format!("pty master lock failed: {error}"))?
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
    let session = sync::write(&state.sessions, "pty sessions")?.remove(&id);
    if let Some(s) = session {
        if let Err(e) = sync::mutex(&s.killer, "pty killer")?.kill() {
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
            .map_err(|error| format!("spawn pty drop thread: {error}"))?;
    } else {
        log::debug!("pty_close: unknown id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn pty_has_foreground_process(state: tauri::State<PtyState>, id: u32) -> Result<bool, String> {
    let sessions = sync::read(&state.sessions, "pty sessions")?;
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
    let sessions = sync::read(&state.sessions, "pty sessions")?;
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
        let leader = sync::mutex(&session.master, "pty master")?.process_group_leader();
        Ok(matches!(leader, Some(pid) if pid > 0 && pid as u32 != shell_pid))
    }
    #[cfg(windows)]
    {
        Ok(shell_has_children(shell_pid))
    }
}

#[cfg(all(unix, target_os = "linux"))]
fn shell_has_children(shell_pid: u32) -> bool {
    std::fs::read_dir("/proc")
        .map(|entries| {
            entries.any(|e| {
                let name = e.ok()?.file_name();
                let child_pid: u32 = name.to_string_lossy().parse().ok()?;
                if child_pid == shell_pid {
                    return Some(false);
                }
                let stat = std::fs::read_to_string(format!("/proc/{}/stat", child_pid)).ok()?;
                let rest = stat.rsplit(')').next()?;
                let ppid: u32 = rest.split_whitespace().nth(1)?.parse().ok()?;
                Some(ppid == shell_pid)
            })
        })
        .unwrap_or(false)
}

#[cfg(all(unix, target_os = "macos"))]
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
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };
    // SAFETY: The snapshot handle is checked before use, PROCESSENTRY32 is
    // zero-initialized with `dwSize` set as required by ToolHelp APIs, and the
    // handle is closed exactly once before returning.
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
        let mut sessions = sync::write(&state.sessions, "pty sessions")?;
        sessions.drain().collect()
    };
    let count = drained.len();
    for (id, s) in drained {
        if let Err(e) = sync::mutex(&s.killer, "pty killer")?.kill() {
            log::debug!("pty_close_all: kill id={id} returned {e}");
        }
        thread::Builder::new()
            .name(format!("terax-pty-drop-{id}"))
            .spawn(move || session::drop_session(s))
            .map_err(|error| format!("spawn pty drop thread: {error}"))?;
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

#[tauri::command]
pub fn pty_list_shells() -> Vec<shell_init::ShellInfo> {
    shell_init::list_shells()
}
