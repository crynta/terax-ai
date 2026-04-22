mod session;
mod shell_init;

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex, RwLock};

use portable_pty::PtySize;
use tauri::ipc::Channel;

pub use session::PtyEvent;
use session::Session;

#[derive(Default)]
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    next_id: Mutex<u32>,
}

#[tauri::command]
pub fn pty_open(
    state: tauri::State<PtyState>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<u32, String> {
    let (session, _) = session::spawn(cols, rows, on_event)?;
    let id = {
        let mut n = state.next_id.lock().unwrap();
        *n += 1;
        *n
    };
    state.sessions.write().unwrap().insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn pty_write(
    state: tauri::State<PtyState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("no session")?;
    let result = session
        .writer
        .lock()
        .unwrap()
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string());
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
        .ok_or("no session")?;
    let result = session
        .master
        .lock()
        .unwrap()
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    if let Some(s) = session {
        let _ = s.killer.lock().unwrap().kill();
    }
    Ok(())
}
