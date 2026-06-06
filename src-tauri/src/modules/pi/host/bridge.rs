use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStderr, ChildStdin, ChildStdout};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

use crate::modules::capabilities::{
    audit::{CapabilityAuditEntry, CapabilityAuditLog, CapabilityAuditOutcome},
    policy::{self, CapabilityApprovalState},
};

use super::super::{session_event_type, PiSessionEvent};
use super::native_tools::{self, NativeToolRequest};
use super::protocol::{
    HostNotification, HostRequest, HostResponseEnvelope, NativeToolApprovalKey,
    NativeToolApprovals, NativeToolContextState, NativeToolSessions, PendingResponses, StderrTail,
};
use super::PiSessionEventSink;

pub(super) fn session_event_notification(line: &str) -> Option<PiSessionEvent> {
    let notification = serde_json::from_str::<HostNotification>(line.trim_end()).ok()?;
    if notification.jsonrpc == "2.0" && notification.method == "session.event" {
        Some(notification.params)
    } else {
        None
    }
}

pub(super) fn record_native_tool_approval_event(
    native_tool_approvals: &NativeToolApprovals,
    event: &PiSessionEvent,
) {
    match event.event_type.as_str() {
        session_event_type::TOOL_APPROVAL_REQUESTED => {
            let Some(tool_call_id) = event.payload.get("toolCallId").and_then(Value::as_str) else {
                return;
            };
            let Some(tool_name) = event.payload.get("toolName").and_then(Value::as_str) else {
                return;
            };
            native_tool_approvals.remember_pending(&event.session_id, tool_call_id, tool_name);
        }
        session_event_type::TOOL_APPROVAL_RESPONDED => {
            let Some(tool_call_id) = event.payload.get("toolCallId").and_then(Value::as_str) else {
                return;
            };
            if event
                .payload
                .get("approved")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                native_tool_approvals.approve_pending(&event.session_id, tool_call_id);
            } else {
                native_tool_approvals.deny_pending(&event.session_id, tool_call_id);
            }
        }
        _ => {}
    }
}

pub(super) fn record_native_tool_approval_events(
    native_tool_approvals: &NativeToolApprovals,
    events: &[PiSessionEvent],
) {
    for event in events {
        record_native_tool_approval_event(native_tool_approvals, event);
    }
}

pub(super) fn response_id(line: &str) -> Result<Option<u64>, String> {
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

pub(super) fn host_request(line: &str) -> Result<Option<HostRequest>, String> {
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

pub(super) fn handle_host_request(
    stdin: &Arc<Mutex<ChildStdin>>,
    native_tool_sessions: &NativeToolSessions,
    native_tool_approvals: &NativeToolApprovals,
    capability_audit: &CapabilityAuditLog,
    native_tool_context: &NativeToolContextState,
    request: HostRequest,
) {
    let stdin = Arc::clone(stdin);
    let native_tool_sessions = Arc::clone(native_tool_sessions);
    let native_tool_approvals = native_tool_approvals.clone();
    let capability_audit = capability_audit.clone();
    let native_tool_context = Arc::clone(native_tool_context);
    thread::spawn(move || {
        let response = host_request_response(
            &native_tool_sessions,
            &native_tool_approvals,
            &capability_audit,
            &native_tool_context,
            request,
        );
        if let Err(error) = write_host_response(&stdin, response) {
            log::warn!("failed to write Pi host response: {error}");
        }
    });
}

pub(super) fn host_request_response(
    native_tool_sessions: &NativeToolSessions,
    native_tool_approvals: &NativeToolApprovals,
    capability_audit: &CapabilityAuditLog,
    native_tool_context: &NativeToolContextState,
    request: HostRequest,
) -> Value {
    match request.method.as_str() {
        "nativeTools.execute" => {
            let params = request.params.unwrap_or(Value::Null);
            match serde_json::from_value::<NativeToolRequest>(params)
                .map_err(|error| format!("invalid nativeTools.execute params: {error}"))
                .and_then(|request| {
                    let context = native_tool_context
                        .lock()
                        .map_err(|error| format!("native tool context lock failed: {error}"))?
                        .clone();
                    execute_verified_native_tool_with_policy(
                        native_tool_sessions,
                        native_tool_approvals,
                        capability_audit,
                        request,
                        &context,
                    )
                }) {
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

#[cfg(test)]
pub(super) fn execute_verified_native_tool(
    native_tool_sessions: &NativeToolSessions,
    request: NativeToolRequest,
    native_tool_context: &native_tools::NativeToolContext,
) -> Result<native_tools::NativeToolResult, String> {
    execute_verified_native_tool_with_approvals(
        native_tool_sessions,
        &NativeToolApprovals::default(),
        request,
        native_tool_context,
    )
}

#[cfg(test)]
pub(super) fn execute_verified_native_tool_with_approvals(
    native_tool_sessions: &NativeToolSessions,
    native_tool_approvals: &NativeToolApprovals,
    request: NativeToolRequest,
    native_tool_context: &native_tools::NativeToolContext,
) -> Result<native_tools::NativeToolResult, String> {
    execute_verified_native_tool_with_policy(
        native_tool_sessions,
        native_tool_approvals,
        &CapabilityAuditLog::default(),
        request,
        native_tool_context,
    )
}

pub(super) fn execute_verified_native_tool_with_policy(
    native_tool_sessions: &NativeToolSessions,
    native_tool_approvals: &NativeToolApprovals,
    capability_audit: &CapabilityAuditLog,
    request: NativeToolRequest,
    native_tool_context: &native_tools::NativeToolContext,
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
        return Err(
            "native tool workspace env does not match the Rust-authorized session".to_string(),
        );
    }
    let approval_key = NativeToolApprovalKey::for_request(&request);
    let approval_state = if native_tool_approvals.consume_approved(&approval_key) {
        CapabilityApprovalState::Approved
    } else {
        CapabilityApprovalState::None
    };
    let manifest = native_tool_context.capability_manifest();
    let approved = approval_state == CapabilityApprovalState::Approved;
    if let Err(error) = policy::evaluate(&manifest, &request.tool_name, approval_state) {
        let message = error.to_string();
        capability_audit.record(CapabilityAuditEntry::new(
            &request.session_id,
            &request.tool_call_id,
            &request.tool_name,
            approved,
            false,
            CapabilityAuditOutcome::Blocked,
            Some(message.clone()),
        ));
        return Err(message);
    }
    let session_id = request.session_id.clone();
    let tool_call_id = request.tool_call_id.clone();
    let tool_name = request.tool_name.clone();
    let result = native_tools::execute_with_context(request, native_tool_context);
    match &result {
        Ok(result) => {
            let is_error = result
                .details
                .get("mcp")
                .and_then(|details| details.get("isError"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            capability_audit.record(CapabilityAuditEntry::new(
                &session_id,
                &tool_call_id,
                &tool_name,
                approved,
                true,
                if is_error {
                    CapabilityAuditOutcome::Failed
                } else {
                    CapabilityAuditOutcome::Succeeded
                },
                None,
            ));
        }
        Err(error) => {
            capability_audit.record(CapabilityAuditEntry::new(
                &session_id,
                &tool_call_id,
                &tool_name,
                approved,
                true,
                CapabilityAuditOutcome::Failed,
                Some(error.clone()),
            ));
        }
    }
    result
}

pub(super) fn write_host_response(
    stdin: &Arc<Mutex<ChildStdin>>,
    response: Value,
) -> Result<(), String> {
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

#[allow(
    clippy::too_many_arguments,
    reason = "The host reader owns independent protocol, approval, audit, and event channels"
)]
pub(super) fn spawn_stdout_reader(
    stdout: ChildStdout,
    pending: PendingResponses,
    stdin: Arc<Mutex<ChildStdin>>,
    native_tool_sessions: NativeToolSessions,
    native_tool_approvals: NativeToolApprovals,
    capability_audit: CapabilityAuditLog,
    native_tool_context: NativeToolContextState,
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
                        record_native_tool_approval_event(&native_tool_approvals, &event);
                        if let Some(event_sink) = event_sink.as_ref() {
                            event_sink(event);
                        }
                        continue;
                    }
                    match host_request(&line) {
                        Ok(Some(request)) => {
                            handle_host_request(
                                &stdin,
                                &native_tool_sessions,
                                &native_tool_approvals,
                                &capability_audit,
                                &native_tool_context,
                                request,
                            );
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

pub(super) fn spawn_stderr_reader(mut stderr: ChildStderr, tail: StderrTail) {
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
