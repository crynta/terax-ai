use serde::{Deserialize, Serialize};

use crate::modules::workspace::WorkspaceEnv;

use crate::modules::capabilities::audit::CapabilityAuditEntry;

pub const PI_SESSION_EVENT_NAME: &str = "pi:session-event";

pub mod session_event_type {
    pub const CREATED: &str = "session.created";
    pub const RESUMED: &str = "session.resumed";
    pub const INPUT: &str = "session.input";
    pub const PROGRESS: &str = "session.progress";
    pub const REASONING_DELTA: &str = "session.reasoning.delta";
    pub const REASONING_TEXT: &str = "session.reasoning.text";
    pub const OUTPUT_DELTA: &str = "session.output.delta";
    pub const OUTPUT_TEXT: &str = "session.output.text";
    pub const TOOL_START: &str = "session.tool.start";
    pub const TOOL_UPDATE: &str = "session.tool.update";
    pub const TOOL_APPROVAL_REQUESTED: &str = "session.tool.approval.requested";
    pub const TOOL_APPROVAL_RESPONDED: &str = "session.tool.approval.responded";
    pub const TOOL_RESULT: &str = "session.tool.result";
    pub const STATUS: &str = "session.status";
    pub const RENAMED: &str = "session.renamed";
    pub const DELETED: &str = "session.deleted";
    pub const ARCHIVED: &str = "session.archived";
    pub const RESTORED: &str = "session.restored";
    pub const FORKED: &str = "session.forked";
    pub const ROLLBACK: &str = "session.rollback";
    pub const USAGE: &str = "session.usage";
    pub const TURN_DIFF: &str = "session.turn_diff";
    pub const QUESTION_RESPONDED: &str = "session.question.responded";
    pub const ERROR: &str = "session.error";
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeSnapshot {
    pub phase: PiPhase,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiErrorData {
    pub code: String,
    pub category: String,
    pub retryable: bool,
    pub remediation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCommandError {
    pub message: String,
    pub code: Option<String>,
    pub category: Option<String>,
    pub retryable: Option<bool>,
    pub remediation: Option<String>,
}

impl PiCommandError {
    pub(super) fn plain(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
            category: None,
            retryable: None,
            remediation: None,
        }
    }
}

impl From<String> for PiCommandError {
    fn from(message: String) -> Self {
        Self::plain(message)
    }
}

impl From<&str> for PiCommandError {
    fn from(message: &str) -> Self {
        Self::plain(message)
    }
}

pub(crate) type PiCommandResult<T> = Result<T, PiCommandError>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiPhase {
    Disconnected,
    Starting,
    Ready,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiHostInfo {
    pub host_version: String,
    pub pi_sdk_loaded: bool,
    pub pi_packages: Vec<PiPackageInfo>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDiagnostics {
    pub host_version: String,
    pub pi_sdk_loaded: bool,
    pub pi_packages: Vec<PiPackageInfo>,
    pub node: PiNodeDiagnostics,
    pub config: PiConfigDiagnostics,
    #[serde(default)]
    pub capabilities: PiCapabilityDiagnostics,
    #[serde(default)]
    pub protocol: PiProtocolDiagnostics,
    #[serde(default)]
    pub limits: PiLimitDiagnostics,
    #[serde(default)]
    pub manager: PiManagerDiagnostics,
    #[serde(default)]
    pub capability_audit: Vec<CapabilityAuditEntry>,
    pub sessions: Vec<PiDiagnosticSession>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNodeDiagnostics {
    pub version: String,
    pub exec_path: String,
    pub platform: String,
    pub arch: String,
    pub pid: u32,
    pub cwd: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiConfigDiagnostics {
    pub tool_mode: String,
    #[serde(default)]
    pub enabled_tools: Vec<String>,
    #[serde(default)]
    pub approval_required_tools: Vec<String>,
    pub session_storage: String,
    pub api_keys: Vec<PiEnvVarStatus>,
    #[serde(default)]
    pub forwarded_env_names: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCapabilityDiagnostics {
    pub tools: bool,
    pub files: bool,
    pub shell: bool,
    pub git: bool,
    pub terminal: bool,
    pub editor: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProtocolDiagnostics {
    pub protocol_version: u32,
    pub allowed_methods: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiLimitDiagnostics {
    pub max_prompt_chars: usize,
    pub max_sessions: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiManagerDiagnostics {
    pub idle_shutdown_ms: u64,
    pub method_timeouts: Vec<PiMethodTimeoutDiagnostics>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiMethodTimeoutDiagnostics {
    pub method: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiEnvVarStatus {
    pub name: String,
    pub configured: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDiagnosticSession {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk_session_file: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageInfo {
    pub name: String,
    pub version: Option<String>,
    pub loaded: bool,
    pub export_count: usize,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSession {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub cwd: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_env: Option<WorkspaceEnv>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk_session_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<PiSessionForkRef>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionForkRef {
    pub parent_session_id: String,
    pub fork_event_id: Option<String>,
}

/// Per-turn usage telemetry record. Stored as a `session.usage` event payload.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiUsageRecord {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

/// Aggregated usage summary for a session or across sessions.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiUsageSummary {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_input_tokens: u64,
    pub total_cost_usd: f64,
    pub turn_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by_model: Option<Vec<PiUsageModelBreakdown>>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiUsageModelBreakdown {
    pub model_id: String,
    pub provider_id: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub cost_usd: f64,
    pub turn_count: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: String,
    pub created_at: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionEventBranchPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<PiSessionBranchPayload>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionBranchPayload {
    pub group_id: String,
    pub index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regenerated_from_event_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionTextPayload {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<PiSessionBranchPayload>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionInputPayload {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<PiPromptContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<PiSessionBranchPayload>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionToolPayload {
    pub tool_call_id: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<PiSessionToolOutputPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<PiSessionBranchPayload>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionToolOutputPayload {
    pub content: String,
    #[serde(default)]
    pub details: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionStatusPayload {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<PiSessionBranchPayload>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionsList {
    pub sessions: Vec<PiSession>,
    #[serde(default)]
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionCreateResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionSendResult {
    pub accepted: bool,
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionResumeResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionToolRespondResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPromptContext {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub active_terminal_cwd: Option<String>,
    #[serde(default)]
    pub active_file: Option<String>,
    #[serde(default)]
    pub active_terminal_private: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiAuthMode {
    #[default]
    Terax,
    Profile,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderConfig {
    pub provider: String,
    pub model_id: String,
    #[serde(default)]
    pub source_model_id: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub context_limit: Option<u32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub reasoning: Option<bool>,
    #[serde(default)]
    pub custom_endpoint_id: Option<String>,
    #[serde(default)]
    pub thinking_level: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<PiAuthMode>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProfileModelInfo {
    pub provider: String,
    pub provider_label: String,
    pub id: String,
    pub label: String,
    pub available: bool,
    pub context_window: Option<u32>,
    pub max_tokens: Option<u32>,
    pub reasoning: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProfileModelsList {
    pub profile_agent_dir: String,
    pub load_error: Option<String>,
    pub models: Vec<PiProfileModelInfo>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiLocalAgentBinaryStatus {
    pub binary: String,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiLocalAgentsStatus {
    pub agents: Vec<PiLocalAgentBinaryStatus>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionRenameResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionDeleteResult {
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiArtifactDeleteResult {
    pub deleted: bool,
    pub deleted_count: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionDeleteWithArtifactsResult {
    pub session_delete: PiSessionDeleteResult,
    pub artifact_delete: Option<PiArtifactDeleteResult>,
    pub artifact_cleanup_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionStopResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

impl Default for PiRuntimeSnapshot {
    fn default() -> Self {
        Self {
            phase: PiPhase::Disconnected,
            detail: None,
        }
    }
}
