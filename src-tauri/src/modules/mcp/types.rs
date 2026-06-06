use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::modules::capabilities::ApprovalPolicy;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    #[default]
    Stdio,
    Http,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub transport: McpTransport,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_token_env: Option<String>,
    #[serde(default)]
    pub env: Vec<McpEnvVar>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStoredServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub transport: McpTransport,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_token_env: Option<String>,
    #[serde(default)]
    pub env: Vec<McpStoredEnvVar>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStoredEnvVar {
    pub name: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpToolRiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub server_id: String,
    pub server_name: String,
    pub name: String,
    pub qualified_name: String,
    pub description: String,
    pub input_schema: Value,
    pub model_visible: bool,
    pub approval_policy: ApprovalPolicy,
    pub risk_level: McpToolRiskLevel,
    pub risk_reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolPreference {
    pub qualified_name: String,
    pub model_visible: bool,
    #[serde(default = "default_mcp_approval_policy")]
    pub approval_policy: ApprovalPolicy,
}

fn default_mcp_approval_policy() -> ApprovalPolicy {
    ApprovalPolicy::Ask
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub server_id: String,
    pub server_name: String,
    pub transport: McpTransport,
    pub status: String,
    pub tool_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub stderr_tail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_backoff_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEnvSecretStatus {
    pub server_id: String,
    pub name: String,
    pub configured: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthStartRequest {
    pub server_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_uri: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthStartResult {
    pub server_id: String,
    pub authorization_url: String,
    pub state: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub client_id: String,
    pub token_env: String,
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthCompleteRequest {
    pub server_id: String,
    pub code_or_redirect_url: String,
    pub state: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub client_id: String,
    pub token_env: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthCompleteResult {
    pub server_id: String,
    pub token_env: String,
    pub access_token_stored: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthCallbackWaitRequest {
    pub state: String,
    pub redirect_uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthCallbackWaitResult {
    pub code_or_redirect_url: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpOAuthMetadata {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpOAuthTokenResponse {
    pub access_token: String,
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpContent {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip)]
    pub raw_data: Option<String>,
}
