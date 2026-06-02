use terax_lib::modules::pi::{PiPhase, PiState};

#[test]
fn default_state_is_disconnected() {
    let state = PiState::default();
    let snapshot = state.snapshot().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}

#[test]
fn start_marks_host_stub_ready() {
    let state = PiState::default();
    let snapshot = state.start().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Ready);
    assert_eq!(snapshot.detail.as_deref(), Some("Pi host stub"));
    state.stop().unwrap();
}

#[test]
fn snapshot_serializes_to_frontend_state_shape() {
    let state = PiState::default();
    let snapshot = state.start().unwrap();
    let value = serde_json::to_value(snapshot).unwrap();

    assert_eq!(value["phase"], "ready");
    assert_eq!(value["detail"], "Pi host stub");
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
fn stop_resets_to_disconnected() {
    let state = PiState::default();
    state.start().unwrap();
    let snapshot = state.stop().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}
