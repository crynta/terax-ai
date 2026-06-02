use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use super::{PiSession, PiSessionEvent, PiSessionsList};

const HISTORY_FILE_NAME: &str = "pi-sessions.json";
const MAX_EVENTS: usize = 500;

static HISTORY_LOCK: Mutex<()> = Mutex::new(());

fn history_lock() -> Result<MutexGuard<'static, ()>, String> {
    HISTORY_LOCK.lock().map_err(|e| e.to_string())
}

pub fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(HISTORY_FILE_NAME))
}

pub fn load(app: &AppHandle) -> Result<PiSessionsList, String> {
    let path = history_path(app)?;
    let _guard = history_lock()?;
    load_from_path(&path)
}

pub fn record_session_result(
    app: &AppHandle,
    session: &PiSession,
    events: &[PiSessionEvent],
) -> Result<(), String> {
    record_session_result_at_path(&history_path(app)?, session, events)
}

pub fn record_event_at_path(path: &Path, event: &PiSessionEvent) -> Result<(), String> {
    let _guard = history_lock()?;
    let mut history = load_from_path(path)?;
    apply_event_to_sessions(&mut history.sessions, event);
    append_events(&mut history.events, std::slice::from_ref(event));
    save_to_path(path, &history)
}

fn record_session_result_at_path(
    path: &Path,
    session: &PiSession,
    events: &[PiSessionEvent],
) -> Result<(), String> {
    let _guard = history_lock()?;
    let mut history = load_from_path(path)?;
    upsert_session(&mut history.sessions, session.clone());
    for event in events {
        apply_event_to_sessions(&mut history.sessions, event);
    }
    append_events(&mut history.events, events);
    save_to_path(path, &history)
}

fn load_from_path(path: &Path) -> Result<PiSessionsList, String> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(PiSessionsList::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn save_to_path(path: &Path, history: &PiSessionsList) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let contents = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    fs::write(path, format!("{contents}\n")).map_err(|e| e.to_string())
}

fn upsert_session(sessions: &mut Vec<PiSession>, session: PiSession) {
    if let Some(index) = sessions.iter().position(|current| current.id == session.id) {
        sessions[index] = session;
    } else {
        sessions.insert(0, session);
    }
}

fn append_events(history_events: &mut Vec<PiSessionEvent>, events: &[PiSessionEvent]) {
    for event in events {
        if !history_events.iter().any(|current| current.id == event.id) {
            history_events.insert(0, event.clone());
        }
    }
    history_events.truncate(MAX_EVENTS);
}

fn apply_event_to_sessions(sessions: &mut [PiSession], event: &PiSessionEvent) {
    let Some(session) = sessions
        .iter_mut()
        .find(|session| session.id == event.session_id)
    else {
        return;
    };

    if event.event_type == "session.status" {
        if let Some(status) = event.payload["status"].as_str() {
            session.status = status.to_string();
            session.updated_at = event.created_at.clone();
        }
    }
    if event.event_type == "session.error" {
        session.status = "error".to_string();
        session.updated_at = event.created_at.clone();
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    fn session(id: &str, status: &str) -> PiSession {
        PiSession {
            id: id.to_string(),
            title: id.to_string(),
            cwd: None,
            status: status.to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            last_prompt: None,
        }
    }

    fn event(
        id: &str,
        event_type: &str,
        session_id: &str,
        payload: serde_json::Value,
    ) -> PiSessionEvent {
        PiSessionEvent {
            id: id.to_string(),
            event_type: event_type.to_string(),
            session_id: session_id.to_string(),
            created_at: "2026-01-01T00:00:01.000Z".to_string(),
            payload,
        }
    }

    #[test]
    fn record_session_result_persists_sessions_and_events() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        let session = session("pi-1", "running");
        let idle = event(
            "evt-1",
            "session.status",
            "pi-1",
            json!({ "status": "idle" }),
        );

        record_session_result_at_path(&path, &session, std::slice::from_ref(&idle)).unwrap();
        let history = load_from_path(&path).unwrap();

        assert_eq!(history.sessions.len(), 1);
        assert_eq!(history.sessions[0].status, "idle");
        assert_eq!(history.events, vec![idle]);
    }

    #[test]
    fn record_event_updates_existing_session_status() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        record_session_result_at_path(&path, &session("pi-1", "running"), &[]).unwrap();

        record_event_at_path(
            &path,
            &event(
                "evt-2",
                "session.status",
                "pi-1",
                json!({ "status": "stopped" }),
            ),
        )
        .unwrap();
        let history = load_from_path(&path).unwrap();

        assert_eq!(history.sessions[0].status, "stopped");
        assert_eq!(history.events[0].id, "evt-2");
    }
}
