use super::*;
use std::sync::atomic::Ordering;

#[test]
fn default_state_starts_with_empty_sessions() {
    let state = PtyState::default();
    let sessions = state.sessions.read().unwrap();
    assert!(sessions.is_empty());
}

#[test]
fn default_state_starts_with_next_id_one() {
    let state = PtyState::default();
    assert_eq!(state.next_id.load(Ordering::Relaxed), 1);
}

#[test]
fn next_id_increments_monotonically() {
    let state = PtyState::default();
    let first = state.next_id.fetch_add(1, Ordering::Relaxed);
    let second = state.next_id.fetch_add(1, Ordering::Relaxed);
    assert_eq!(first, 1);
    assert_eq!(second, 2);
    assert!(second > first);
}

#[test]
fn next_id_never_returns_zero() {
    let state = PtyState::default();
    for _ in 0..10 {
        let id = state.next_id.fetch_add(1, Ordering::Relaxed);
        assert_ne!(id, 0, "session id must never be 0");
    }
}
