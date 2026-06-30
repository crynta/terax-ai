use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

const DEFAULT_AUDIT_CAPACITY: usize = 1_000;

/// Upper bound on a single audit entry's `message`. Tool results (especially
/// MCP responses) can be arbitrarily large; without this a misbehaving server
/// could bloat the in-memory ledger. Bounded at the ledger choke point so every
/// caller is protected regardless of how it builds the message.
const MAX_AUDIT_MESSAGE_LEN: usize = 4_096;

/// Truncate on a UTF-8 char boundary, appending a marker noting how much was
/// dropped. Returns the input unchanged when already within the limit.
fn bound_audit_message(message: String) -> String {
    if message.len() <= MAX_AUDIT_MESSAGE_LEN {
        return message;
    }
    // Find the largest char boundary <= the limit so we never split a codepoint.
    let mut end = MAX_AUDIT_MESSAGE_LEN;
    while end > 0 && !message.is_char_boundary(end) {
        end -= 1;
    }
    let dropped = message.len() - end;
    format!("{}… (truncated {dropped} bytes)", &message[..end])
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityAuditOutcome {
    Blocked,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityAuditEntry {
    pub sequence: u64,
    pub session_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub approved: bool,
    pub allowed: bool,
    pub outcome: CapabilityAuditOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl CapabilityAuditEntry {
    pub fn new(
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        approved: bool,
        allowed: bool,
        outcome: CapabilityAuditOutcome,
        message: Option<String>,
    ) -> Self {
        Self {
            sequence: 0,
            session_id: session_id.to_string(),
            tool_call_id: tool_call_id.to_string(),
            tool_name: tool_name.to_string(),
            approved,
            allowed,
            outcome,
            message,
        }
    }
}

#[derive(Clone)]
pub struct CapabilityAuditLog {
    capacity: usize,
    inner: Arc<Mutex<CapabilityAuditState>>,
}

#[derive(Default)]
struct CapabilityAuditState {
    next_sequence: u64,
    entries: VecDeque<CapabilityAuditEntry>,
}

impl Default for CapabilityAuditLog {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_AUDIT_CAPACITY)
    }
}

impl CapabilityAuditLog {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            inner: Arc::new(Mutex::new(CapabilityAuditState::default())),
        }
    }

    pub fn record(&self, mut entry: CapabilityAuditEntry) -> CapabilityAuditEntry {
        entry.message = entry.message.map(bound_audit_message);
        let Ok(mut state) = self.inner.lock() else {
            return entry;
        };
        state.next_sequence = state.next_sequence.saturating_add(1);
        entry.sequence = state.next_sequence;
        state.entries.push_back(entry.clone());
        while state.entries.len() > self.capacity {
            state.entries.pop_front();
        }
        entry
    }

    pub fn entries(&self) -> Vec<CapabilityAuditEntry> {
        self.inner
            .lock()
            .map(|state| state.entries.iter().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_assigns_ascending_sequences() {
        let log = CapabilityAuditLog::with_capacity(100);
        let e1 = log.record(CapabilityAuditEntry::new(
            "s1",
            "c1",
            "tool1",
            true,
            true,
            CapabilityAuditOutcome::Succeeded,
            None,
        ));
        let e2 = log.record(CapabilityAuditEntry::new(
            "s1",
            "c2",
            "tool2",
            false,
            false,
            CapabilityAuditOutcome::Blocked,
            Some("msg".into()),
        ));
        assert_eq!(e1.sequence, 1);
        assert_eq!(e2.sequence, 2);
        assert!(e1.sequence < e2.sequence);
    }

    #[test]
    fn entries_returns_all_recorded() {
        let log = CapabilityAuditLog::with_capacity(100);
        log.record(CapabilityAuditEntry::new(
            "s",
            "c",
            "t",
            true,
            true,
            CapabilityAuditOutcome::Succeeded,
            None,
        ));
        log.record(CapabilityAuditEntry::new(
            "s",
            "c",
            "t",
            false,
            false,
            CapabilityAuditOutcome::Failed,
            None,
        ));
        assert_eq!(log.entries().len(), 2);
    }

    #[test]
    fn capacity_drops_oldest() {
        let log = CapabilityAuditLog::with_capacity(3);
        for i in 0..5 {
            log.record(CapabilityAuditEntry::new(
                "s",
                &format!("c{i}"),
                "t",
                true,
                true,
                CapabilityAuditOutcome::Succeeded,
                None,
            ));
        }
        let entries = log.entries();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].tool_call_id, "c2");
        assert_eq!(entries[2].tool_call_id, "c4");
    }

    #[test]
    fn entry_new_sets_zero_sequence() {
        let entry = CapabilityAuditEntry::new(
            "s",
            "c",
            "t",
            true,
            false,
            CapabilityAuditOutcome::Blocked,
            Some("reason".into()),
        );
        assert_eq!(entry.sequence, 0);
        assert_eq!(entry.session_id, "s");
        assert_eq!(entry.tool_call_id, "c");
        assert_eq!(entry.tool_name, "t");
        assert!(entry.approved);
        assert!(!entry.allowed);
        assert_eq!(entry.outcome, CapabilityAuditOutcome::Blocked);
        assert_eq!(entry.message.as_deref(), Some("reason"));
    }

    #[test]
    fn default_capacity_is_used() {
        let log = CapabilityAuditLog::default();
        for i in 0..1100 {
            log.record(CapabilityAuditEntry::new(
                "s",
                &format!("c{i}"),
                "t",
                true,
                true,
                CapabilityAuditOutcome::Succeeded,
                None,
            ));
        }
        assert_eq!(log.entries().len(), 1000);
    }

    #[test]
    fn record_bounds_oversized_message() {
        let log = CapabilityAuditLog::with_capacity(4);
        let huge = "a".repeat(MAX_AUDIT_MESSAGE_LEN * 4);
        let recorded = log.record(CapabilityAuditEntry::new(
            "s",
            "c",
            "t",
            true,
            true,
            CapabilityAuditOutcome::Failed,
            Some(huge),
        ));
        let message = recorded.message.expect("message present");
        assert!(message.len() <= MAX_AUDIT_MESSAGE_LEN + 32);
        assert!(message.contains("truncated"));
    }

    #[test]
    fn record_preserves_small_message_and_utf8() {
        let log = CapabilityAuditLog::with_capacity(4);
        let recorded = log.record(CapabilityAuditEntry::new(
            "s",
            "c",
            "t",
            true,
            true,
            CapabilityAuditOutcome::Succeeded,
            Some("café ☕ ok".into()),
        ));
        assert_eq!(recorded.message.as_deref(), Some("café ☕ ok"));
    }

    #[test]
    fn bound_audit_message_respects_char_boundaries() {
        // A string of multi-byte chars longer than the limit must not panic and
        // must remain valid UTF-8 after truncation.
        let s = "☕".repeat(MAX_AUDIT_MESSAGE_LEN);
        let bounded = bound_audit_message(s);
        assert!(bounded.len() <= MAX_AUDIT_MESSAGE_LEN + 32);
        assert!(bounded.contains("truncated"));
    }

    #[test]
    fn with_capacity_minimum_is_one() {
        let log = CapabilityAuditLog::with_capacity(0);
        log.record(CapabilityAuditEntry::new(
            "s",
            "c",
            "t",
            true,
            true,
            CapabilityAuditOutcome::Succeeded,
            None,
        ));
        assert_eq!(log.entries().len(), 1);
    }
}
