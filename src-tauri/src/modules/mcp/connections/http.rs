#![allow(dead_code)]
use std::sync::atomic::Ordering;
use tokio::sync::Mutex;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};

use super::{infer_mcp_tool_risk, sanitize_mcp_tool, sanitize_stderr_text, McpToolInternal};
use crate::modules::capabilities::ApprovalPolicy;

use super::super::sanitize::{
    normalize_tool_result, sanitize_text_token, truncate_text, validate_http_url,
};
use super::super::{
    McpServerConfig, McpServerStatus, McpToolCallResult, McpToolDescriptor, McpTransport,
    MCP_FAILURE_LIMIT, MCP_HTTP_BODY_LIMIT, MCP_NAME_LIMIT, MCP_PROTOCOL_VERSION,
    MCP_REQUEST_TIMEOUT,
};

pub(in crate::modules::mcp) struct McpHttpConnection {
    server_id: String,
    server_name: String,
    url: String,
    oauth_token: Option<String>,
    client: reqwest::Client,
    session_id: Mutex<Option<String>>,
    last_failure: Mutex<Option<String>>,
    next_id: std::sync::atomic::AtomicU64,
    tools: Mutex<Vec<McpToolInternal>>,
}

impl McpHttpConnection {
    pub(super) fn new(
        server_id: String,
        server_name: String,
        config: McpServerConfig,
    ) -> Result<Self, String> {
        let url = validate_http_url(config.url.as_deref())?;
        let oauth_token = config
            .oauth_token_env
            .as_deref()
            .and_then(|name| {
                config
                    .env
                    .iter()
                    .find(|item| item.name == name)
                    .map(|item| item.value.clone())
            })
            .filter(|value| !value.is_empty());
        let client = reqwest::Client::builder()
            .timeout(MCP_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| format!("failed to create MCP HTTP client: {error}"))?;
        Ok(Self {
            server_id,
            server_name,
            url,
            oauth_token,
            client,
            session_id: Mutex::new(None),
            last_failure: Mutex::new(None),
            next_id: std::sync::atomic::AtomicU64::new(1),
            tools: Mutex::new(Vec::new()),
        })
    }

    pub(super) async fn initialize_async(&self) -> Result<(), String> {
        let _ = self
            .request_async(
                "initialize",
                json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "terax", "version": env!("CARGO_PKG_VERSION") },
                }),
            )
            .await?;
        self.notify_async("notifications/initialized", json!({}))
            .await
    }

    pub(super) async fn refresh_tools_async(&self) -> Result<(), String> {
        let result = self.request_async("tools/list", json!({})).await?;
        let list = result
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| "MCP tools/list response did not contain a tools array".to_string())?;
        let tools = list
            .iter()
            .filter_map(|tool| sanitize_mcp_tool(&self.server_id, tool))
            .collect::<Vec<_>>();
        let mut guard = self.tools.lock().await;
        *guard = tools;
        Ok(())
    }

    pub(super) fn public_tools(&self) -> Result<Vec<McpToolDescriptor>, String> {
        let tools = self
            .tools
            .try_lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))?;
        Ok(tools
            .iter()
            .map(|tool| {
                let (risk_level, risk_reasons) = infer_mcp_tool_risk(tool, McpTransport::Http);
                McpToolDescriptor {
                    server_id: self.server_id.clone(),
                    server_name: self.server_name.clone(),
                    name: tool.name.clone(),
                    qualified_name: tool.qualified_name.clone(),
                    description: tool.description.clone(),
                    input_schema: tool.input_schema.clone(),
                    model_visible: true,
                    approval_policy: ApprovalPolicy::Ask,
                    risk_level,
                    risk_reasons,
                }
            })
            .collect())
    }

    pub(super) async fn call_tool_by_key_async(
        &self,
        tool_key: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        let raw_name = {
            let tools = self.tools.lock().await;
            tools
                .iter()
                .find(|tool| tool.key == tool_key)
                .map(|tool| tool.raw_name.clone())
                .ok_or_else(|| format!("MCP tool not found: mcp__{}__{tool_key}", self.server_id))?
        };
        let result = self
            .request_async(
                "tools/call",
                json!({
                    "name": raw_name,
                    "arguments": if arguments.is_object() { arguments } else { json!({}) },
                }),
            )
            .await?;
        Ok(normalize_tool_result(result))
    }

    async fn request_async(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let envelope = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let value = self.post_envelope_async(&envelope).await?;
        if let Some(error) = value.get("error") {
            return Err(self.record_failure(
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP HTTP request failed")
                    .to_string(),
            ));
        }
        Ok(value.get("result").cloned().unwrap_or_else(|| json!({})))
    }

    async fn notify_async(&self, method: &str, params: Value) -> Result<(), String> {
        let envelope = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.post_envelope_async(&envelope).await.map(|_| ())
    }

    async fn post_envelope_async(&self, envelope: &Value) -> Result<Value, String> {
        let body = serde_json::to_vec(envelope).map_err(|error| error.to_string())?;
        let mut request = self
            .client
            .post(&self.url)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .header("Mcp-Protocol-Version", MCP_PROTOCOL_VERSION)
            .body(body);
        if let Some(session_id) = self.session_id.lock().await.clone() {
            request = request.header("Mcp-Session-Id", session_id);
        }
        if let Some(token) = self.oauth_token.as_deref() {
            request = request.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| self.record_failure(format!("MCP HTTP request failed: {error}")))?;
        if let Some(session_id) = response
            .headers()
            .get("Mcp-Session-Id")
            .and_then(|value| value.to_str().ok())
            .map(|value| sanitize_text_token(value, MCP_NAME_LIMIT))
            .filter(|value| !value.is_empty())
        {
            *self.session_id.lock().await = Some(session_id);
        }
        if response.status().as_u16() == 202 {
            return Ok(json!({}));
        }
        if !response.status().is_success() {
            let status = response.status();
            let body: String = response.text().await.unwrap_or_default();
            return Err(self.record_failure(format!(
                "MCP HTTP server returned {status}: {}",
                truncate_text(&sanitize_stderr_text(&body), MCP_FAILURE_LIMIT)
            )));
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| self.record_failure(format!("MCP HTTP response failed: {error}")))?;
        if bytes.len() > MCP_HTTP_BODY_LIMIT {
            return Err(self.record_failure("MCP HTTP response body too large".to_string()));
        }
        if bytes.is_empty() {
            return Ok(json!({}));
        }
        parse_http_rpc_response(&bytes, &content_type).map_err(|error| self.record_failure(error))
    }

    fn record_failure(&self, error: String) -> String {
        let sanitized = truncate_text(&sanitize_stderr_text(&error), MCP_FAILURE_LIMIT);
        if let Ok(mut last_failure) = self.last_failure.try_lock() {
            *last_failure = Some(sanitized.clone());
        }
        sanitized
    }

    pub(super) fn status(&self) -> Result<McpServerStatus, String> {
        let tool_count = self
            .tools
            .try_lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))?
            .len();
        let last_failure = self
            .last_failure
            .try_lock()
            .ok()
            .and_then(|value| value.clone());
        Ok(McpServerStatus {
            server_id: self.server_id.clone(),
            server_name: self.server_name.clone(),
            transport: McpTransport::Http,
            status: "connected".to_string(),
            tool_count,
            exit_code: None,
            stderr_tail: String::new(),
            last_failure,
            restart_backoff_ms: None,
        })
    }

    pub(super) fn shutdown(&self) {}
}

fn parse_http_rpc_response(bytes: &[u8], content_type: &str) -> Result<Value, String> {
    if content_type.contains("text/event-stream") {
        let body = String::from_utf8_lossy(bytes);
        for event in body.split("\n\n") {
            let data = event
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim)
                .collect::<Vec<_>>()
                .join("\n");
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                return Ok(value);
            }
        }
        return Err("MCP HTTP event stream did not contain JSON-RPC data".to_string());
    }
    serde_json::from_slice(bytes)
        .map_err(|error| format!("invalid MCP HTTP JSON response: {error}"))
}
