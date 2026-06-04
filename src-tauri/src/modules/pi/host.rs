use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::modules::workspace::WorkspaceEnv;

use super::native_tools::{self, NativeToolRequest};
use super::{
    PiCommandError, PiDiagnostics, PiErrorData, PiHostInfo, PiMethodTimeoutDiagnostics, PiPhase,
    PiProfileModelsList, PiPromptContext, PiResolvedProviderConfig, PiRuntimeSnapshot,
    PiSessionCreateResult, PiSessionDeleteResult, PiSessionEvent, PiSessionRenameResult,
    PiSessionResumeResult, PiSessionSendResult, PiSessionStopResult, PiSessionToolRespondResult,
    PiSessionsList,
};

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const STDERR_TAIL_LIMIT: usize = 4096;

#[derive(Clone)]
struct RequestTimeouts {
    fallback: Duration,
    ping: Duration,
    status: Duration,
    info: Duration,
    diagnostics: Duration,
    models_list: Duration,
    sessions_list: Duration,
    sessions_create: Duration,
    sessions_send: Duration,
    sessions_resume: Duration,
    sessions_tool_respond: Duration,
    sessions_rename: Duration,
    sessions_delete: Duration,
    sessions_stop: Duration,
    shutdown: Duration,
}

impl RequestTimeouts {
    fn production() -> Self {
        Self {
            fallback: DEFAULT_REQUEST_TIMEOUT,
            ping: Duration::from_secs(3),
            status: Duration::from_secs(3),
            info: Duration::from_secs(5),
            diagnostics: Duration::from_secs(30),
            models_list: Duration::from_secs(30),
            sessions_list: Duration::from_secs(5),
            sessions_create: Duration::from_secs(60),
            sessions_send: DEFAULT_REQUEST_TIMEOUT,
            sessions_resume: Duration::from_secs(60),
            sessions_tool_respond: Duration::from_secs(10),
            sessions_rename: Duration::from_secs(5),
            sessions_delete: Duration::from_secs(10),
            sessions_stop: Duration::from_secs(10),
            shutdown: Duration::from_secs(10),
        }
    }

    #[cfg(test)]
    fn uniform(timeout: Duration) -> Self {
        Self {
            fallback: timeout,
            ping: timeout,
            status: timeout,
            info: timeout,
            diagnostics: timeout,
            models_list: timeout,
            sessions_list: timeout,
            sessions_create: timeout,
            sessions_send: timeout,
            sessions_resume: timeout,
            sessions_tool_respond: timeout,
            sessions_rename: timeout,
            sessions_delete: timeout,
            sessions_stop: timeout,
            shutdown: timeout,
        }
    }

    #[cfg(test)]
    fn for_tests(timeout: Duration) -> Self {
        Self::uniform(timeout)
    }

    #[cfg(test)]
    fn with_method(mut self, method: &str, timeout: Duration) -> Self {
        match method {
            "ping" => self.ping = timeout,
            "status" => self.status = timeout,
            "info" => self.info = timeout,
            "diagnostics" => self.diagnostics = timeout,
            "models.list" => self.models_list = timeout,
            "sessions.list" => self.sessions_list = timeout,
            "sessions.create" => self.sessions_create = timeout,
            "sessions.send" => self.sessions_send = timeout,
            "sessions.resume" => self.sessions_resume = timeout,
            "sessions.tool.respond" => self.sessions_tool_respond = timeout,
            "sessions.rename" => self.sessions_rename = timeout,
            "sessions.delete" => self.sessions_delete = timeout,
            "sessions.stop" => self.sessions_stop = timeout,
            "shutdown" => self.shutdown = timeout,
            _ => self.fallback = timeout,
        }
        self
    }

    fn for_method(&self, method: &str) -> Duration {
        match method {
            "ping" => self.ping,
            "status" => self.status,
            "info" => self.info,
            "diagnostics" => self.diagnostics,
            "models.list" => self.models_list,
            "sessions.list" => self.sessions_list,
            "sessions.create" => self.sessions_create,
            "sessions.send" => self.sessions_send,
            "sessions.resume" => self.sessions_resume,
            "sessions.tool.respond" => self.sessions_tool_respond,
            "sessions.rename" => self.sessions_rename,
            "sessions.delete" => self.sessions_delete,
            "sessions.stop" => self.sessions_stop,
            "shutdown" => self.shutdown,
            _ => self.fallback,
        }
    }

    fn diagnostics(&self) -> Vec<PiMethodTimeoutDiagnostics> {
        [
            "ping",
            "status",
            "info",
            "diagnostics",
            "models.list",
            "sessions.list",
            "sessions.create",
            "sessions.send",
            "sessions.resume",
            "sessions.tool.respond",
            "sessions.rename",
            "sessions.delete",
            "sessions.stop",
            "shutdown",
        ]
        .into_iter()
        .map(|method| PiMethodTimeoutDiagnostics {
            method: method.to_string(),
            timeout_ms: self.for_method(method).as_millis() as u64,
        })
        .collect()
    }
}
const HOST_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SHELL",
    "PI_CODING_AGENT_DIR",
    "TERAX_PI_NODE_MODULES",
];

const HOST_TEST_FAUX_ENV_ALLOWLIST: &[&str] = &[
    "TERAX_PI_HOST_ENABLE_TEST_FAUX",
    "TERAX_PI_HOST_TEST_FAUX_RESPONSE",
    "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
    "TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND",
    "TERAX_PI_HOST_TEST_FAUX_REASONING",
];

pub type PiSessionEventSink = Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static>;

#[derive(Deserialize)]
struct HostResponse<T> {
    jsonrpc: String,
    id: u64,
    result: Option<T>,
    error: Option<HostError>,
}

#[derive(Deserialize)]
struct HostError {
    code: i64,
    message: String,
    data: Option<PiErrorData>,
}

#[derive(Deserialize)]
struct HostResponseEnvelope {
    jsonrpc: String,
    id: u64,
}

#[derive(Debug)]
pub(super) enum HostCallError {
    Method {
        message: String,
        data: Option<PiErrorData>,
    },
    Transport(String),
}

impl HostCallError {
    pub(super) fn message(self) -> String {
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

    pub(super) fn into_command_error(self) -> PiCommandError {
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

    pub(super) fn is_transport(&self) -> bool {
        matches!(self, Self::Transport(_))
    }
}

#[derive(Deserialize)]
struct HostNotification {
    jsonrpc: String,
    method: String,
    params: PiSessionEvent,
}

#[derive(Deserialize)]
struct HostRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    params: Option<Value>,
}

#[derive(Deserialize)]
struct PingResult {
    pong: bool,
}

#[derive(Deserialize)]
struct ShutdownResult {
    ok: bool,
}

#[derive(Deserialize)]
struct HostStatus {
    phase: PiPhase,
    detail: Option<String>,
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
struct StderrTail {
    inner: Arc<Mutex<String>>,
}

impl StderrTail {
    fn push_lossy(&self, bytes: &[u8]) {
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

    fn snapshot(&self) -> String {
        self.inner
            .lock()
            .map(|tail| tail.trim().to_string())
            .unwrap_or_default()
    }
}

type PendingReceiver = mpsc::Receiver<Result<String, String>>;
type PendingSender = mpsc::Sender<Result<String, String>>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct NativeToolSession {
    cwd: PathBuf,
    workspace_env: WorkspaceEnv,
}

type NativeToolSessions = Arc<Mutex<HashMap<String, NativeToolSession>>>;

#[derive(Clone, Default)]
struct PendingResponses {
    inner: Arc<Mutex<HashMap<u64, PendingSender>>>,
}

impl PendingResponses {
    fn register(&self, id: u64) -> PendingReceiver {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = self.inner.lock() {
            pending.insert(id, tx);
        }
        rx
    }

    fn complete_response(&self, id: u64, line: String) -> bool {
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

    fn remove(&self, id: u64) {
        if let Ok(mut pending) = self.inner.lock() {
            pending.remove(&id);
        }
    }

    fn fail_all(&self, error: String) {
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

pub struct PiHost {
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingResponses,
    native_tool_sessions: NativeToolSessions,
    stderr_tail: StderrTail,
    request_timeouts: RequestTimeouts,
    next_id: AtomicU64,
}

impl PiHost {
    pub fn spawn_with_event_sink(
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Self, String> {
        let host_path = resolve_host_path(resource_dir)?;
        Self::spawn_inner_with_timeouts(
            node_binary(resource_dir),
            host_path,
            RequestTimeouts::production(),
            event_sink,
        )
    }

    #[cfg(test)]
    fn spawn_inner(
        node_binary: PathBuf,
        host_path: PathBuf,
        request_timeout: Duration,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Self, String> {
        Self::spawn_inner_with_timeouts(
            node_binary,
            host_path,
            RequestTimeouts::uniform(request_timeout),
            event_sink,
        )
    }

    fn spawn_inner_with_timeouts(
        node_binary: PathBuf,
        host_path: PathBuf,
        request_timeouts: RequestTimeouts,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Self, String> {
        let mut command = Command::new(node_binary);
        command
            .arg(host_path)
            .env_clear()
            .envs(host_environment())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to start Pi host: {e}"))?;

        let stdin = child.stdin.take().ok_or_else(|| {
            let _ = child.kill();
            "Pi host stdin unavailable".to_string()
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            let _ = child.kill();
            "Pi host stdout unavailable".to_string()
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            let _ = child.kill();
            "Pi host stderr unavailable".to_string()
        })?;

        let stderr_tail = StderrTail::default();
        let pending = PendingResponses::default();
        let stdin = Arc::new(Mutex::new(stdin));
        let native_tool_sessions = Arc::new(Mutex::new(HashMap::new()));
        spawn_stderr_reader(stderr, stderr_tail.clone());
        spawn_stdout_reader(
            stdout,
            pending.clone(),
            Arc::clone(&stdin),
            Arc::clone(&native_tool_sessions),
            event_sink,
        );

        let host = Self {
            child: Mutex::new(child),
            stdin,
            pending,
            native_tool_sessions,
            stderr_tail,
            request_timeouts,
            next_id: AtomicU64::new(1),
        };
        let ping: PingResult = host.call("ping").map_err(HostCallError::message)?;
        if !ping.pong {
            return Err("Pi host ping failed".to_string());
        }
        Ok(host)
    }

    pub fn status(&self) -> Result<PiRuntimeSnapshot, HostCallError> {
        let status: HostStatus = self.call("status")?;
        Ok(status.into())
    }

    pub fn info(&self) -> Result<PiHostInfo, HostCallError> {
        self.call("info")
    }

    pub fn diagnostics(&self) -> Result<PiDiagnostics, HostCallError> {
        let mut diagnostics: PiDiagnostics = self.call("diagnostics")?;
        diagnostics.manager.method_timeouts = self.request_timeouts.diagnostics();
        Ok(diagnostics)
    }

    pub fn sessions_list(&self) -> Result<PiSessionsList, HostCallError> {
        self.call("sessions.list")
    }

    pub fn has_running_sessions(&self) -> Result<bool, HostCallError> {
        Ok(self
            .sessions_list()?
            .sessions
            .iter()
            .any(|session| session.status == "running"))
    }

    pub fn models_list(
        &self,
        profile_agent_dir: String,
    ) -> Result<PiProfileModelsList, HostCallError> {
        self.call_with_params(
            "models.list",
            json!({ "profileAgentDir": profile_agent_dir }),
        )
    }

    pub fn session_create(
        &self,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
        session_dir: Option<String>,
        workspace_env: WorkspaceEnv,
    ) -> Result<PiSessionCreateResult, HostCallError> {
        let result: PiSessionCreateResult = self.call_with_params(
            "sessions.create",
            json!({
                "title": title,
                "cwd": cwd,
                "providerConfig": provider_config,
                "sessionDir": session_dir,
                "workspaceEnv": workspace_env,
            }),
        )?;
        self.remember_native_tool_session(
            &result.session.id,
            result.session.cwd.as_deref(),
            workspace_env,
        );
        Ok(result)
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Pi resume forwards persisted session metadata to the sidecar"
    )]
    pub fn session_resume(
        &self,
        session_id: String,
        title: String,
        cwd: String,
        sdk_session_file: String,
        session_dir: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
        created_at: Option<String>,
        last_prompt: Option<String>,
        thinking_level: Option<String>,
        workspace_env: WorkspaceEnv,
    ) -> Result<PiSessionResumeResult, HostCallError> {
        let result: PiSessionResumeResult = self.call_with_params(
            "sessions.resume",
            json!({
                "sessionId": session_id,
                "title": title,
                "cwd": cwd,
                "sdkSessionFile": sdk_session_file,
                "sessionDir": session_dir,
                "providerConfig": provider_config,
                "createdAt": created_at,
                "lastPrompt": last_prompt,
                "thinkingLevel": thinking_level,
                "workspaceEnv": workspace_env,
            }),
        )?;
        self.remember_native_tool_session(
            &result.session.id,
            result.session.cwd.as_deref(),
            workspace_env,
        );
        Ok(result)
    }

    pub fn session_send(
        &self,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
        regenerate_branch_group_id: Option<String>,
        thinking_level: Option<String>,
    ) -> Result<PiSessionSendResult, HostCallError> {
        self.call_with_params(
            "sessions.send",
            json!({
                "sessionId": session_id,
                "prompt": prompt,
                "context": context,
                "regenerateBranchGroupId": regenerate_branch_group_id,
                "thinkingLevel": thinking_level,
            }),
        )
    }

    pub fn session_tool_respond(
        &self,
        session_id: String,
        tool_call_id: String,
        approved: bool,
    ) -> Result<PiSessionToolRespondResult, HostCallError> {
        self.call_with_params(
            "sessions.tool.respond",
            json!({
                "sessionId": session_id,
                "toolCallId": tool_call_id,
                "approved": approved,
            }),
        )
    }

    pub fn session_rename(
        &self,
        session_id: String,
        title: String,
    ) -> Result<PiSessionRenameResult, HostCallError> {
        self.call_with_params(
            "sessions.rename",
            json!({ "sessionId": session_id, "title": title }),
        )
    }

    pub fn session_delete(
        &self,
        session_id: String,
    ) -> Result<PiSessionDeleteResult, HostCallError> {
        let result =
            self.call_with_params("sessions.delete", json!({ "sessionId": session_id }))?;
        self.forget_native_tool_session(&session_id);
        Ok(result)
    }

    pub fn session_stop(&self, session_id: String) -> Result<PiSessionStopResult, HostCallError> {
        self.call_with_params("sessions.stop", json!({ "sessionId": session_id }))
    }

    pub fn shutdown(&self) {
        let result = self.call::<ShutdownResult>("shutdown");
        if !matches!(result, Ok(ShutdownResult { ok: true })) {
            self.kill_child();
        }
        self.wait_or_kill();
    }

    fn call<T: DeserializeOwned>(&self, method: &str) -> Result<T, HostCallError> {
        self.call_json(method, None)
    }

    fn call_with_params<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T, HostCallError> {
        self.call_json(method, Some(params))
    }

    fn call_json<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<T, HostCallError> {
        self.ensure_running()?;

        let id = self.next_request_id();
        let response_rx = self.pending.register(id);
        let write_result = self.write_request(id, method, params);
        if let Err(error) = write_result {
            self.pending.remove(id);
            return Err(error);
        }

        let request_timeout = self.request_timeouts.for_method(method);
        let line = match response_rx.recv_timeout(request_timeout) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(HostCallError::Transport(self.with_stderr(error))),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.remove(id);
                self.kill_child();
                return Err(HostCallError::Transport(self.with_stderr(format!(
                    "Pi host request `{method}` timed out after {}ms",
                    request_timeout.as_millis()
                ))));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(HostCallError::Transport(
                    self.with_stderr("Pi host response reader stopped".to_string()),
                ));
            }
        };

        let response: HostResponse<T> = serde_json::from_str(line.trim_end()).map_err(|e| {
            HostCallError::Transport(
                self.with_stderr(format!("Pi host response was not valid JSON: {e}")),
            )
        })?;
        if response.jsonrpc != "2.0" || response.id != id {
            return Err(HostCallError::Transport(
                self.with_stderr("Pi host response id mismatch".to_string()),
            ));
        }
        if let Some(error) = response.error {
            return Err(HostCallError::Method {
                message: self
                    .with_stderr(format!("Pi host error {}: {}", error.code, error.message)),
                data: error.data,
            });
        }
        response.result.ok_or_else(|| {
            HostCallError::Transport(self.with_stderr("Pi host response had no result".to_string()))
        })
    }

    fn next_request_id(&self) -> u64 {
        self.next_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                Some(current.checked_add(1).unwrap_or(1))
            })
            .unwrap_or(1)
    }

    fn remember_native_tool_session(
        &self,
        session_id: &str,
        cwd: Option<&str>,
        workspace_env: WorkspaceEnv,
    ) {
        let Some(cwd) = cwd else {
            return;
        };
        let canonical = std::fs::canonicalize(cwd).unwrap_or_else(|_| PathBuf::from(cwd));
        if let Ok(mut sessions) = self.native_tool_sessions.lock() {
            sessions.insert(
                session_id.to_string(),
                NativeToolSession {
                    cwd: canonical,
                    workspace_env,
                },
            );
        }
    }

    fn forget_native_tool_session(&self, session_id: &str) {
        if let Ok(mut sessions) = self.native_tool_sessions.lock() {
            sessions.remove(session_id);
        }
    }

    fn write_request(
        &self,
        id: u64,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), HostCallError> {
        let mut request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        if let Some(params) = params {
            request["params"] = params;
        }
        let request = serde_json::to_string(&request).map_err(|e| {
            HostCallError::Transport(self.with_stderr(format!("Pi host request failed: {e}")))
        })?;
        let mut stdin = self.stdin.lock().map_err(|e| {
            HostCallError::Transport(self.with_stderr(format!("Pi host stdin lock failed: {e}")))
        })?;
        stdin
            .write_all(request.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| {
                HostCallError::Transport(self.with_stderr(format!("Pi host write failed: {e}")))
            })
    }

    fn ensure_running(&self) -> Result<(), HostCallError> {
        let mut child = self.child.lock().map_err(|e| {
            HostCallError::Transport(self.with_stderr(format!("Pi host child lock failed: {e}")))
        })?;
        match child.try_wait() {
            Ok(Some(status)) => Err(HostCallError::Transport(
                self.with_stderr(format!("Pi host exited with {status}")),
            )),
            Ok(None) => Ok(()),
            Err(error) => Err(HostCallError::Transport(
                self.with_stderr(format!("Pi host status check failed: {error}")),
            )),
        }
    }

    fn with_stderr(&self, message: String) -> String {
        let stderr = self.stderr_tail.snapshot();
        if stderr.is_empty() {
            message
        } else {
            format!("{message}; stderr: {stderr}")
        }
    }

    fn kill_child(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }

    fn wait_or_kill(&self) {
        let Ok(mut child) = self.child.lock() else {
            return;
        };
        for _ in 0..20 {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => return,
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for PiHost {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn session_event_notification(line: &str) -> Option<PiSessionEvent> {
    let notification = serde_json::from_str::<HostNotification>(line.trim_end()).ok()?;
    if notification.jsonrpc == "2.0" && notification.method == "session.event" {
        Some(notification.params)
    } else {
        None
    }
}

fn response_id(line: &str) -> Result<Option<u64>, String> {
    let value: Value = serde_json::from_str(line.trim_end())
        .map_err(|error| format!("Pi host response was not valid JSON: {error}"))?;
    if value.get("method").is_some() {
        return Ok(None);
    }
    let envelope: HostResponseEnvelope = serde_json::from_value(value)
        .map_err(|error| format!("Pi host response envelope was invalid: {error}"))?;
    if envelope.jsonrpc != "2.0" {
        return Err("Pi host response envelope had invalid jsonrpc version".to_string());
    }
    Ok(Some(envelope.id))
}

fn host_request(line: &str) -> Result<Option<HostRequest>, String> {
    let value: Value = serde_json::from_str(line.trim_end())
        .map_err(|error| format!("Pi host protocol message was not valid JSON: {error}"))?;
    if value.get("method").is_none() || value.get("id").is_none() {
        return Ok(None);
    }
    let request = serde_json::from_value::<HostRequest>(value)
        .map_err(|error| format!("Pi host request envelope was invalid: {error}"))?;
    if request.jsonrpc != "2.0" {
        return Err("Pi host request envelope had invalid jsonrpc version".to_string());
    }
    Ok(Some(request))
}

fn handle_host_request(
    stdin: &Arc<Mutex<ChildStdin>>,
    native_tool_sessions: &NativeToolSessions,
    request: HostRequest,
) {
    let stdin = Arc::clone(stdin);
    let native_tool_sessions = Arc::clone(native_tool_sessions);
    thread::spawn(move || {
        let response = host_request_response(&native_tool_sessions, request);
        if let Err(error) = write_host_response(&stdin, response) {
            log::warn!("failed to write Pi host response: {error}");
        }
    });
}

fn host_request_response(native_tool_sessions: &NativeToolSessions, request: HostRequest) -> Value {
    match request.method.as_str() {
        "nativeTools.execute" => {
            let params = request.params.unwrap_or(Value::Null);
            match serde_json::from_value::<NativeToolRequest>(params)
                .map_err(|error| format!("invalid nativeTools.execute params: {error}"))
                .and_then(|request| execute_verified_native_tool(native_tool_sessions, request))
            {
                Ok(result) => json!({ "jsonrpc": "2.0", "id": request.id, "result": result }),
                Err(message) => json!({
                    "jsonrpc": "2.0",
                    "id": request.id,
                    "error": { "code": -32020, "message": message }
                }),
            }
        }
        method => json!({
            "jsonrpc": "2.0",
            "id": request.id,
            "error": {
                "code": -32601,
                "message": format!("unknown Pi host request method: {method}")
            }
        }),
    }
}

fn execute_verified_native_tool(
    native_tool_sessions: &NativeToolSessions,
    request: NativeToolRequest,
) -> Result<native_tools::NativeToolResult, String> {
    if request.session_id.trim().is_empty() {
        return Err("native tool request requires a sessionId".to_string());
    }
    if request.tool_call_id.trim().is_empty() {
        return Err("native tool request requires a toolCallId".to_string());
    }
    let expected = native_tool_sessions
        .lock()
        .map_err(|error| format!("native tool session registry lock failed: {error}"))?
        .get(&request.session_id)
        .cloned()
        .ok_or_else(|| {
            format!(
                "native tool request came from unknown session: {}",
                request.session_id
            )
        })?;
    let requested_cwd = std::fs::canonicalize(&request.cwd)
        .map_err(|error| format!("native tool cwd is not accessible: {error}"))?;
    if requested_cwd != expected.cwd {
        return Err(format!(
            "native tool cwd does not match the Rust-authorized session workspace: {}",
            expected.cwd.display()
        ));
    }
    let requested_workspace_env = request.workspace_env.clone().unwrap_or_default();
    if requested_workspace_env != expected.workspace_env {
        return Err("native tool workspace env does not match the Rust-authorized session".to_string());
    }
    native_tools::execute(request)
}

fn write_host_response(stdin: &Arc<Mutex<ChildStdin>>, response: Value) -> Result<(), String> {
    let response = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    let mut stdin = stdin
        .lock()
        .map_err(|error| format!("Pi host stdin lock failed: {error}"))?;
    stdin
        .write_all(response.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Pi host response write failed: {error}"))
}

fn spawn_stdout_reader(
    stdout: ChildStdout,
    pending: PendingResponses,
    stdin: Arc<Mutex<ChildStdin>>,
    native_tool_sessions: NativeToolSessions,
    event_sink: Option<PiSessionEventSink>,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    pending.fail_all("Pi host closed stdout".to_string());
                    break;
                }
                Ok(_) => {
                    if let Some(event) = session_event_notification(&line) {
                        if let Some(event_sink) = event_sink.as_ref() {
                            event_sink(event);
                        }
                        continue;
                    }
                    match host_request(&line) {
                        Ok(Some(request)) => {
                            handle_host_request(&stdin, &native_tool_sessions, request);
                            continue;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            pending.fail_all(error);
                            continue;
                        }
                    }
                    match response_id(&line) {
                        Ok(Some(id)) => {
                            let _ = pending.complete_response(id, line);
                        }
                        Ok(None) => pending.fail_all(
                            "Pi host protocol message was neither response nor notification"
                                .to_string(),
                        ),
                        Err(error) => pending.fail_all(error),
                    }
                }
                Err(error) => {
                    pending.fail_all(format!("Pi host read failed: {error}"));
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(mut stderr: ChildStderr, tail: StderrTail) {
    thread::spawn(move || {
        let mut buffer = [0; 1024];
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => tail.push_lossy(&buffer[..read]),
                Err(_) => break,
            }
        }
    });
}

fn host_environment() -> Vec<(String, String)> {
    let mut names = HOST_ENV_ALLOWLIST.to_vec();
    if host_test_faux_enabled() {
        names.extend_from_slice(HOST_TEST_FAUX_ENV_ALLOWLIST);
    }
    names
        .iter()
        .filter_map(|name| {
            env::var(name)
                .ok()
                .map(|value| ((*name).to_string(), value))
        })
        .collect()
}

fn host_test_faux_enabled() -> bool {
    (cfg!(test) || cfg!(debug_assertions))
        && env::var("TERAX_PI_HOST_ENABLE_TEST_FAUX").as_deref() == Ok("1")
}

fn node_binary(resource_dir: Option<&Path>) -> PathBuf {
    if let Ok(path) = env::var("TERAX_NODE_BINARY") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    select_usable_node_binary(node_binary_candidates(resource_dir))
        .unwrap_or_else(|| PathBuf::from("node"))
}

fn select_usable_node_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file() && is_usable_node_binary(candidate))
}

fn is_usable_node_binary(candidate: &Path) -> bool {
    Command::new(candidate)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn node_binary_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join(bundled_node_relative_path()));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(generated_node_relative_path()));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(generated_node_relative_path()));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("..").join(generated_node_relative_path()));
    candidates
}

fn bundled_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/node.exe")
    } else {
        PathBuf::from("sidecars/node/bin/node")
    }
}

fn generated_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/dist/node.exe")
    } else {
        PathBuf::from("sidecars/node/dist/bin/node")
    }
}

fn resolve_host_path(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("TERAX_PI_HOST_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "TERAX_PI_HOST_PATH is not a file: {}",
            path.display()
        ));
    }

    for candidate in host_path_candidates(resource_dir) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err("could not find sidecars/pi-host/host.js".to_string())
}

fn host_path_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let relative = PathBuf::from("sidecars/pi-host/host.js");
    let mut candidates = Vec::new();

    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join(&relative));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(&relative));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(&relative));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("..").join(relative));
    candidates
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn bundled_resource_candidate_is_first() {
        let resource_dir = PathBuf::from("resources-root");
        let candidates = host_path_candidates(Some(&resource_dir));

        assert_eq!(
            candidates.first(),
            Some(&resource_dir.join("sidecars/pi-host/host.js"))
        );
    }

    #[test]
    fn bundled_node_candidate_uses_resource_dir() {
        let resource_dir = PathBuf::from("resources-root");
        let candidates = node_binary_candidates(Some(&resource_dir));

        assert_eq!(
            candidates.first(),
            Some(&resource_dir.join(bundled_node_relative_path()))
        );
        assert!(candidates.contains(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(generated_node_relative_path())
        ));
    }

    #[cfg(unix)]
    #[test]
    fn select_usable_node_binary_skips_broken_candidates() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let broken = temp.path().join("broken-node");
        let working = temp.path().join("working-node");
        fs::write(&broken, "#!/bin/sh\nexit 1\n").unwrap();
        fs::write(&working, "#!/bin/sh\necho v0.0.0\n").unwrap();
        fs::set_permissions(&broken, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&working, fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            select_usable_node_binary(vec![broken, working.clone()]),
            Some(working)
        );
    }

    #[test]
    fn dev_candidates_include_repo_root_from_manifest_dir() {
        let candidates = host_path_candidates(None);
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

        assert!(candidates.contains(&manifest_dir.join("..").join("sidecars/pi-host/host.js")));
    }

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn host_environment_uses_allowlist_without_provider_secrets_or_test_faux_by_default() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("ANTHROPIC_API_KEY", "blocked-provider-secret");
        std::env::set_var("TERAX_PI_NODE_MODULES", "/tmp/pi-node-modules");
        std::env::set_var(
            "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
            r#"{"name":"read","arguments":{"path":"package.json"}}"#,
        );
        std::env::set_var("TERAX_PI_HOST_TEST_FAUX_REASONING", "true");
        std::env::remove_var("TERAX_PI_HOST_ENABLE_TEST_FAUX");
        std::env::set_var("TERAX_SHOULD_NOT_LEAK", "blocked-secret");
        let environment = host_environment();

        assert!(environment.iter().any(
            |(name, value)| name == "TERAX_PI_NODE_MODULES" && value == "/tmp/pi-node-modules"
        ));
        assert!(!environment
            .iter()
            .any(|(name, _)| name == "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL"));
        assert!(!environment
            .iter()
            .any(|(name, _)| name == "TERAX_PI_HOST_TEST_FAUX_REASONING"));
        assert!(!environment
            .iter()
            .any(|(name, _)| name == "ANTHROPIC_API_KEY"));
        assert!(!environment
            .iter()
            .any(|(name, _)| name == "TERAX_SHOULD_NOT_LEAK"));

        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::remove_var("TERAX_PI_NODE_MODULES");
        std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_TOOL_CALL");
        std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_REASONING");
        std::env::remove_var("TERAX_SHOULD_NOT_LEAK");
    }

    #[test]
    fn host_environment_forwards_test_faux_only_with_explicit_debug_opt_in() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
        std::env::set_var(
            "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
            r#"{"name":"read","arguments":{"path":"package.json"}}"#,
        );
        std::env::set_var("TERAX_PI_HOST_TEST_FAUX_REASONING", "true");
        let environment = host_environment();

        assert!(environment
            .iter()
            .any(|(name, value)| name == "TERAX_PI_HOST_ENABLE_TEST_FAUX" && value == "1"));
        assert!(environment
            .iter()
            .any(|(name, value)| name == "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL"
                && value.contains("package.json")));
        assert!(environment
            .iter()
            .any(|(name, value)| name == "TERAX_PI_HOST_TEST_FAUX_REASONING" && value == "true"));

        std::env::remove_var("TERAX_PI_HOST_ENABLE_TEST_FAUX");
        std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_TOOL_CALL");
        std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_REASONING");
    }

    #[test]
    fn session_event_notification_parses_event_envelope() {
        let event = session_event_notification(
            r#"{"jsonrpc":"2.0","method":"session.event","params":{"id":"evt-1","type":"session.output.delta","sessionId":"pi-1","createdAt":"2026-01-01T00:00:00.000Z","payload":{"text":"hi"}}}"#,
        )
        .unwrap();

        assert_eq!(event.id, "evt-1");
        assert_eq!(event.event_type, "session.output.delta");
        assert_eq!(event.session_id, "pi-1");
        assert_eq!(event.payload["text"], "hi");
    }

    #[test]
    fn session_event_notification_ignores_responses() {
        assert!(
            session_event_notification(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#)
                .is_none()
        );
    }

    #[test]
    fn pending_responses_deliver_out_of_order_lines_by_id() {
        let pending = PendingResponses::default();
        let first = pending.register(1);
        let second = pending.register(2);

        assert!(pending.complete_response(2, "two\n".to_string()));
        assert!(pending.complete_response(1, "one\n".to_string()));
        assert!(!pending.complete_response(3, "orphan\n".to_string()));

        assert_eq!(
            first
                .recv_timeout(Duration::from_millis(50))
                .unwrap()
                .unwrap(),
            "one\n"
        );
        assert_eq!(
            second
                .recv_timeout(Duration::from_millis(50))
                .unwrap()
                .unwrap(),
            "two\n"
        );
    }

    #[test]
    fn host_matches_concurrent_out_of_order_responses_by_id() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("host.js");
        fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = [];

function write(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function resultFor(request) {
  if (request.method === 'status') {
    return { phase: 'ready', detail: 'first response' };
  }
  if (request.method === 'info') {
    return { hostVersion: 'fake', piSdkLoaded: true, piPackages: [] };
  }
  throw new Error(`unexpected method ${request.method}`);
}

for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  pending.push(request);
  if (pending.length === 2) {
    const [first, second] = pending.splice(0, 2);
    write({ jsonrpc: '2.0', id: second.id, result: resultFor(second) });
    write({ jsonrpc: '2.0', id: first.id, result: resultFor(first) });
  }
}
"#,
        )
        .unwrap();

        let host = Arc::new(
            PiHost::spawn_inner(PathBuf::from("node"), script, Duration::from_secs(5), None)
                .unwrap(),
        );
        let status_host = Arc::clone(&host);
        let info_host = Arc::clone(&host);

        let status = thread::spawn(move || status_host.status());
        let info = thread::spawn(move || info_host.info());

        let status = status.join().unwrap().unwrap();
        let info = info.join().unwrap().unwrap();

        assert_eq!(status.phase, PiPhase::Ready);
        assert_eq!(status.detail.as_deref(), Some("first response"));
        assert_eq!(info.host_version, "fake");

        host.shutdown();
    }

    #[test]
    fn host_handles_reverse_native_tool_requests() {
        let temp = tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("note.txt"), "native bridge ok").unwrap();
        let cwd_json = serde_json::to_string(&workspace.to_string_lossy()).unwrap();
        let script = temp.path().join("host.js");
        let source = r#"
import { createInterface } from 'node:readline';
const cwd = __CWD__;
const sessionId = 'pi-native-test';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let statusRequest = null;
function write(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  if (request.method === 'sessions.create') {
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        session: {
          id: sessionId,
          title: 'Native test',
          cwd,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastPrompt: null
        },
        events: []
      }
    });
    continue;
  }
  if (request.method === 'status') {
    statusRequest = request;
    write({
      jsonrpc: '2.0',
      id: 100,
      method: 'nativeTools.execute',
      params: {
        sessionId,
        toolCallId: 'call-read',
        toolName: 'read',
        cwd,
        input: { path: 'note.txt' }
      }
    });
    continue;
  }
  if (request.id === 100 && request.result) {
    write({
      jsonrpc: '2.0',
      id: statusRequest.id,
      result: {
        phase: 'ready',
        detail: request.result.content[0].text
      }
    });
  }
}
"#
        .replace("__CWD__", &cwd_json);
        fs::write(&script, source).unwrap();

        let host = PiHost::spawn_inner(PathBuf::from("node"), script, Duration::from_secs(5), None)
            .unwrap();
        let created = host
            .session_create(
                Some("Native test".to_string()),
                Some(workspace.to_string_lossy().into_owned()),
                None,
                None,
                WorkspaceEnv::Local,
            )
            .unwrap();

        let status = host.status().unwrap();

        assert_eq!(created.session.id, "pi-native-test");

        assert_eq!(status.phase, PiPhase::Ready);
        assert_eq!(status.detail.as_deref(), Some("native bridge ok"));
        host.shutdown();
    }

    #[test]
    fn native_bridge_rejects_workspace_env_mismatch_before_execution() {
        let temp = tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("note.txt"), "native bridge ok").unwrap();
        let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
        sessions.lock().unwrap().insert(
            "pi-wsl".to_string(),
            NativeToolSession {
                cwd: std::fs::canonicalize(&workspace).unwrap(),
                workspace_env: WorkspaceEnv::Wsl {
                    distro: "Ubuntu-24.04".to_string(),
                },
            },
        );

        let error = execute_verified_native_tool(
            &sessions,
            NativeToolRequest {
                session_id: "pi-wsl".to_string(),
                tool_call_id: "call-read".to_string(),
                tool_name: "read".to_string(),
                cwd: workspace.to_string_lossy().into_owned(),
                workspace_env: Some(WorkspaceEnv::Local),
                input: json!({ "path": "note.txt" }),
            },
        )
        .unwrap_err();

        assert!(error.contains("workspace env"), "{error}");
    }

    #[test]
    fn production_timeouts_are_method_specific() {
        let timeouts = RequestTimeouts::production();

        assert!(timeouts.for_method("status") < timeouts.for_method("sessions.create"));
        assert!(timeouts.for_method("sessions.stop") < timeouts.for_method("models.list"));
        assert_eq!(timeouts.for_method("status"), Duration::from_secs(3));
    }

    #[test]
    fn method_errors_preserve_structured_recovery_data() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("host.js");
        fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { pong: true } })}\n`);
    continue;
  }
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32006,
      message: 'Pi host supports at most 20 sessions',
      data: {
        code: 'PI_RESOURCE_LIMIT',
        category: 'resource_limit',
        retryable: false,
        remediation: 'Close older Pi sessions or shorten the prompt, then try again.'
      }
    }
  })}\n`);
}
"#,
        )
        .unwrap();
        let host = PiHost::spawn_inner_with_timeouts(
            PathBuf::from("node"),
            script,
            RequestTimeouts::for_tests(Duration::from_secs(1)),
            None,
        )
        .unwrap();

        let error = host.status().unwrap_err();
        let data = error.structured_data().unwrap();

        assert_eq!(data.code, "PI_RESOURCE_LIMIT");
        assert_eq!(data.category, "resource_limit");
        assert!(!data.retryable);
        assert_eq!(
            data.remediation,
            "Close older Pi sessions or shorten the prompt, then try again."
        );

        host.shutdown();
    }

    #[test]
    fn request_timeout_uses_method_specific_duration() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("host.js");
        fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { pong: true } })}\n`);
  }
}
"#,
        )
        .unwrap();
        let timeouts = RequestTimeouts::for_tests(Duration::from_millis(500))
            .with_method("status", Duration::from_millis(75));
        let host = PiHost::spawn_inner_with_timeouts(PathBuf::from("node"), script, timeouts, None)
            .unwrap();

        let error = host.status().unwrap_err().message();

        assert!(error.contains("status` timed out after 75ms"), "{error}");
        host.kill_child();
    }

    #[test]
    fn startup_timeout_includes_captured_stderr() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("host.js");
        fs::write(
            &script,
            "process.stderr.write('pi host boot note\\n'); setInterval(() => {}, 1000);",
        )
        .unwrap();

        let error = match PiHost::spawn_inner(
            PathBuf::from("node"),
            script,
            Duration::from_millis(100),
            None,
        ) {
            Ok(_) => panic!("host should time out during ping"),
            Err(error) => error,
        };

        assert!(error.contains("timed out"), "{error}");
        assert!(error.contains("pi host boot note"), "{error}");
    }
}
