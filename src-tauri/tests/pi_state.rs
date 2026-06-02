use terax_lib::modules::pi::{PiPhase, PiState};

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
fn sessions_can_be_created_sent_and_stopped() {
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE", "hello from Rust");
    let state = PiState::default();

    let created = state
        .session_create_with_resource_dir(None, Some("Test Pi".to_string()))
        .unwrap();
    assert_eq!(created.session.id, "pi-1");
    assert_eq!(created.session.title, "Test Pi");
    assert_eq!(created.session.status, "idle");
    assert_eq!(created.events[0].event_type, "session.created");

    let sent = state
        .session_send_with_resource_dir(None, "pi-1".to_string(), "hello".to_string())
        .unwrap();
    assert!(sent.accepted);
    assert_eq!(sent.session.status, "idle");
    assert_eq!(sent.session.last_prompt.as_deref(), Some("hello"));
    assert!(sent.events.iter().any(|event| {
        event.event_type == "session.output.delta" && event.payload["text"].is_string()
    }));

    let stopped = state
        .session_stop_with_resource_dir(None, "pi-1".to_string())
        .unwrap();
    assert_eq!(stopped.session.status, "stopped");

    let sessions = state.sessions_list_with_resource_dir(None).unwrap();
    assert_eq!(sessions.sessions.len(), 1);
    assert_eq!(sessions.sessions[0].status, "stopped");
    state.stop().unwrap();
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_RESPONSE");
}

#[test]
fn stop_resets_to_disconnected() {
    let state = PiState::default();
    state.start().unwrap();
    let snapshot = state.stop().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}
