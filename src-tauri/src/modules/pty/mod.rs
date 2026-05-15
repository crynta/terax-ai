#[cfg(windows)]
mod job;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;

use portable_pty::PtySize;
use tauri::ipc::{Channel, Response};

use crate::modules::workspace::WorkspaceEnv;
use session::PtyHandle;

pub struct PtyState {
    sessions: RwLock<HashMap<u32, PtyHandle>>,
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

#[tauri::command]
pub async fn pty_open(
    state: tauri::State<'_, PtyState>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);

    let handle = match &workspace {
        WorkspaceEnv::Ssh { profile_id } => {
            let conn = ssh_state.get_or_err(profile_id)?;
            crate::modules::ssh::pty::open_ssh_pty_channel(conn, cols, rows, on_data, on_exit)
                .await?
        }
        _ => {
            let (session, _) = tauri::async_runtime::spawn_blocking(move || {
                session::spawn(cols, rows, cwd, workspace, on_data, on_exit)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| {
                log::error!("pty_open failed: {e}");
                e
            })?;
            PtyHandle::Local(session)
        }
    };

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap().insert(id, handle);
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, id: u32, data: String) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let handle = sessions.get(&id).ok_or_else(|| {
        log::warn!("pty_write: unknown id={id}");
        "no session".to_string()
    })?;
    handle.write(data.as_bytes()).map_err(|e| {
        log::debug!("pty_write id={id} failed: {e}");
        e
    })
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let handle = sessions.get(&id).ok_or_else(|| {
        log::warn!("pty_resize: unknown id={id}");
        "no session".to_string()
    })?;
    handle.resize(cols, rows).map_err(|e| {
        log::warn!("pty_resize id={id} failed: {e}");
        e
    })
}

#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let handle = state.sessions.write().unwrap().remove(&id);
    if let Some(h) = handle {
        if let Err(e) = h.kill() {
            log::debug!("pty_close: kill id={id} returned {e}");
        }
        log::info!("pty closed id={id}");
        // Drop on a detached thread to avoid blocking the Tauri worker on Windows
        // (ClosePseudoConsole can block until conhost drains its output buffer).
        thread::Builder::new()
            .name(format!("terax-pty-drop-{id}"))
            .spawn(move || {
                let t0 = std::time::Instant::now();
                drop(h);
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
