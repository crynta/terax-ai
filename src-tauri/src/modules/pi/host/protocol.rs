use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;

use crate::modules::workspace::WorkspaceEnv;

use super::native_tools::{self, NativeToolRequest};
use super::timeouts::STDERR_TAIL_LIMIT;
use super::{PiCommandError, PiErrorData, PiPhase, PiRuntimeSnapshot, PiSessionEvent};

#[derive(Deserialize)]
pub(super) struct HostResponse<T> {
    pub(super) jsonrpc: String,
    pub(super) id: u64,
    pub(super) result: Option<T>,
    pub(super) error: Option<HostError>,
}

#[derive(Deserialize)]
pub(super) struct HostError {
    pub(super) code: i64,
    pub(super) message: String,
    pub(super) data: Option<PiErrorData>,
}

#[derive(Deserialize)]
pub(super) struct HostResponseEnvelope {
    pub(super) jsonrpc: String,
    pub(super) id: u64,
}

#[derive(Debug)]
pub(crate) enum HostCallError {
    Method {
        message: String,
        data: Option<PiErrorData>,
    },
    Transport(String),
}

impl std::fmt::Display for HostCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Method { message, .. } | Self::Transport(message) => write!(f, "{message}"),
        }
    }
}

impl HostCallError {
    pub(crate) fn message(self) -> String {
        match self {
            Self::Method { message, .. } | Self::Transport(message) => message,
        }
    }

    #[cfg(test)]
    pub(super) fn structured_data(&self) -> Option<&PiErrorData> {
        match self {
            Self::Method { data, .. } => data.as_ref(),
            Self::Transport(_) => None,
        }
    }

    pub(crate) fn into_command_error(self) -> PiCommandError {
        match self {
            Self::Method {
                message,
                data: Some(data),
            } => PiCommandError::with_data(message, data),
            Self::Method {
                message,
                data: None,
            }
            | Self::Transport(message) => PiCommandError::plain(message),
        }
    }

    pub(crate) fn is_transport(&self) -> bool {
        matches!(self, Self::Transport(_))
    }
}

#[derive(Deserialize)]
pub(super) struct HostNotification {
    pub(super) jsonrpc: String,
    pub(super) method: String,
    pub(super) params: PiSessionEvent,
}

#[derive(Deserialize)]
pub(super) struct HostRequest {
    pub(super) jsonrpc: String,
    pub(super) id: u64,
    pub(super) method: String,
    pub(super) params: Option<Value>,
}

#[derive(Deserialize)]
pub(super) struct PingResult {
    pub(super) pong: bool,
    #[serde(rename = "protocolVersion")]
    pub(super) protocol_version: Option<u32>,
}

#[derive(Deserialize)]
pub(super) struct ShutdownResult {
    pub(super) ok: bool,
}

#[derive(Deserialize)]
pub(super) struct HostStatus {
    pub(super) phase: PiPhase,
    pub(super) detail: Option<String>,
}

impl From<HostStatus> for PiRuntimeSnapshot {
    fn from(status: HostStatus) -> Self {
        Self {
            phase: status.phase,
            detail: status.detail,
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct StderrTail {
    inner: Arc<Mutex<String>>,
}

impl StderrTail {
    pub(super) fn push_lossy(&self, bytes: &[u8]) {
        let mut tail = match self.inner.lock() {
            Ok(tail) => tail,
            Err(_) => return,
        };
        tail.push_str(&String::from_utf8_lossy(bytes));
        if tail.len() <= STDERR_TAIL_LIMIT {
            return;
        }

        let min_start = tail.len() - STDERR_TAIL_LIMIT;
        let start = tail
            .char_indices()
            .map(|(index, _)| index)
            .find(|index| *index >= min_start)
            .unwrap_or(tail.len());
        tail.drain(..start);
    }

    pub(super) fn snapshot(&self) -> String {
        self.inner
            .lock()
            .map(|tail| tail.trim().to_string())
            .unwrap_or_default()
    }
}

pub(super) type PendingReceiver = mpsc::Receiver<Result<String, String>>;
type PendingSender = mpsc::Sender<Result<String, String>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct NativeToolSession {
    pub(super) cwd: PathBuf,
    pub(super) workspace_env: WorkspaceEnv,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) struct NativeToolApprovalKey {
    pub(super) session_id: String,
    pub(super) tool_call_id: String,
    pub(super) tool_name: String,
}

impl NativeToolApprovalKey {
    pub(super) fn new(session_id: &str, tool_call_id: &str, tool_name: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            tool_call_id: tool_call_id.to_string(),
            tool_name: tool_name.to_string(),
        }
    }

    pub(super) fn for_request(request: &NativeToolRequest) -> Self {
        Self::new(
            &request.session_id,
            &request.tool_call_id,
            &request.tool_name,
        )
    }
}

#[derive(Clone, Default)]
pub(super) struct NativeToolApprovals {
    pending: Arc<Mutex<HashMap<(String, String), String>>>,
    approved: Arc<Mutex<HashSet<NativeToolApprovalKey>>>,
}

impl NativeToolApprovals {
    pub(super) fn remember_pending(&self, session_id: &str, tool_call_id: &str, tool_name: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(
                (session_id.to_string(), tool_call_id.to_string()),
                tool_name.to_string(),
            );
        }
    }

    pub(super) fn approve_pending(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Option<NativeToolApprovalKey> {
        let tool_name = self.pending.lock().ok().and_then(|pending| {
            pending
                .get(&(session_id.to_string(), tool_call_id.to_string()))
                .cloned()
        })?;
        let key = NativeToolApprovalKey::new(session_id, tool_call_id, &tool_name);
        if let Ok(mut approved) = self.approved.lock() {
            approved.insert(key.clone());
        }
        Some(key)
    }

    pub(super) fn deny_pending(&self, session_id: &str, tool_call_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&(session_id.to_string(), tool_call_id.to_string()));
        }
    }

    pub(super) fn remove_approved(&self, key: &NativeToolApprovalKey) {
        if let Ok(mut approved) = self.approved.lock() {
            approved.remove(key);
        }
    }

    pub(super) fn consume_approved(&self, key: &NativeToolApprovalKey) -> bool {
        self.approved
            .lock()
            .map(|mut approved| approved.remove(key))
            .unwrap_or(false)
    }

    pub(super) fn forget_session(&self, session_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|(pending_session, _), _| pending_session != session_id);
        }
        if let Ok(mut approved) = self.approved.lock() {
            approved.retain(|key| key.session_id != session_id);
        }
    }
}

pub(super) type NativeToolSessions = Arc<Mutex<HashMap<String, NativeToolSession>>>;
pub(super) type NativeToolContextState = Arc<Mutex<native_tools::NativeToolContext>>;

#[derive(Clone, Default)]
pub(super) struct PendingResponses {
    inner: Arc<Mutex<HashMap<u64, PendingSender>>>,
}

impl PendingResponses {
    pub(super) fn register(&self, id: u64) -> PendingReceiver {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = self.inner.lock() {
            pending.insert(id, tx);
        }
        rx
    }

    pub(super) fn complete_response(&self, id: u64, line: String) -> bool {
        let sender = match self.inner.lock() {
            Ok(mut pending) => pending.remove(&id),
            Err(_) => None,
        };
        let Some(sender) = sender else {
            return false;
        };
        let _ = sender.send(Ok(line));
        true
    }

    pub(super) fn remove(&self, id: u64) {
        if let Ok(mut pending) = self.inner.lock() {
            pending.remove(&id);
        }
    }

    pub(super) fn fail_all(&self, error: String) {
        let senders = match self.inner.lock() {
            Ok(mut pending) => pending
                .drain()
                .map(|(_, sender)| sender)
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };
        for sender in senders {
            let _ = sender.send(Err(error.clone()));
        }
    }
}
