mod common;

use std::sync::{Arc, Mutex};

use common::env_guard::EnvVarGuard;
use terax_lib::modules::pi::{PiSessionEvent, PiState};

static PI_TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    PI_TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[allow(dead_code)]
struct CollectSink {
    events: Arc<Mutex<Vec<PiSessionEvent>>>,
    sink: Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static>,
}

impl CollectSink {
    fn new() -> Self {
        let events: Arc<Mutex<Vec<PiSessionEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = Arc::clone(&events);
        let sink: Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static> =
            Arc::new(move |event: PiSessionEvent| {
                events_clone
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push(event);
            });
        Self { events, sink }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn session_rename_updates_title_and_emits_event() {
    let _env_guard = lock_env();
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "ok");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let collector = CollectSink::new();

    let created = state
        .session_create_with_resource_dir_and_event_sink(
            None,
            Some(collector.sink.clone()),
            Some("Original Title".to_string()),
            Some(cwd),
        )
        .unwrap();
    assert_eq!(created.session.title, "Original Title");
    let session_id = created.session.id;

    let renamed = state
        .session_rename_with_resource_dir_and_event_sink(
            None,
            Some(collector.sink),
            session_id,
            "Renamed Title".to_string(),
        )
        .unwrap();
    assert_eq!(renamed.session.title, "Renamed Title");
    assert!(renamed.events.iter().any(|event| {
        event.event_type == "session.renamed" && event.payload["title"] == "Renamed Title"
    }));

    let sessions = state.sessions_list_with_resource_dir(None).unwrap();
    assert_eq!(sessions.sessions[0].title, "Renamed Title");
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn session_delete_removes_session_and_emits_deleted_event() {
    let _env_guard = lock_env();
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "ok");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let collector = CollectSink::new();

    let created = state
        .session_create_with_resource_dir_and_event_sink(
            None,
            Some(collector.sink.clone()),
            Some("To Delete".to_string()),
            Some(cwd),
        )
        .unwrap();
    let session_id_for_assert = created.session.id.clone();

    assert_eq!(
        state
            .sessions_list_with_resource_dir(None)
            .unwrap()
            .sessions
            .len(),
        1
    );

    let deleted = state
        .session_delete_with_resource_dir_and_event_sink(
            None,
            Some(collector.sink),
            created.session.id,
        )
        .unwrap();
    assert!(deleted.events.iter().any(|event| {
        event.event_type == "session.deleted" && event.session_id == session_id_for_assert
    }));

    assert!(state
        .sessions_list_with_resource_dir(None)
        .unwrap()
        .sessions
        .is_empty());
    state.stop().unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn multiple_sessions_can_coexist_independently() {
    let _env_guard = lock_env();
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "ok");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());

    let a = state
        .session_create_with_resource_dir(None, Some("Session A".to_string()), Some(cwd.clone()))
        .unwrap();
    let b = state
        .session_create_with_resource_dir(None, Some("Session B".to_string()), Some(cwd))
        .unwrap();

    assert_ne!(a.session.id, b.session.id);

    let sessions = state.sessions_list_with_resource_dir(None).unwrap();
    assert_eq!(sessions.sessions.len(), 2);

    let titles: Vec<&str> = sessions.sessions.iter().map(|s| s.title.as_str()).collect();
    assert!(titles.contains(&"Session A"));
    assert!(titles.contains(&"Session B"));

    state
        .session_delete_with_resource_dir(None, a.session.id)
        .unwrap();

    let remaining = state.sessions_list_with_resource_dir(None).unwrap();
    assert_eq!(remaining.sessions.len(), 1);
    assert_eq!(remaining.sessions[0].id, b.session.id);
    state.stop().unwrap();
}

#[test]
fn session_delete_for_unknown_id_returns_not_found_error() {
    let _env_guard = lock_env();
    let state = PiState::default();
    let error = state
        .session_delete_with_resource_dir(None, "pi_nonexistent".to_string())
        .unwrap_err();
    assert_eq!(error.code.as_deref(), Some("PI_SESSION_NOT_FOUND"));
}

#[tokio::test(flavor = "current_thread")]
async fn sessions_list_returns_empty_before_any_creates() {
    let _env_guard = lock_env();
    let state = PiState::default();
    let sessions = state.sessions_list_with_resource_dir(None).unwrap();
    assert!(sessions.sessions.is_empty());
    assert!(sessions.events.is_empty());
}

#[test]
fn session_send_to_unknown_session_returns_error() {
    let _env_guard = lock_env();
    let state = PiState::default();
    let error = state
        .session_send_with_resource_dir(
            None,
            "pi_nonexistent".to_string(),
            "hello".to_string(),
            None,
            None,
            None,
        )
        .unwrap_err();
    assert_eq!(error.code.as_deref(), Some("PI_SESSION_NOT_FOUND"));
}

#[tokio::test(flavor = "current_thread")]
async fn session_stop_marks_session_idle() {
    let _env_guard = lock_env();
    let slow_response = "slow ".repeat(80);
    let _faux_enable = EnvVarGuard::set("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    let _faux_response = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_RESPONSE", &slow_response);
    let _faux_tokens = EnvVarGuard::set("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND", "1");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());

    let created = state
        .session_create_with_resource_dir(None, Some("Stop Test".to_string()), Some(cwd))
        .unwrap();
    let session_id_for_assert = created.session.id.clone();

    state
        .session_send_with_resource_dir(
            None,
            created.session.id,
            "hello".to_string(),
            None,
            None,
            None,
        )
        .unwrap();

    let stopped = state
        .session_stop_with_resource_dir(None, session_id_for_assert.clone())
        .unwrap();
    assert_eq!(stopped.session.status, "idle");
    assert!(stopped.events.iter().any(|event| {
        event.event_type == "session.status"
            && event.session_id == session_id_for_assert
            && event.payload["status"] == "idle"
    }));
    state.stop().unwrap();
}
