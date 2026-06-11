use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use super::{session_event_type, PiSession, PiSessionEvent, PiSessionsList};

const HISTORY_FILE_NAME: &str = "pi-sessions.json";
const TRANSCRIPTS_DIR_NAME: &str = "pi-transcripts";
const MAX_EVENTS: usize = 500;
const MAX_TRANSCRIPT_BYTES: usize = 10 * 1024 * 1024;

static HISTORY_LOCK: Mutex<()> = Mutex::new(());
static TRANSCRIPT_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn history_lock() -> Result<MutexGuard<'static, ()>, String> {
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

pub fn record_session_events(app: &AppHandle, events: &[PiSessionEvent]) -> Result<(), String> {
    record_session_events_at_path(&history_path(app)?, events)
}

pub fn record_event_at_path(path: &Path, event: &PiSessionEvent) -> Result<(), String> {
    record_session_events_at_path(path, std::slice::from_ref(event))
}

pub fn mark_unfinished_sessions_stopped(app: &AppHandle) -> Result<usize, String> {
    mark_unfinished_sessions_stopped_at_path(&history_path(app)?)
}

// ─── Canonical transcript persistence (webview agent) ───
// The webview Pi agent keeps its conversation in memory only. To resume, fork,
// or rollback a session across an app restart we persist its canonical
// `AgentMessage[]` transcript as an opaque JSON blob, one file per session.
// This is separate from the capped event log: the transcript is the lossless,
// provider-ready representation used to reconstruct the agent.

pub fn transcripts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(TRANSCRIPTS_DIR_NAME))
}

pub fn record_transcript(app: &AppHandle, session_id: &str, contents: &str) -> Result<(), String> {
    record_transcript_at_dir(&transcripts_dir(app)?, session_id, contents)
}

pub fn load_transcript(app: &AppHandle, session_id: &str) -> Result<Option<String>, String> {
    load_transcript_at_dir(&transcripts_dir(app)?, session_id)
}

pub fn delete_transcript(app: &AppHandle, session_id: &str) -> Result<(), String> {
    delete_transcript_at_dir(&transcripts_dir(app)?, session_id)
}

/// FNV-1a 64-bit, used only to disambiguate non-filesystem-safe session ids.
fn fnv1a64(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Maps a session id to a safe file name. Filesystem-safe ids (UUIDs, `fork_*`)
/// keep a stable readable name. Anything the sanitizer would alter (path
/// separators, `.`, empty) gets a deterministic hash of the *raw* id appended,
/// so two distinct ids can never collide onto the same transcript file.
fn transcript_file_name(session_id: &str) -> String {
    let safe: String = session_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();
    if !safe.is_empty() && safe == session_id {
        format!("{safe}.json")
    } else {
        let base = if safe.is_empty() { "session" } else { &safe };
        format!("{base}-{:016x}.json", fnv1a64(session_id))
    }
}

pub(super) fn record_transcript_at_dir(
    dir: &Path,
    session_id: &str,
    contents: &str,
) -> Result<(), String> {
    // The transcript is an opaque blob supplied by the webview. Bound it and
    // confirm it is well-formed JSON before persisting, so a malformed or
    // oversized payload can neither exhaust disk nor silently corrupt the
    // "lossless" history that resume/fork depend on.
    if contents.len() > MAX_TRANSCRIPT_BYTES {
        return Err(format!(
            "transcript exceeds the {MAX_TRANSCRIPT_BYTES} byte limit"
        ));
    }
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|e| format!("transcript is not valid JSON: {e}"))?;

    let _guard = TRANSCRIPT_LOCK.lock().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = transcript_file_name(session_id);
    let path = dir.join(&name);
    // Write to a temp file then atomically rename, so a crash mid-write can't
    // leave a truncated "lossless" transcript that resume would silently drop.
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub(super) fn load_transcript_at_dir(
    dir: &Path,
    session_id: &str,
) -> Result<Option<String>, String> {
    let path = dir.join(transcript_file_name(session_id));
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn delete_transcript_at_dir(dir: &Path, session_id: &str) -> Result<(), String> {
    let _guard = TRANSCRIPT_LOCK.lock().map_err(|e| e.to_string())?;
    let path = dir.join(transcript_file_name(session_id));
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn mark_unfinished_sessions_stopped_at_path(path: &Path) -> Result<usize, String> {
    mark_unfinished_sessions_stopped_at_path_with_timestamp(path, &now_iso_timestamp())
}

fn mark_unfinished_sessions_stopped_at_path_with_timestamp(
    path: &Path,
    created_at: &str,
) -> Result<usize, String> {
    let _guard = history_lock()?;
    let mut history = load_from_path(path)?;
    let mut events = Vec::new();

    for session in history
        .sessions
        .iter_mut()
        .filter(|session| matches!(session.status.as_str(), "idle" | "running"))
    {
        session.status = "stopped".to_string();
        session.updated_at = created_at.to_string();
        events.push(stopped_event(
            session.id.clone(),
            created_at,
            events.len() + 1,
        ));
    }

    let changed = events.len();
    if changed > 0 {
        append_events(&mut history.events, &events);
        save_to_path(path, &history)?;
    }
    Ok(changed)
}

fn stopped_event(session_id: String, created_at: &str, sequence: usize) -> PiSessionEvent {
    PiSessionEvent {
        id: format!(
            "evt_{}_{}_{}",
            event_id_component(created_at),
            sequence,
            event_id_component(&session_id)
        ),
        event_type: session_event_type::STATUS.to_string(),
        session_id,
        created_at: created_at.to_string(),
        payload: serde_json::json!({ "status": "stopped" }),
    }
}

pub(super) fn deleted_event(session_id: String) -> PiSessionEvent {
    let created_at = now_iso_timestamp();
    PiSessionEvent {
        id: format!(
            "evt_{}_delete_{}",
            event_id_component(&created_at),
            event_id_component(&session_id)
        ),
        event_type: session_event_type::DELETED.to_string(),
        session_id: session_id.clone(),
        created_at,
        payload: serde_json::json!({ "sessionId": session_id }),
    }
}

fn event_id_component(value: &str) -> String {
    let component: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    if component.is_empty() {
        "session".to_string()
    } else {
        component
    }
}

fn now_iso_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    epoch_millis_to_iso_utc(millis)
}

fn epoch_millis_to_iso_utc(epoch_millis: u128) -> String {
    let total_seconds = (epoch_millis / 1_000) as i64;
    let milliseconds = epoch_millis % 1_000;
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds:03}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let days = days_since_unix_epoch + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn record_session_result_at_path(
    path: &Path,
    session: &PiSession,
    events: &[PiSessionEvent],
) -> Result<(), String> {
    let _guard = history_lock()?;
    let mut history = load_from_path(path)?;
    let changed = upsert_session(&mut history.sessions, session.clone())
        | apply_events_to_history(&mut history, events);
    if changed {
        save_to_path(path, &history)?;
    }
    Ok(())
}

fn record_session_events_at_path(path: &Path, events: &[PiSessionEvent]) -> Result<(), String> {
    let _guard = history_lock()?;
    let mut history = load_from_path(path)?;
    if apply_events_to_history(&mut history, events) {
        save_to_path(path, &history)?;
    }
    Ok(())
}

pub(super) fn load_from_path(path: &Path) -> Result<PiSessionsList, String> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(PiSessionsList::default()),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn save_to_path(path: &Path, history: &PiSessionsList) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "session history path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let contents = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    // Write to a temp file then atomically rename so a crash mid-write cannot
    // truncate the session history (losing the last event or the whole list).
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "session history path has no file name".to_string())?;
    let tmp = parent.join(format!("{file_name}.tmp"));
    fs::write(&tmp, format!("{contents}\n")).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn upsert_session(sessions: &mut Vec<PiSession>, session: PiSession) -> bool {
    if let Some(index) = sessions.iter().position(|current| current.id == session.id) {
        if sessions[index] == session {
            return false;
        }
        sessions[index] = session;
        true
    } else {
        sessions.insert(0, session);
        true
    }
}

fn append_events(history_events: &mut Vec<PiSessionEvent>, events: &[PiSessionEvent]) {
    let mut known_ids: HashSet<String> = history_events.iter().map(|e| e.id.clone()).collect();
    for event in events {
        if known_ids.insert(event.id.clone()) {
            history_events.insert(0, event.clone());
        }
    }
    history_events.truncate(MAX_EVENTS);
}

fn apply_events_to_history(history: &mut PiSessionsList, events: &[PiSessionEvent]) -> bool {
    let mut known_event_ids = history
        .events
        .iter()
        .map(|event| event.id.clone())
        .collect::<HashSet<_>>();
    let events = events
        .iter()
        .filter(|event| known_event_ids.insert(event.id.clone()))
        .cloned()
        .collect::<Vec<_>>();
    if events.is_empty() {
        return false;
    }

    for event in &events {
        apply_event_to_sessions(&mut history.sessions, event);
        if event.event_type == session_event_type::DELETED {
            history
                .events
                .retain(|current| current.session_id != event.session_id);
        }
    }
    append_events(&mut history.events, &events);
    true
}

fn apply_event_to_sessions(sessions: &mut Vec<PiSession>, event: &PiSessionEvent) {
    if event.event_type == session_event_type::DELETED {
        sessions.retain(|session| session.id != event.session_id);
        return;
    }

    if matches!(
        event.event_type.as_str(),
        session_event_type::CREATED | session_event_type::RESUMED
    ) {
        if let Ok(session) = serde_json::from_value::<PiSession>(event.payload["session"].clone()) {
            upsert_session(sessions, session);
        }
        return;
    }

    let Some(session) = sessions
        .iter_mut()
        .find(|session| session.id == event.session_id)
    else {
        return;
    };

    if event.event_type == session_event_type::STATUS {
        if let Some(status) = event.payload["status"].as_str() {
            session.status = status.to_string();
            session.updated_at = event.created_at.clone();
        }
    }
    if event.event_type == session_event_type::RENAMED {
        if let Some(title) = event.payload["title"]
            .as_str()
            .filter(|title| !title.trim().is_empty())
        {
            session.title = title.trim().to_string();
            session.updated_at = event.created_at.clone();
        }
    }
    if event.event_type == session_event_type::ERROR {
        session.status = "error".to_string();
        session.updated_at = event.created_at.clone();
    }
    if event.event_type == session_event_type::ARCHIVED {
        session.archived_at = Some(event.created_at.clone());
        session.updated_at = event.created_at.clone();
    }
    if event.event_type == session_event_type::RESTORED {
        session.archived_at = None;
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
            workspace_env: None,
            thinking_level: None,
            sdk_session_file: None,
            archived_at: None,
            forked_from: None,
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
    fn record_created_event_materializes_session_snapshot() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        let session = session("pi-created", "idle");
        record_event_at_path(
            &path,
            &event(
                "evt-created",
                "session.created",
                "pi-created",
                json!({ "session": session }),
            ),
        )
        .unwrap();

        let history = load_from_path(&path).unwrap();

        assert_eq!(history.sessions.len(), 1);
        assert_eq!(history.sessions[0].id, "pi-created");
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

    #[test]
    fn duplicate_event_recording_is_a_persistence_noop() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        let idle = event(
            "evt-duplicate",
            "session.status",
            "pi-1",
            json!({ "status": "idle" }),
        );
        record_session_result_at_path(
            &path,
            &session("pi-1", "running"),
            std::slice::from_ref(&idle),
        )
        .unwrap();

        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();

        let result = record_event_at_path(&path, &idle);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o600);
            std::fs::set_permissions(&path, permissions).unwrap();
        }
        #[cfg(not(unix))]
        {
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_readonly(false);
            std::fs::set_permissions(&path, permissions).unwrap();
        }
        result.unwrap();
    }

    #[test]
    fn record_session_result_applies_rename_and_delete_events() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        let mut renamed = session("pi-1", "idle");
        renamed.title = "Renamed session".to_string();
        let renamed_event = event(
            "evt-rename",
            "session.renamed",
            "pi-1",
            json!({ "title": "Renamed session" }),
        );
        let deleted_event = event(
            "evt-delete",
            "session.deleted",
            "pi-1",
            json!({ "sessionId": "pi-1" }),
        );

        record_session_result_at_path(&path, &session("pi-1", "idle"), &[]).unwrap();
        record_session_result_at_path(&path, &renamed, std::slice::from_ref(&renamed_event))
            .unwrap();
        let history = load_from_path(&path).unwrap();
        assert_eq!(history.sessions[0].title, "Renamed session");

        record_session_result_at_path(&path, &renamed, std::slice::from_ref(&deleted_event))
            .unwrap();
        let history = load_from_path(&path).unwrap();
        assert!(history.sessions.is_empty());
        assert!(history
            .events
            .iter()
            .all(|event| event.session_id != "pi-1"
                || event.event_type == session_event_type::DELETED));
    }

    #[test]
    fn mark_unfinished_sessions_stopped_persists_status_events() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        for session in [
            session("pi-running", "running"),
            session("pi-idle", "idle"),
            session("pi-stopped", "stopped"),
            session("pi-error", "error"),
        ] {
            record_session_result_at_path(&path, &session, &[]).unwrap();
        }

        let changed = mark_unfinished_sessions_stopped_at_path_with_timestamp(
            &path,
            "2026-01-01T00:00:05.000Z",
        )
        .unwrap();
        let history = load_from_path(&path).unwrap();

        assert_eq!(changed, 2);
        assert_eq!(
            history
                .sessions
                .iter()
                .map(|session| (session.id.as_str(), session.status.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("pi-error", "error"),
                ("pi-stopped", "stopped"),
                ("pi-idle", "stopped"),
                ("pi-running", "stopped"),
            ]
        );
        let stopped_events = history
            .events
            .iter()
            .filter(|event| event.event_type == session_event_type::STATUS)
            .collect::<Vec<_>>();
        assert_eq!(stopped_events.len(), 2);
        assert!(stopped_events.iter().all(|event| {
            event.created_at == "2026-01-01T00:00:05.000Z"
                && event.payload == json!({ "status": "stopped" })
                && event.id.starts_with("evt_20260101t000005000z_")
        }));
        assert!(stopped_events
            .iter()
            .any(|event| event.session_id == "pi-running"));
        assert!(stopped_events
            .iter()
            .any(|event| event.session_id == "pi-idle"));
    }

    #[test]
    fn transcript_round_trips_through_disk() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("pi-transcripts");
        let blob = r#"{"version":1,"messages":[{"role":"user","content":"hi"}]}"#;

        assert_eq!(load_transcript_at_dir(&dir, "pi-1").unwrap(), None);

        record_transcript_at_dir(&dir, "pi-1", blob).unwrap();
        assert_eq!(
            load_transcript_at_dir(&dir, "pi-1").unwrap().as_deref(),
            Some(blob),
        );
    }

    #[test]
    fn record_transcript_overwrites_previous_blob() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("pi-transcripts");

        record_transcript_at_dir(&dir, "pi-1", r#""first""#).unwrap();
        record_transcript_at_dir(&dir, "pi-1", r#""second""#).unwrap();

        assert_eq!(
            load_transcript_at_dir(&dir, "pi-1").unwrap().as_deref(),
            Some(r#""second""#),
        );
    }

    #[test]
    fn record_transcript_rejects_non_json_and_oversized_blobs() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("pi-transcripts");

        let bad = record_transcript_at_dir(&dir, "pi-1", "not json").unwrap_err();
        assert!(bad.contains("not valid JSON"), "{bad}");

        let huge = format!("\"{}\"", "x".repeat(MAX_TRANSCRIPT_BYTES));
        let oversize = record_transcript_at_dir(&dir, "pi-1", &huge).unwrap_err();
        assert!(oversize.contains("byte limit"), "{oversize}");

        // Neither rejected write left a file behind.
        assert_eq!(load_transcript_at_dir(&dir, "pi-1").unwrap(), None);
    }

    #[test]
    fn delete_transcript_removes_the_blob() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("pi-transcripts");
        record_transcript_at_dir(&dir, "pi-1", r#""data""#).unwrap();

        delete_transcript_at_dir(&dir, "pi-1").unwrap();

        assert_eq!(load_transcript_at_dir(&dir, "pi-1").unwrap(), None);
        // Deleting a missing transcript is a no-op, not an error.
        delete_transcript_at_dir(&dir, "pi-1").unwrap();
    }

    #[test]
    fn transcript_file_names_do_not_collide_for_distinct_ids() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("pi-transcripts");
        // These both sanitize to "a_b" with the naive scheme — must NOT collide.
        record_transcript_at_dir(&dir, "a/b", r#""first""#).unwrap();
        record_transcript_at_dir(&dir, "a.b", r#""second""#).unwrap();

        assert_eq!(
            load_transcript_at_dir(&dir, "a/b").unwrap().as_deref(),
            Some(r#""first""#),
        );
        assert_eq!(
            load_transcript_at_dir(&dir, "a.b").unwrap().as_deref(),
            Some(r#""second""#),
        );
    }

    #[test]
    fn transcript_session_id_is_sanitized_against_path_traversal() {
        let temp = tempdir().unwrap();
        let dir = temp.path().join("pi-transcripts");

        // A hostile id must not escape the transcripts directory.
        record_transcript_at_dir(&dir, "../escape", r#""x""#).unwrap();

        assert!(!temp.path().join("escape.json").exists());
        assert_eq!(
            load_transcript_at_dir(&dir, "../escape")
                .unwrap()
                .as_deref(),
            Some(r#""x""#),
        );
    }

    #[test]
    fn mark_unfinished_sessions_stopped_is_idempotent() {
        let temp = tempdir().unwrap();
        let path = temp.path().join(HISTORY_FILE_NAME);
        record_session_result_at_path(&path, &session("pi-1", "running"), &[]).unwrap();

        assert_eq!(
            mark_unfinished_sessions_stopped_at_path_with_timestamp(
                &path,
                "2026-01-01T00:00:05.000Z",
            )
            .unwrap(),
            1
        );
        assert_eq!(
            mark_unfinished_sessions_stopped_at_path_with_timestamp(
                &path,
                "2026-01-01T00:00:06.000Z",
            )
            .unwrap(),
            0
        );
        let history = load_from_path(&path).unwrap();

        assert_eq!(history.sessions[0].status, "stopped");
        assert_eq!(history.events.len(), 1);
        assert_eq!(history.events[0].payload, json!({ "status": "stopped" }));
    }
}
