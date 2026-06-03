use std::fs;
use std::path::Path;

use terax_lib::modules::pi::{PiPhase, PiSession, PiSessionEvent, PiSessionsList, PiState};

#[test]
fn default_state_is_disconnected() {
    let state = PiState::default();
    let snapshot = state.snapshot().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}

#[test]
fn start_marks_host_ready() {
    let state = PiState::default();
    let snapshot = state.start().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Ready);
    assert_eq!(snapshot.detail.as_deref(), Some("Pi host ready"));
    state.stop().unwrap();
}

#[test]
fn snapshot_serializes_to_frontend_state_shape() {
    let state = PiState::default();
    let snapshot = state.start().unwrap();
    let value = serde_json::to_value(snapshot).unwrap();

    assert_eq!(value["phase"], "ready");
    assert_eq!(value["detail"], "Pi host ready");
    state.stop().unwrap();
}

#[test]
fn host_info_reports_stub_capabilities() {
    let state = PiState::default();
    let info = state.info().unwrap();

    assert_eq!(info.host_version, "0.1.0");
    assert!(info.pi_sdk_loaded);
    assert!(info.pi_packages.iter().any(|pkg| {
        pkg.name == "@earendil-works/pi-coding-agent"
            && pkg.version.as_deref() == Some("0.78.0")
            && pkg.loaded
            && pkg.error.is_none()
    }));
    state.stop().unwrap();
}

#[test]
fn diagnostics_report_non_secret_runtime_state() {
    let state = PiState::default();
    let diagnostics = state
        .diagnostics_with_resource_dir_and_event_sink(None, None)
        .unwrap();

    assert_eq!(diagnostics.host_version, "0.1.0");
    assert!(diagnostics.pi_sdk_loaded);
    assert_eq!(diagnostics.config.tool_mode, "noTools");
    assert_eq!(diagnostics.capabilities.tools, false);
    assert_eq!(diagnostics.limits.max_prompt_chars, 20_000);
    assert!(diagnostics
        .protocol
        .allowed_methods
        .iter()
        .any(|method| method == "sessions.create"));
    assert!(diagnostics.manager.idle_shutdown_ms >= 1);
    assert!(diagnostics
        .manager
        .method_timeouts
        .iter()
        .any(|timeout| timeout.method == "sessions.create" && timeout.timeout_ms >= 45_000));
    assert!(diagnostics
        .config
        .api_keys
        .iter()
        .any(|key| key.name == "ANTHROPIC_API_KEY"));
    state.stop().unwrap();
}

#[test]
fn sessions_can_be_created_sent_and_stopped() {
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "hello from Rust");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());

    let created = state
        .session_create_with_resource_dir(None, Some("Test Pi".to_string()), Some(cwd.clone()))
        .unwrap();
    assert!(created.session.id.starts_with("pi_"));
    let session_id = created.session.id.clone();
    assert_eq!(created.session.title, "Test Pi");
    assert_eq!(created.session.cwd.as_deref(), Some(cwd.as_str()));
    assert_eq!(created.session.status, "idle");
    assert_eq!(created.events[0].event_type, "session.created");

    let sent = state
        .session_send_with_resource_dir(None, session_id.clone(), "hello".to_string(), None)
        .unwrap();
    assert!(sent.accepted);
    assert_eq!(sent.session.status, "running");
    assert_eq!(sent.session.last_prompt.as_deref(), Some("hello"));
    assert!(sent.events.iter().any(|event| {
        event.event_type == "session.status" && event.payload["status"] == "running"
    }));

    let stopped = state
        .session_stop_with_resource_dir(None, session_id.clone())
        .unwrap();
    assert_eq!(stopped.session.status, "idle");

    let sessions = state.sessions_list_with_resource_dir(None).unwrap();
    assert_eq!(sessions.sessions.len(), 1);
    assert_eq!(sessions.sessions[0].status, "idle");

    let follow_up = state
        .session_send_with_resource_dir(None, session_id, "again".to_string(), None)
        .unwrap();
    assert!(follow_up.accepted);
    assert_eq!(follow_up.session.status, "running");
    state.stop().unwrap();
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE");
}

fn write_history(path: &Path, session: PiSession, events: Vec<PiSessionEvent>) {
    let history = PiSessionsList {
        sessions: vec![session],
        events,
    };
    fs::write(path, serde_json::to_string_pretty(&history).unwrap()).unwrap();
}

fn read_history(path: &Path) -> PiSessionsList {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn stop_persists_running_sessions_as_stopped() {
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "slow ".repeat(80));
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND", "1");
    let state = PiState::default();
    let temp = tempfile::tempdir().unwrap();
    let history_path = temp.path().join("pi-sessions.json");
    state.set_history_path(Some(history_path.clone())).unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let created = state
        .session_create_with_resource_dir(None, Some("Manual Stop".to_string()), Some(cwd))
        .unwrap();
    let sent = state
        .session_send_with_resource_dir(None, created.session.id.clone(), "hello".to_string(), None)
        .unwrap();
    write_history(
        &history_path,
        sent.session,
        [created.events, sent.events].concat(),
    );

    state.stop().unwrap();
    let history = read_history(&history_path);

    assert_eq!(history.sessions[0].status, "stopped");
    assert!(history.events.iter().any(|event| {
        event.event_type == "session.status"
            && event.session_id == created.session.id
            && event.payload["status"] == "stopped"
    }));
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE");
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND");
}

#[test]
fn idle_shutdown_persists_idle_sessions_as_stopped() {
    let state = PiState::with_idle_shutdown_timeout(std::time::Duration::from_millis(75));
    let temp = tempfile::tempdir().unwrap();
    let history_path = temp.path().join("pi-sessions.json");
    state.set_history_path(Some(history_path.clone())).unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let created = state
        .session_create_with_resource_dir(None, Some("Idle Stop".to_string()), Some(cwd))
        .unwrap();
    write_history(&history_path, created.session.clone(), created.events);

    std::thread::sleep(std::time::Duration::from_millis(250));

    assert_eq!(state.snapshot().unwrap().phase, PiPhase::Disconnected);
    let history = read_history(&history_path);
    assert_eq!(history.sessions[0].status, "stopped");
    assert!(history.events.iter().any(|event| {
        event.event_type == "session.status"
            && event.session_id == created.session.id
            && event.payload["status"] == "stopped"
    }));
}

#[test]
fn idle_shutdown_stops_unused_started_host() {
    let state = PiState::with_idle_shutdown_timeout(std::time::Duration::from_millis(75));
    state.start().unwrap();

    std::thread::sleep(std::time::Duration::from_millis(250));

    let snapshot = state.snapshot().unwrap();
    assert_eq!(snapshot.phase, PiPhase::Disconnected);
}

#[test]
fn idle_shutdown_does_not_stop_running_sessions() {
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "slow ".repeat(80));
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND", "1");
    let state = PiState::with_idle_shutdown_timeout(std::time::Duration::from_millis(75));
    let temp = tempfile::tempdir().unwrap();
    let cwd = terax_lib::modules::fs::to_canon(temp.path());
    let created = state
        .session_create_with_resource_dir(None, Some("Long Pi".to_string()), Some(cwd))
        .unwrap();
    let session_id = created.session.id.clone();
    state
        .session_send_with_resource_dir(None, session_id.clone(), "hello".to_string(), None)
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(250));

    assert_eq!(state.snapshot().unwrap().phase, PiPhase::Ready);
    state.stop().unwrap();
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE");
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND");
}

#[test]
fn stop_resets_to_disconnected() {
    let state = PiState::default();
    state.start().unwrap();
    let snapshot = state.stop().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}
