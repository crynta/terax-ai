use terax_lib::modules::pi::{PiPhase, PiState};

#[test]
fn default_state_is_disconnected() {
    let state = PiState::default();
    let snapshot = state.snapshot().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}

#[test]
fn start_marks_placeholder_runtime_ready() {
    let state = PiState::default();
    let snapshot = state.start_placeholder().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Ready);
    assert_eq!(snapshot.detail.as_deref(), Some("Placeholder Pi runtime"));
}

#[test]
fn snapshot_serializes_to_frontend_state_shape() {
    let state = PiState::default();
    let snapshot = state.start_placeholder().unwrap();
    let value = serde_json::to_value(snapshot).unwrap();

    assert_eq!(value["phase"], "ready");
    assert_eq!(value["detail"], "Placeholder Pi runtime");
}

#[test]
fn stop_resets_to_disconnected() {
    let state = PiState::default();
    state.start_placeholder().unwrap();
    let snapshot = state.stop().unwrap();

    assert_eq!(snapshot.phase, PiPhase::Disconnected);
    assert_eq!(snapshot.detail, None);
}
