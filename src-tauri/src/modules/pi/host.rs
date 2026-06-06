use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::modules::capabilities::audit::CapabilityAuditLog;
use crate::modules::capabilities::core_capability_manifest;
use crate::modules::workspace::WorkspaceEnv;

use super::native_tools;
#[cfg(test)]
use super::native_tools::NativeToolRequest;
use super::{
    PiCommandError, PiDiagnostics, PiErrorData, PiHostInfo, PiMethodTimeoutDiagnostics, PiPhase,
    PiProfileModelsList, PiPromptContext, PiResolvedProviderConfig, PiRuntimeSnapshot,
    PiSessionCreateResult, PiSessionDeleteResult, PiSessionEvent, PiSessionRenameResult,
    PiSessionResumeResult, PiSessionSendResult, PiSessionStopResult, PiSessionToolRespondResult,
    PiSessionsList,
};

mod bridge;
mod paths;
mod protocol;
mod timeouts;
#[cfg(test)]
use bridge::{
    execute_verified_native_tool, execute_verified_native_tool_with_approvals,
    execute_verified_native_tool_with_policy, session_event_notification,
};
use bridge::{record_native_tool_approval_events, spawn_stderr_reader, spawn_stdout_reader};
#[cfg(test)]
use paths::{
    bundled_node_relative_path, generated_node_relative_path, host_path_candidates,
    node_binary_candidates, select_usable_node_binary,
};
use paths::{host_environment, node_binary, resolve_host_path};
pub(super) use protocol::HostCallError;
use protocol::{
    HostResponse, HostStatus, NativeToolApprovals, NativeToolContextState, NativeToolSession,
    NativeToolSessions, PendingResponses, PingResult, ShutdownResult, StderrTail,
};
use timeouts::RequestTimeouts;

pub type PiSessionEventSink = Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static>;

pub struct PiHost {
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingResponses,
    native_tool_sessions: NativeToolSessions,
    native_tool_approvals: NativeToolApprovals,
    capability_audit: CapabilityAuditLog,
    native_tool_context: NativeToolContextState,
    stderr_tail: StderrTail,
    request_timeouts: RequestTimeouts,
    next_id: AtomicU64,
}

impl PiHost {
    pub fn spawn_with_event_sink_and_native_tool_context(
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        native_tool_context: native_tools::NativeToolContext,
    ) -> Result<Self, String> {
        let host_path = resolve_host_path(resource_dir)?;
        Self::spawn_inner_with_timeouts_and_native_tool_context(
            node_binary(resource_dir),
            host_path,
            RequestTimeouts::production(),
            event_sink,
            native_tool_context,
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

    #[cfg(test)]
    fn spawn_inner_with_timeouts(
        node_binary: PathBuf,
        host_path: PathBuf,
        request_timeouts: RequestTimeouts,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Self, String> {
        Self::spawn_inner_with_timeouts_and_native_tool_context(
            node_binary,
            host_path,
            request_timeouts,
            event_sink,
            native_tools::NativeToolContext::default(),
        )
    }

    fn spawn_inner_with_timeouts_and_native_tool_context(
        node_binary: PathBuf,
        host_path: PathBuf,
        request_timeouts: RequestTimeouts,
        event_sink: Option<PiSessionEventSink>,
        native_tool_context: native_tools::NativeToolContext,
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
        let native_tool_approvals = NativeToolApprovals::default();
        let capability_audit = CapabilityAuditLog::default();
        let native_tool_context = Arc::new(Mutex::new(native_tool_context));
        spawn_stderr_reader(stderr, stderr_tail.clone());
        spawn_stdout_reader(
            stdout,
            pending.clone(),
            Arc::clone(&stdin),
            Arc::clone(&native_tool_sessions),
            native_tool_approvals.clone(),
            capability_audit.clone(),
            Arc::clone(&native_tool_context),
            event_sink,
        );

        let host = Self {
            child: Mutex::new(child),
            stdin,
            pending,
            native_tool_sessions,
            native_tool_approvals,
            capability_audit,
            native_tool_context,
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

    pub fn set_native_tool_context(
        &self,
        context: native_tools::NativeToolContext,
    ) -> Result<(), String> {
        *self
            .native_tool_context
            .lock()
            .map_err(|error| format!("native tool context lock failed: {error}"))? = context;
        Ok(())
    }

    fn capability_manifest(&self) -> crate::modules::capabilities::CapabilityManifest {
        self.native_tool_context
            .lock()
            .map(|context| context.capability_manifest())
            .unwrap_or_else(|_| core_capability_manifest())
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
        diagnostics.capability_audit = self.capability_audit.entries();
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
        let capability_manifest = self.capability_manifest();
        let result: PiSessionCreateResult = self.call_with_params(
            "sessions.create",
            json!({
                "title": title,
                "cwd": cwd,
                "providerConfig": provider_config,
                "sessionDir": session_dir,
                "workspaceEnv": workspace_env,
                "capabilityManifest": capability_manifest,
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
        let capability_manifest = self.capability_manifest();
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
                "capabilityManifest": capability_manifest,
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
        let preapproved = if approved {
            self.native_tool_approvals
                .approve_pending(&session_id, &tool_call_id)
        } else {
            self.native_tool_approvals
                .deny_pending(&session_id, &tool_call_id);
            None
        };
        let result: Result<PiSessionToolRespondResult, HostCallError> = self.call_with_params(
            "sessions.tool.respond",
            json!({
                "sessionId": session_id,
                "toolCallId": tool_call_id,
                "approved": approved,
            }),
        );
        match result {
            Ok(result) => {
                record_native_tool_approval_events(&self.native_tool_approvals, &result.events);
                Ok(result)
            }
            Err(error) => {
                if let Some(key) = preapproved.as_ref() {
                    self.native_tool_approvals.remove_approved(key);
                }
                Err(error)
            }
        }
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
        self.native_tool_approvals.forget_session(session_id);
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

#[cfg(test)]
mod tests;
