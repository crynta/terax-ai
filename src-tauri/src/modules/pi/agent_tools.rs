//! Rust-side approval enforcement for the webview Pi agent.
//!
//! The webview proposes tool calls; Rust disposes. Every agent-initiated tool
//! execution is routed through [`pi_agent_tool_execute`], which authorizes the
//! working directory against the live [`WorkspaceRegistry`], evaluates capability
//! policy, verifies (and consumes) a user-issued approval grant for Ask-level
//! tools, runs the tool through the shared native dispatcher, and records an audit
//! entry. The webview approval card is UX only; this module is the security
//! boundary, so a prompt-injected model cannot execute an Ask/Deny tool without a
//! real user approval recorded via [`pi_approval_grant`].

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, State};

use crate::modules::artifacts::ArtifactsState;
use crate::modules::capabilities::{
    audit::{CapabilityAuditEntry, CapabilityAuditLog, CapabilityAuditOutcome},
    policy::{self, CapabilityApprovalState},
    ApprovalPolicy, CapabilityOrigin, RiskLevel,
};
use crate::modules::mcp::McpState;
use crate::modules::workspace::{self, WorkspaceRegistry};

use super::native_tools::{self, NativeToolContext, NativeToolRequest, NativeToolResult};

#[derive(Clone, Eq, Hash, PartialEq)]
struct GrantKey {
    session_id: String,
    tool_call_id: String,
    tool_name: String,
}

impl GrantKey {
    fn new(session_id: &str, tool_call_id: &str, tool_name: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            tool_call_id: tool_call_id.to_string(),
            tool_name: tool_name.to_string(),
        }
    }
}

/// Single-use approval grants plus the agent-tool audit ledger.
///
/// A grant is recorded only by [`PiAgentToolState::grant`], which is reachable
/// solely through the [`pi_approval_grant`] command the approval UI calls when the
/// user approves a tool. The model has no path to forge one.
#[derive(Default)]
pub struct PiAgentToolState {
    grants: Mutex<HashSet<GrantKey>>,
    audit: CapabilityAuditLog,
}

impl PiAgentToolState {
    /// Record a single-use approval for a specific tool call.
    pub fn grant(&self, session_id: &str, tool_call_id: &str, tool_name: &str) {
        if let Ok(mut grants) = self.grants.lock() {
            grants.insert(GrantKey::new(session_id, tool_call_id, tool_name));
        }
    }

    /// Consume an approval grant if present, returning whether one existed.
    fn consume(&self, key: &GrantKey) -> bool {
        self.grants
            .lock()
            .map(|mut grants| grants.remove(key))
            .unwrap_or(false)
    }

    /// Forget every grant belonging to a session (called on session delete/stop).
    pub fn forget_session(&self, session_id: &str) {
        if let Ok(mut grants) = self.grants.lock() {
            grants.retain(|key| key.session_id != session_id);
        }
    }

    pub fn audit_entries(&self) -> Vec<CapabilityAuditEntry> {
        self.audit.entries()
    }

    fn record(
        &self,
        request: &NativeToolRequest,
        approved: bool,
        allowed: bool,
        outcome: CapabilityAuditOutcome,
        message: Option<String>,
    ) {
        self.audit.record(CapabilityAuditEntry::new(
            &request.session_id,
            &request.tool_call_id,
            &request.tool_name,
            approved,
            allowed,
            outcome,
            message,
        ));
    }

    /// Authorize, policy-check, approval-verify, execute, and audit a tool call.
    fn verify_and_execute(
        &self,
        registry: &WorkspaceRegistry,
        request: NativeToolRequest,
        context: &NativeToolContext,
    ) -> Result<NativeToolResult, String> {
        if request.session_id.trim().is_empty() {
            return Err("agent tool request requires a sessionId".to_string());
        }
        if request.tool_call_id.trim().is_empty() {
            return Err("agent tool request requires a toolCallId".to_string());
        }

        // Bind the tool's working directory to a live, user-authorized workspace
        // root. This is the actual filesystem boundary; the native dispatcher only
        // canonicalizes cwd, it does not authorize it.
        let workspace_env = request.workspace_env.clone().unwrap_or_default();
        if workspace::authorize_spawn_cwd(registry, Some(&request.cwd), &workspace_env)?.is_none() {
            return Err("agent tool request requires a workspace cwd".to_string());
        }

        let key = GrantKey::new(
            &request.session_id,
            &request.tool_call_id,
            &request.tool_name,
        );
        let approval_state = if self.consume(&key) {
            CapabilityApprovalState::Approved
        } else {
            CapabilityApprovalState::None
        };
        let approved = approval_state == CapabilityApprovalState::Approved;

        if let Err(error) = evaluate_tool_policy(context, &request, approval_state) {
            let message = error.to_string();
            self.record(
                &request,
                approved,
                false,
                CapabilityAuditOutcome::Blocked,
                Some(message.clone()),
            );
            return Err(message);
        }

        let session_id = request.session_id.clone();
        let tool_call_id = request.tool_call_id.clone();
        let tool_name = request.tool_name.clone();
        let result = native_tools::execute_with_context(request, context);
        let audit_request = NativeToolRequest {
            session_id,
            tool_call_id,
            tool_name,
            cwd: String::new(),
            workspace_env: None,
            approval: None,
            input: serde_json::Value::Null,
        };
        match &result {
            Ok(result) => {
                let is_error = result
                    .details
                    .get("mcp")
                    .and_then(|details| details.get("isError"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                self.record(
                    &audit_request,
                    approved,
                    true,
                    if is_error {
                        CapabilityAuditOutcome::Failed
                    } else {
                        CapabilityAuditOutcome::Succeeded
                    },
                    None,
                );
            }
            Err(error) => {
                self.record(
                    &audit_request,
                    approved,
                    true,
                    CapabilityAuditOutcome::Failed,
                    Some(error.clone()),
                );
            }
        }
        result
    }
}

/// Evaluate capability policy for a tool, falling back to MCP tool descriptors for
/// `mcp__*` tools that are not part of the core manifest.
fn evaluate_tool_policy(
    context: &NativeToolContext,
    request: &NativeToolRequest,
    approval_state: CapabilityApprovalState,
) -> Result<(), policy::CapabilityPolicyError> {
    let manifest = context.capability_manifest();
    let mut result = policy::evaluate(&manifest, &request.tool_name, approval_state);
    if matches!(result, Err(policy::CapabilityPolicyError::UnknownTool(_))) {
        if let Some(target_manifest) = context.capability_manifest_for_tool(&request.tool_name) {
            result = policy::evaluate(&target_manifest, &request.tool_name, approval_state);
        } else if let Some(approval_policy) =
            context.mcp_approval_policy_for_tool(&request.tool_name)
        {
            // MCP policy comes only from Rust-side state, never from the
            // webview-supplied request.approval field (which a prompt-injected
            // model could set). An MCP tool unknown to Rust stays UnknownTool
            // and is denied (fail-closed).
            result = mcp_policy_decision(&request.tool_name, approval_policy, approval_state);
        }
    }
    result.map(|_| ())
}

fn mcp_policy_decision(
    tool_name: &str,
    approval_policy: ApprovalPolicy,
    approval_state: CapabilityApprovalState,
) -> Result<policy::CapabilityDecision, policy::CapabilityPolicyError> {
    match approval_policy {
        ApprovalPolicy::Deny => Err(policy::CapabilityPolicyError::Denied(tool_name.to_string())),
        ApprovalPolicy::Ask if approval_state != CapabilityApprovalState::Approved => Err(
            policy::CapabilityPolicyError::ApprovalRequired(tool_name.to_string()),
        ),
        ApprovalPolicy::Ask | ApprovalPolicy::Auto => Ok(policy::CapabilityDecision {
            tool_name: tool_name.to_string(),
            approval: approval_policy,
            risk: RiskLevel::Medium,
            origin: CapabilityOrigin::Mcp,
        }),
    }
}

/// Record a user approval for a specific agent tool call. Called by the approval UI
/// the moment the user approves; the grant is single-use and consumed at execution.
#[tauri::command]
pub fn pi_approval_grant(
    agent_tools: State<'_, PiAgentToolState>,
    session_id: String,
    tool_call_id: String,
    tool_name: String,
) -> Result<(), String> {
    agent_tools.grant(&session_id, &tool_call_id, &tool_name);
    Ok(())
}

/// Execute a webview agent tool call under full Rust enforcement.
#[tauri::command]
pub fn pi_agent_tool_execute(
    app: AppHandle,
    artifacts_state: State<'_, ArtifactsState>,
    mcp_state: State<'_, Arc<McpState>>,
    registry: State<'_, WorkspaceRegistry>,
    agent_tools: State<'_, PiAgentToolState>,
    request: NativeToolRequest,
) -> Result<NativeToolResult, String> {
    let context = super::artifact_native_tool_context(
        &app,
        artifacts_state.inner(),
        Some(Arc::clone(mcp_state.inner())),
    )
    .map_err(|error| error.message)?;
    agent_tools.verify_and_execute(registry.inner(), request, &context)
}

/// Forget a session's outstanding approval grants.
#[tauri::command]
pub fn pi_agent_session_forget(agent_tools: State<'_, PiAgentToolState>, session_id: String) {
    agent_tools.forget_session(&session_id);
}

/// Audit ledger for webview agent tool executions.
#[tauri::command]
pub fn pi_agent_tool_audit(agent_tools: State<'_, PiAgentToolState>) -> Vec<CapabilityAuditEntry> {
    agent_tools.audit_entries()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use serde_json::json;

    use super::*;
    use crate::modules::artifacts::ArtifactStore;

    fn authorized_registry(root: &Path) -> WorkspaceRegistry {
        let registry = WorkspaceRegistry::default();
        registry.authorize(root).unwrap();
        registry
    }

    fn request(cwd: &Path, tool_name: &str, input: serde_json::Value) -> NativeToolRequest {
        NativeToolRequest {
            session_id: "pi-test".to_string(),
            tool_call_id: "call-1".to_string(),
            tool_name: tool_name.to_string(),
            cwd: cwd.to_string_lossy().into_owned(),
            workspace_env: None,
            approval: None,
            input,
        }
    }

    fn context(dir: &Path) -> NativeToolContext {
        let store = ArtifactStore::new(dir.join("artifacts"));
        NativeToolContext::with_artifacts(store, None)
    }

    fn first_text(result: &NativeToolResult) -> String {
        serde_json::to_value(&result.content[0])
            .ok()
            .and_then(|value| value.get("text").and_then(|t| t.as_str()).map(String::from))
            .unwrap_or_default()
    }

    #[test]
    fn auto_tool_executes_without_a_grant() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        fs::write(root.join("note.txt"), "hello").unwrap();
        let state = PiAgentToolState::default();
        let registry = authorized_registry(&root);

        let result = state
            .verify_and_execute(
                &registry,
                request(&root, "read", json!({ "path": "note.txt" })),
                &context(&root),
            )
            .unwrap();

        assert_eq!(first_text(&result), "hello");
        let audit = state.audit_entries();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0].outcome, CapabilityAuditOutcome::Succeeded);
        assert!(!audit[0].approved);
    }

    #[test]
    fn model_supplied_approval_metadata_does_not_authorize_a_tool() {
        // A prompt-injected model could set the request.approval field; the
        // verified executor must ignore it. An MCP tool unknown to Rust state
        // stays denied even when the request claims auto-approval.
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let state = PiAgentToolState::default();
        let registry = authorized_registry(&root);

        let mut req = request(&root, "mcp__server__danger", json!({}));
        req.approval = Some(super::super::native_tools::NativeToolApprovalMetadata {
            policy: Some(crate::modules::capabilities::ApprovalPolicy::Auto),
            approved: Some(true),
        });

        let error = state
            .verify_and_execute(&registry, req, &context(&root))
            .unwrap_err();
        assert!(
            error.contains("unknown") || error.contains("MCP") || error.contains("denied"),
            "{error}"
        );
    }

    #[test]
    fn ask_tool_without_grant_is_blocked_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let state = PiAgentToolState::default();
        let registry = authorized_registry(&root);

        let error = state
            .verify_and_execute(
                &registry,
                request(
                    &root,
                    "write",
                    json!({ "path": "out.txt", "content": "should not exist" }),
                ),
                &context(&root),
            )
            .unwrap_err();

        assert!(error.contains("requires approval"), "{error}");
        assert!(!root.join("out.txt").exists(), "denied write must not land");
        let audit = state.audit_entries();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0].outcome, CapabilityAuditOutcome::Blocked);
    }

    #[test]
    fn ask_tool_with_grant_executes_once_then_grant_is_consumed() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let state = PiAgentToolState::default();
        let registry = authorized_registry(&root);

        state.grant("pi-test", "call-1", "write");
        state
            .verify_and_execute(
                &registry,
                request(
                    &root,
                    "write",
                    json!({ "path": "out.txt", "content": "landed" }),
                ),
                &context(&root),
            )
            .unwrap();
        assert_eq!(fs::read_to_string(root.join("out.txt")).unwrap(), "landed");

        // Second identical call has no grant left: blocked.
        let error = state
            .verify_and_execute(
                &registry,
                request(
                    &root,
                    "write",
                    json!({ "path": "out2.txt", "content": "blocked" }),
                ),
                &context(&root),
            )
            .unwrap_err();
        assert!(error.contains("requires approval"), "{error}");
        assert!(!root.join("out2.txt").exists());
    }

    #[test]
    fn grant_for_other_tool_does_not_authorize_this_tool() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let state = PiAgentToolState::default();
        let registry = authorized_registry(&root);

        // Grant is keyed by tool name: a grant for `edit` must not unlock `write`.
        state.grant("pi-test", "call-1", "edit");
        let error = state
            .verify_and_execute(
                &registry,
                request(&root, "write", json!({ "path": "out.txt", "content": "x" })),
                &context(&root),
            )
            .unwrap_err();
        assert!(error.contains("requires approval"), "{error}");
    }

    #[test]
    fn cwd_outside_authorized_workspace_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let outside = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let state = PiAgentToolState::default();
        // Authorize only `root`, then attempt a tool in a different directory.
        let registry = authorized_registry(&root);

        let error = state
            .verify_and_execute(
                &registry,
                request(&outside, "read", json!({ "path": "anything" })),
                &context(&root),
            )
            .unwrap_err();
        assert!(
            error.contains("outside the authorized workspace") || error.contains("not accessible"),
            "{error}"
        );
    }

    #[test]
    fn forget_session_drops_pending_grants() {
        let state = PiAgentToolState::default();
        state.grant("pi-test", "call-1", "write");
        state.forget_session("pi-test");
        assert!(!state.consume(&GrantKey::new("pi-test", "call-1", "write")));
    }
}
