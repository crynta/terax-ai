use serde_json::Value;

use crate::modules::mcp::{McpToolDescriptor, McpToolRiskLevel};

use super::schemas::*;
use super::{
    ApprovalPolicy, CapabilityKind, CapabilityManifest, CapabilityOrigin, CapabilityTool,
    RiskLevel, CAPABILITY_MANIFEST_VERSION,
};

pub fn capability_manifest_with_mcp_tools(mcp_tools: &[McpToolDescriptor]) -> CapabilityManifest {
    let mut manifest = core_capability_manifest();
    manifest
        .tools
        .extend(mcp_tools.iter().map(mcp_tool_capability));
    manifest
}

pub fn app_capability_manifest() -> CapabilityManifest {
    CapabilityManifest {
        version: CAPABILITY_MANIFEST_VERSION,
        tools: vec![
            app_tool(
                "app.shell_command",
                "app shell command",
                "Run a direct Terax shell command through Rust policy and audit.",
                bash_schema(),
                CapabilityKind::ProcessExec,
                RiskLevel::High,
                &["app", "process"],
            ),
            app_tool(
                "app.shell_session",
                "app shell session",
                "Open or run a direct Terax shell session through Rust policy and audit.",
                bash_schema(),
                CapabilityKind::ProcessExec,
                RiskLevel::High,
                &["app", "process"],
            ),
            app_tool(
                "app.shell_background",
                "app background shell",
                "Spawn a direct Terax background shell command through Rust policy and audit.",
                bash_schema(),
                CapabilityKind::ProcessExec,
                RiskLevel::High,
                &["app", "process"],
            ),
            app_tool(
                "app.file_read",
                "app file read",
                "Read a direct Terax-selected file through Rust policy and audit.",
                read_schema(),
                CapabilityKind::FileRead,
                RiskLevel::Low,
                &["app", "workspace"],
            ),
            app_tool(
                "app.file_list",
                "app file list",
                "List direct Terax-selected directories through Rust policy and audit.",
                ls_schema(),
                CapabilityKind::FileList,
                RiskLevel::Low,
                &["app", "workspace"],
            ),
            app_tool(
                "app.file_search",
                "app file search",
                "Search direct Terax-selected files through Rust policy and audit.",
                grep_schema(),
                CapabilityKind::FileSearch,
                RiskLevel::Low,
                &["app", "workspace"],
            ),
            app_tool(
                "app.file_write",
                "app file write",
                "Create, overwrite, copy, rename, or delete direct Terax-selected files through Rust policy and audit.",
                write_schema(),
                CapabilityKind::FileWrite,
                RiskLevel::High,
                &["app", "workspace"],
            ),
            app_tool(
                "app.http_request",
                "app HTTP request",
                "Send a direct Terax HTTP request through Rust policy and audit.",
                http_request_schema(),
                CapabilityKind::HttpRequest,
                RiskLevel::Medium,
                &["app", "network"],
            ),
        ],
    }
}

pub fn workflow_capability_manifest() -> CapabilityManifest {
    CapabilityManifest {
        version: CAPABILITY_MANIFEST_VERSION,
        tools: vec![
            workflow_tool(
                "workflow.shell_command",
                "workflow shell command",
                "Run an approved workflow shell command through Terax Rust policy.",
                "Run workflow shell commands only after explicit user approval",
                vec!["Workflow shell commands are high-risk process execution and require explicit approval."],
                bash_schema(),
                CapabilityKind::ProcessExec,
                &["workflow", "process"],
            ),
            workflow_tool(
                "workflow.file_read",
                "workflow file read",
                "Read a workflow-selected file through Terax Rust policy.",
                "Read workflow files only after explicit workflow approval",
                vec!["Workflow file reads can expose workspace contents and require explicit approval."],
                read_schema(),
                CapabilityKind::FileRead,
                &["workflow", "workspace"],
            ),
            workflow_tool(
                "workflow.file_write",
                "workflow file write",
                "Create or overwrite a workflow-selected file through Terax Rust policy.",
                "Write workflow files only after explicit workflow approval",
                vec!["Workflow file writes can overwrite workspace contents and require explicit approval."],
                write_schema(),
                CapabilityKind::FileWrite,
                &["workflow", "workspace"],
            ),
            workflow_tool(
                "workflow.file_delete",
                "workflow file delete",
                "Delete a workflow-selected file or directory through Terax Rust policy.",
                "Delete workflow paths only after explicit workflow approval",
                vec!["Workflow file deletes are destructive and require explicit approval."],
                delete_schema(),
                CapabilityKind::FileWrite,
                &["workflow", "workspace"],
            ),
            workflow_tool(
                "workflow.http_request",
                "workflow HTTP request",
                "Send a workflow-selected HTTP request through Terax Rust policy.",
                "Send workflow HTTP requests only after explicit workflow approval",
                vec!["Workflow HTTP requests can contact external services and require explicit approval."],
                http_request_schema(),
                CapabilityKind::HttpRequest,
                &["workflow", "network"],
            ),
            workflow_tool(
                "workflow.agent_prompt",
                "workflow agent prompt",
                "Run a workflow-selected Pi agent prompt through Terax Rust policy.",
                "Run workflow agent prompts only after explicit workflow approval",
                vec!["Workflow agent prompts can use available tools and require explicit approval."],
                agent_prompt_schema(),
                CapabilityKind::AgentRun,
                &["workflow", "agent"],
            ),
            workflow_tool(
                "workflow.browser_automation",
                "workflow browser automation",
                "Run workflow browser automation through a Pi agent under Terax Rust policy.",
                "Run workflow browser automation only after explicit workflow approval",
                vec!["Workflow browser automation can interact with websites and requires explicit approval."],
                browser_automation_schema(),
                CapabilityKind::BrowserAutomation,
                &["workflow", "agent", "browser"],
            ),
        ],
    }
}

fn mcp_risk_level(risk: McpToolRiskLevel) -> RiskLevel {
    match risk {
        McpToolRiskLevel::Low => RiskLevel::Low,
        McpToolRiskLevel::Medium => RiskLevel::Medium,
        McpToolRiskLevel::High => RiskLevel::High,
    }
}

fn mcp_tool_capability(tool: &McpToolDescriptor) -> CapabilityTool {
    let mut prompt_guidelines = vec![
        "MCP tools are provided by external servers; inspect arguments carefully before approval."
            .to_string(),
    ];
    prompt_guidelines.extend(
        tool.risk_reasons
            .iter()
            .map(|reason| format!("Risk signal: {reason}")),
    );
    CapabilityTool {
        id: format!("mcp.{}", tool.qualified_name),
        name: tool.qualified_name.clone(),
        label: format!("{}: {}", tool.server_name, tool.name),
        description: format!("[MCP:{}] {}", tool.server_name, tool.description),
        prompt_snippet: format!(
            "Call MCP tool {} through Terax Rust after approval",
            tool.qualified_name
        ),
        prompt_guidelines,
        parameters: tool.input_schema.clone(),
        origin: CapabilityOrigin::Mcp,
        kind: CapabilityKind::McpTool,
        risk: mcp_risk_level(tool.risk_level),
        scopes: vec!["mcp".to_string()],
        approval: if tool.model_visible {
            tool.approval_policy
        } else {
            ApprovalPolicy::Deny
        },
        model_visible: tool.model_visible && tool.approval_policy != ApprovalPolicy::Deny,
    }
}

pub fn core_capability_manifest() -> CapabilityManifest {
    CapabilityManifest {
        version: CAPABILITY_MANIFEST_VERSION,
        tools: vec![
            tool(
                "pi.read",
                "read",
                "read",
                "Read the contents of a workspace file. Supports offset/limit for large text files. Terax validates and executes the read in Rust.",
                "Read file contents through Terax Rust",
                vec!["Use read to examine files instead of cat or sed."],
                read_schema(),
                CapabilityKind::FileRead,
                RiskLevel::Low,
                ApprovalPolicy::Auto,
                &["workspace"],
            ),
            tool(
                "pi.ls",
                "ls",
                "ls",
                "List workspace directory contents. Terax validates and executes the listing in Rust.",
                "List directory contents through Terax Rust",
                vec![],
                ls_schema(),
                CapabilityKind::FileList,
                RiskLevel::Low,
                ApprovalPolicy::Auto,
                &["workspace"],
            ),
            tool(
                "pi.grep",
                "grep",
                "grep",
                "Search workspace file contents for a pattern. Terax validates and executes the search in Rust.",
                "Search file contents through Terax Rust",
                vec![],
                grep_schema(),
                CapabilityKind::FileSearch,
                RiskLevel::Low,
                ApprovalPolicy::Auto,
                &["workspace"],
            ),
            tool(
                "pi.find",
                "find",
                "find",
                "Search for workspace files by glob pattern. Terax validates and executes the search in Rust.",
                "Find files through Terax Rust",
                vec![],
                find_schema(),
                CapabilityKind::FileSearch,
                RiskLevel::Low,
                ApprovalPolicy::Auto,
                &["workspace"],
            ),
            tool(
                "pi.bash",
                "bash",
                "bash",
                "Request a shell command. Terax approval policy and Rust execute the command rather than Pi's built-in shell backend.",
                "Run shell commands through Terax Rust after approval",
                vec!["Use bash for file operations like ls, rg, find only when dedicated tools are insufficient."],
                bash_schema(),
                CapabilityKind::ProcessExec,
                RiskLevel::High,
                ApprovalPolicy::Ask,
                &["workspace", "process"],
            ),
            tool(
                "pi.edit",
                "edit",
                "edit",
                "Apply exact text replacements to a workspace file. Terax approval policy and Rust execute the edit rather than Pi's built-in editor.",
                "Edit files through Terax Rust after approval",
                vec!["Use edit for precise changes with exact text replacement."],
                edit_schema(),
                CapabilityKind::FileWrite,
                RiskLevel::High,
                ApprovalPolicy::Ask,
                &["workspace"],
            ),
            tool(
                "pi.write",
                "write",
                "write",
                "Create or overwrite a workspace file. Terax approval policy and Rust execute the write rather than Pi's built-in writer.",
                "Write files through Terax Rust after approval",
                vec!["Use write only for new files or complete rewrites."],
                write_schema(),
                CapabilityKind::FileWrite,
                RiskLevel::High,
                ApprovalPolicy::Ask,
                &["workspace"],
            ),
            tool(
                "pi.create_artifact",
                "create_artifact",
                "create artifact",
                "Create a durable app-owned artifact for the current Pi conversation. Terax Rust derives the conversation from the verified session.",
                "Create conversation artifacts through Terax Rust",
                artifact_guidelines(),
                create_artifact_schema(),
                CapabilityKind::ArtifactWrite,
                RiskLevel::Medium,
                ApprovalPolicy::Auto,
                &["artifact"],
            ),
            tool(
                "pi.edit_artifact",
                "edit_artifact",
                "edit artifact",
                "Apply exact text replacements to an artifact in the current Pi conversation. Terax Rust version-controls the artifact.",
                "Edit conversation artifacts through Terax Rust",
                artifact_guidelines(),
                edit_artifact_schema(),
                CapabilityKind::ArtifactWrite,
                RiskLevel::Medium,
                ApprovalPolicy::Auto,
                &["artifact"],
            ),
            tool(
                "pi.read_artifact",
                "read_artifact",
                "read artifact",
                "Read artifact content from the current Pi conversation. Terax Rust caps returned content size.",
                "Read conversation artifacts through Terax Rust",
                artifact_guidelines(),
                read_artifact_schema(),
                CapabilityKind::ArtifactRead,
                RiskLevel::Low,
                ApprovalPolicy::Auto,
                &["artifact"],
            ),
            tool(
                "pi.list_artifacts",
                "list_artifacts",
                "list artifacts",
                "List artifact summaries for the current Pi conversation without returning full content.",
                "List conversation artifacts through Terax Rust",
                artifact_guidelines(),
                list_artifacts_schema(),
                CapabilityKind::ArtifactRead,
                RiskLevel::Low,
                ApprovalPolicy::Auto,
                &["artifact"],
            ),
        ],
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "Workflow capability declarations are compact data rows"
)]
fn workflow_tool(
    name: &str,
    label: &str,
    description: &str,
    prompt_snippet: &str,
    prompt_guidelines: Vec<&str>,
    parameters: Value,
    kind: CapabilityKind,
    scopes: &[&str],
) -> CapabilityTool {
    CapabilityTool {
        id: name.to_string(),
        name: name.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        prompt_snippet: prompt_snippet.to_string(),
        prompt_guidelines: prompt_guidelines.into_iter().map(str::to_string).collect(),
        parameters,
        origin: CapabilityOrigin::Workflow,
        kind,
        risk: RiskLevel::High,
        scopes: scopes.iter().map(|scope| (*scope).to_string()).collect(),
        approval: ApprovalPolicy::Ask,
        model_visible: false,
    }
}

fn app_tool(
    name: &str,
    label: &str,
    description: &str,
    parameters: Value,
    kind: CapabilityKind,
    risk: RiskLevel,
    scopes: &[&str],
) -> CapabilityTool {
    CapabilityTool {
        id: name.to_string(),
        name: name.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        prompt_snippet: description.to_string(),
        prompt_guidelines: Vec::new(),
        parameters,
        origin: CapabilityOrigin::TeraxCore,
        kind,
        risk,
        scopes: scopes.iter().map(|scope| (*scope).to_string()).collect(),
        approval: ApprovalPolicy::Auto,
        model_visible: false,
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "Capability declarations are data rows; named builder fields would add noise"
)]
fn tool(
    id: &str,
    name: &str,
    label: &str,
    description: &str,
    prompt_snippet: &str,
    prompt_guidelines: Vec<&str>,
    parameters: Value,
    kind: CapabilityKind,
    risk: RiskLevel,
    approval: ApprovalPolicy,
    scopes: &[&str],
) -> CapabilityTool {
    CapabilityTool {
        id: id.to_string(),
        name: name.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        prompt_snippet: prompt_snippet.to_string(),
        prompt_guidelines: prompt_guidelines.into_iter().map(str::to_string).collect(),
        parameters,
        origin: CapabilityOrigin::TeraxCore,
        kind,
        risk,
        scopes: scopes.iter().map(|scope| (*scope).to_string()).collect(),
        approval,
        model_visible: true,
    }
}
