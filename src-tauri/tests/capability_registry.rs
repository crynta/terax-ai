use serde_json::json;
use terax_lib::modules::capabilities::{
    app_capability_manifest,
    audit::{CapabilityAuditEntry, CapabilityAuditLog, CapabilityAuditOutcome},
    capability_manifest_with_mcp_tools, core_capability_manifest,
    policy::{self, CapabilityApprovalState, CapabilityPolicyError},
    workflow_capability_manifest, AppCapabilityState, ApprovalPolicy, CapabilityOrigin, RiskLevel,
};
use terax_lib::modules::mcp::{McpToolDescriptor, McpToolRiskLevel};

#[test]
fn core_manifest_exposes_existing_pi_tools_with_policy() {
    let manifest = core_capability_manifest();
    let tools = manifest
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        tools,
        vec![
            "read",
            "ls",
            "grep",
            "find",
            "bash",
            "edit",
            "write",
            "create_artifact",
            "edit_artifact",
            "read_artifact",
            "list_artifacts",
        ]
    );

    let bash = manifest
        .tools
        .iter()
        .find(|tool| tool.name == "bash")
        .unwrap();
    assert_eq!(bash.approval, ApprovalPolicy::Ask);
    assert_eq!(bash.risk, RiskLevel::High);
    assert!(bash.scopes.iter().any(|scope| scope == "workspace"));

    let read = manifest
        .tools
        .iter()
        .find(|tool| tool.name == "read")
        .unwrap();
    assert_eq!(read.approval, ApprovalPolicy::Auto);
    assert_eq!(read.risk, RiskLevel::Low);
    assert!(read.model_visible);
}

#[test]
fn core_manifest_derives_enabled_and_approval_tool_lists() {
    let manifest = core_capability_manifest();

    assert_eq!(
        manifest.enabled_tool_names(),
        vec![
            "read",
            "ls",
            "grep",
            "find",
            "bash",
            "edit",
            "write",
            "create_artifact",
            "edit_artifact",
            "read_artifact",
            "list_artifacts",
        ]
    );
    assert_eq!(
        manifest.approval_required_tool_names(),
        vec!["bash", "edit", "write"]
    );
}

#[test]
fn app_manifest_exposes_non_model_visible_native_surfaces() {
    let manifest = app_capability_manifest();
    let tools = manifest
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        tools,
        vec![
            "app.shell_command",
            "app.shell_session",
            "app.shell_background",
            "app.file_read",
            "app.file_list",
            "app.file_search",
            "app.file_write",
            "app.http_request",
            "app.pty_session",
            "app.mcp_tool",
            "app.secrets",
        ]
    );
    assert!(manifest.enabled_tool_names().is_empty());
    assert!(manifest.approval_required_tool_names().is_empty());

    let shell = manifest.tool("app.shell_command").unwrap();
    assert_eq!(shell.origin, CapabilityOrigin::TeraxCore);
    assert_eq!(shell.approval, ApprovalPolicy::Auto);
    assert_eq!(shell.risk, RiskLevel::High);
    assert!(!shell.model_visible);

    let secrets = manifest.tool("app.secrets").unwrap();
    assert_eq!(secrets.origin, CapabilityOrigin::TeraxCore);
    assert_eq!(secrets.approval, ApprovalPolicy::Auto);
    assert_eq!(secrets.risk, RiskLevel::Medium);
    assert!(!secrets.model_visible);
}

#[test]
fn app_capability_state_records_success_failure_and_blocked_events() {
    let state = AppCapabilityState::default();

    state
        .execute_app_capability("app.file_read", || Ok::<_, String>(()))
        .unwrap();
    let failed = state.execute_app_capability("app.file_write", || {
        Err::<(), _>("write failed".to_string())
    });
    assert_eq!(failed.unwrap_err(), "write failed");
    let blocked = state.execute_app_capability("app.unknown", || Ok::<_, String>(()));
    assert!(blocked.unwrap_err().contains("unknown capability tool"));

    let entries = state.capability_audit_entries();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].session_id, "app");
    assert_eq!(entries[0].tool_name, "app.file_read");
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Succeeded);
    assert!(entries[0].allowed);
    assert_eq!(entries[1].tool_name, "app.file_write");
    assert_eq!(entries[1].outcome, CapabilityAuditOutcome::Failed);
    assert_eq!(entries[1].message.as_deref(), Some("write failed"));
    assert_eq!(entries[2].tool_name, "app.unknown");
    assert_eq!(entries[2].outcome, CapabilityAuditOutcome::Blocked);
    assert!(!entries[2].allowed);
}

#[test]
fn workflow_manifest_exposes_high_risk_approval_gated_tools() {
    let manifest = workflow_capability_manifest();
    let tools = manifest
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        tools,
        vec![
            "workflow.shell_command",
            "workflow.file_read",
            "workflow.file_write",
            "workflow.file_delete",
            "workflow.http_request",
            "workflow.agent_prompt",
            "workflow.browser_automation",
        ]
    );
    assert_eq!(
        manifest.approval_required_tool_names(),
        vec![
            "workflow.shell_command",
            "workflow.file_read",
            "workflow.file_write",
            "workflow.file_delete",
            "workflow.http_request",
            "workflow.agent_prompt",
            "workflow.browser_automation",
        ]
    );
    assert!(manifest.enabled_tool_names().is_empty());

    let write = manifest.tool("workflow.file_write").unwrap();
    assert_eq!(write.origin, CapabilityOrigin::Workflow);
    assert_eq!(write.approval, ApprovalPolicy::Ask);
    assert_eq!(write.risk, RiskLevel::High);
    assert!(!write.model_visible);
}

#[test]
fn mcp_tools_are_added_as_ask_approval_capabilities() {
    let manifest = capability_manifest_with_mcp_tools(&[McpToolDescriptor {
        server_id: "files".to_string(),
        server_name: "Files".to_string(),
        name: "read".to_string(),
        qualified_name: "mcp__files__read".to_string(),
        description: "Read from an MCP server".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"],
        }),
        model_visible: true,
        approval_policy: ApprovalPolicy::Ask,
        risk_level: McpToolRiskLevel::High,
        risk_reasons: vec!["can read local files".to_string()],
    }]);

    let mcp = manifest.tool("mcp__files__read").unwrap();
    assert_eq!(mcp.origin, CapabilityOrigin::Mcp);
    assert_eq!(mcp.approval, ApprovalPolicy::Ask);
    assert_eq!(mcp.risk, RiskLevel::High);
    assert!(mcp.model_visible);
    assert!(mcp.scopes.iter().any(|scope| scope == "mcp"));
    assert_eq!(mcp.parameters["properties"]["path"]["type"], "string");
    assert!(manifest
        .approval_required_tool_names()
        .iter()
        .any(|name| name == "mcp__files__read"));
}

#[test]
fn mcp_tools_honor_user_selected_auto_policy() {
    let manifest = capability_manifest_with_mcp_tools(&[McpToolDescriptor {
        server_id: "search".to_string(),
        server_name: "Search".to_string(),
        name: "web".to_string(),
        qualified_name: "mcp__search__web".to_string(),
        description: "Search through an MCP server".to_string(),
        input_schema: json!({ "type": "object", "properties": {} }),
        model_visible: true,
        approval_policy: ApprovalPolicy::Auto,
        risk_level: McpToolRiskLevel::Medium,
        risk_reasons: vec!["network or external data access".to_string()],
    }]);

    let mcp = manifest.tool("mcp__search__web").unwrap();
    assert_eq!(mcp.approval, ApprovalPolicy::Auto);
    assert_eq!(mcp.risk, RiskLevel::Medium);
    assert!(mcp
        .prompt_guidelines
        .iter()
        .any(|guideline| guideline.contains("network or external data access")));
    assert!(mcp.model_visible);
    assert_eq!(
        policy::evaluate(&manifest, "mcp__search__web", CapabilityApprovalState::None)
            .unwrap()
            .approval,
        ApprovalPolicy::Auto
    );
}

#[test]
fn hidden_mcp_tools_are_not_model_enabled_and_are_denied_by_policy() {
    let manifest = capability_manifest_with_mcp_tools(&[McpToolDescriptor {
        server_id: "files".to_string(),
        server_name: "Files".to_string(),
        name: "read".to_string(),
        qualified_name: "mcp__files__read".to_string(),
        description: "Read from an MCP server".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"],
        }),
        model_visible: false,
        approval_policy: ApprovalPolicy::Deny,
        risk_level: McpToolRiskLevel::High,
        risk_reasons: vec!["can read local files".to_string()],
    }]);

    let mcp = manifest.tool("mcp__files__read").unwrap();
    assert_eq!(mcp.approval, ApprovalPolicy::Deny);
    assert_eq!(mcp.risk, RiskLevel::High);
    assert!(!mcp.model_visible);
    assert!(!manifest.enabled_tool_names().contains(&mcp.name));
    assert_eq!(
        policy::evaluate(
            &manifest,
            "mcp__files__read",
            CapabilityApprovalState::Approved
        )
        .unwrap_err(),
        CapabilityPolicyError::Denied("mcp__files__read".to_string())
    );
}

#[test]
fn policy_allows_auto_tools_without_approval() {
    let manifest = core_capability_manifest();

    let decision = policy::evaluate(&manifest, "read", CapabilityApprovalState::None).unwrap();

    assert_eq!(decision.tool_name, "read");
    assert_eq!(decision.approval, ApprovalPolicy::Auto);
    assert_eq!(decision.risk, RiskLevel::Low);
    assert_eq!(decision.origin, CapabilityOrigin::TeraxCore);
}

#[test]
fn policy_requires_approval_for_ask_tools() {
    let manifest = core_capability_manifest();

    let error = policy::evaluate(&manifest, "bash", CapabilityApprovalState::None).unwrap_err();
    assert_eq!(
        error,
        CapabilityPolicyError::ApprovalRequired("bash".to_string())
    );

    let approved = policy::evaluate(&manifest, "bash", CapabilityApprovalState::Approved).unwrap();
    assert_eq!(approved.tool_name, "bash");
    assert_eq!(approved.approval, ApprovalPolicy::Ask);
}

#[test]
fn policy_blocks_missing_and_denied_tools() {
    let mut manifest = core_capability_manifest();
    manifest.tool_mut("read").unwrap().approval = ApprovalPolicy::Deny;

    assert_eq!(
        policy::evaluate(&manifest, "read", CapabilityApprovalState::Approved).unwrap_err(),
        CapabilityPolicyError::Denied("read".to_string())
    );
    assert_eq!(
        policy::evaluate(&manifest, "unknown", CapabilityApprovalState::Approved).unwrap_err(),
        CapabilityPolicyError::UnknownTool("unknown".to_string())
    );
}

#[test]
fn audit_log_records_bounded_ordered_entries() {
    let audit = CapabilityAuditLog::with_capacity(2);

    audit.record(CapabilityAuditEntry::new(
        "pi-1",
        "call-1",
        "read",
        false,
        true,
        CapabilityAuditOutcome::Succeeded,
        None,
    ));
    audit.record(CapabilityAuditEntry::new(
        "pi-1",
        "call-2",
        "bash",
        true,
        false,
        CapabilityAuditOutcome::Blocked,
        Some("approval required".to_string()),
    ));
    audit.record(CapabilityAuditEntry::new(
        "pi-1",
        "call-3",
        "mcp__files__read",
        true,
        true,
        CapabilityAuditOutcome::Failed,
        Some("server exited".to_string()),
    ));

    let entries = audit.entries();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].sequence, 2);
    assert_eq!(entries[0].tool_name, "bash");
    assert_eq!(entries[0].outcome, CapabilityAuditOutcome::Blocked);
    assert_eq!(entries[1].sequence, 3);
    assert_eq!(entries[1].tool_name, "mcp__files__read");
    assert_eq!(entries[1].message.as_deref(), Some("server exited"));
}
