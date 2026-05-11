#[cfg(windows)]
mod job;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;

use portable_pty::PtySize;
use tauri::ipc::Channel;

pub use session::PtyEvent;
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

#[tauri::command]
pub fn pty_open(
    state: tauri::State<PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<u32, String> {
    let (session, _) = session::spawn(cols, rows, cwd, on_event).map_err(|e| {
        log::error!("pty_open failed: {e}");
        e
    })?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap().insert(id, session);
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, id: u32, data: String) -> Result<(), String> {
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
        .write_all(data.as_bytes())
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

/// Return the current working directory of the shell running in PTY `id`.
///
/// Used by the frontend to capture per-tab CWD on close (and on demand) for the tab-layout
/// restore flow in #134 — combined with the existing `pty_open(..., cwd)` parameter, this lets
/// the frontend re-spawn shells at their last-known directory on the next launch.
///
/// Platform support:
/// - **Linux**: reads `/proc/<pid>/cwd` symlink. Returns the resolved absolute path.
/// - **macOS**: not yet wired (would need `libproc` or equivalent). Returns an error.
/// - **Windows**: no clean Win32 API for "child process CWD". Returns an error.
///   The standard approach there is for the shell to emit OSC 7 (`ESC ] 7 ; file://...\7`)
///   which the terminal can track from the PTY output stream; that's a larger change and
///   needs an opt-in shell-profile snippet.
///
/// On unsupported platforms the frontend should fall back to "open in the default home
/// directory" instead of failing the restore.
#[tauri::command]
pub fn pty_cwd(state: tauri::State<PtyState>, id: u32) -> Result<String, String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            log::warn!("pty_cwd: unknown id={id}");
            "no session".to_string()
        })?;
    let pid = session.child_pid.ok_or_else(|| {
        log::warn!("pty_cwd id={id}: child PID unavailable");
        "child pid unavailable".to_string()
    })?;
    read_child_cwd(pid).map_err(|e| {
        log::debug!("pty_cwd id={id} pid={pid} failed: {e}");
        e
    })
}

/// Platform-specific CWD lookup for an arbitrary child PID. Kept separate from the Tauri
/// command so it can be unit-tested without spinning up the Tauri runtime: on Linux the test
/// just probes the current process's own CWD.
fn read_child_cwd(pid: u32) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let link = format!("/proc/{pid}/cwd");
        match std::fs::read_link(&link) {
            Ok(path) => Ok(path.to_string_lossy().into_owned()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(format!("process {pid} not found"))
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                Err(format!("no permission to read /proc/{pid}/cwd"))
            }
            Err(e) => Err(format!("read_link({link}): {e}")),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        Err("pty_cwd: not yet supported on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn read_child_cwd_returns_own_cwd_for_self_pid() {
        let pid = std::process::id();
        let got = read_child_cwd(pid).expect("self pid must be readable");
        let expected = std::env::current_dir()
            .expect("test process must have a current_dir")
            .to_string_lossy()
            .into_owned();
        assert_eq!(got, expected);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn read_child_cwd_errors_on_unknown_pid() {
        // Treat /proc absence (e.g. unlikely sandboxed runners) the same as "not found".
        // 0xFFFFFE = 16777214 is well above any realistic live PID on Linux (`pid_max`
        // defaults to 4M and is usually capped well below 2^24 on real systems).
        let err = read_child_cwd(16_777_214).expect_err("synthetic high PID must not exist");
        assert!(
            err.contains("not found") || err.contains("read_link"),
            "unexpected error variant: {err}"
        );
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn read_child_cwd_reports_unsupported_on_other_platforms() {
        let err = read_child_cwd(1).expect_err("non-Linux platforms return Err");
        assert!(err.contains("not yet supported"));
    }
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
        // Drop the Arc on a detached thread. On Windows `MasterPty`'s Drop
        // calls `ClosePseudoConsole`, which can block until conhost finishes
        // draining its output buffer. Doing it here would freeze the Tauri
        // worker thread that handled this command — and on Windows that
        // sometimes manifests as the closed pane refusing to disappear from
        // the React tree because subsequent IPC stalls behind it.
        thread::Builder::new()
            .name(format!("terax-pty-drop-{id}"))
            .spawn(move || {
                let t0 = std::time::Instant::now();
                drop(s);
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
