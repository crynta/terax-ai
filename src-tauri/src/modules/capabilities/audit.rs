use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

const DEFAULT_AUDIT_CAPACITY: usize = 1_000;

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
