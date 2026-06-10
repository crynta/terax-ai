use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Value};

use super::sanitize::{safe_tool_key, sanitize_input_schema, sanitize_text_token};
use super::{
    McpServerConfig, McpServerStatus, McpToolCallResult, McpToolDescriptor, McpToolRiskLevel,
    McpTransport, MCP_DESCRIPTION_LIMIT, MCP_NAME_LIMIT,
};

pub(super) mod http;
pub(super) mod stdio;

pub(super) use http::McpHttpConnection;
pub(super) use stdio::McpStdioConnection;

pub(super) enum McpConnection {
    Stdio(McpStdioConnection),
    Http(McpHttpConnection),
}

impl McpConnection {
    pub(super) fn spawn(
        server_id: String,
        server_name: String,
        config: McpServerConfig,
    ) -> Result<Self, String> {
        match config.transport {
            McpTransport::Stdio => Ok(Self::Stdio(McpStdioConnection::spawn(
                server_id,
                server_name,
                config,
            )?)),
            McpTransport::Http => Ok(Self::Http(McpHttpConnection::new(
                server_id,
                server_name,
                config,
            )?)),
        }
    }

    pub(super) fn initialize(&self) -> Result<(), String> {
        match self {
            Self::Stdio(connection) => connection.initialize(),
            Self::Http(_) => Err("use initialize_async for HTTP connections".to_string()),
        }
    }

    pub(super) fn refresh_tools(&self) -> Result<(), String> {
        match self {
            Self::Stdio(connection) => connection.refresh_tools(),
            Self::Http(_) => Err("use refresh_tools_async for HTTP connections".to_string()),
        }
    }

    pub(super) async fn initialize_async(self: &Arc<Self>) -> Result<(), String> {
        match self.as_ref() {
            Self::Stdio(_) => {
                let this = Arc::clone(self);
                tauri::async_runtime::spawn_blocking(move || match this.as_ref() {
                    Self::Stdio(connection) => connection.initialize(),
                    Self::Http(_) => Err("use initialize_async for HTTP connections".to_string()),
                })
                .await
                .map_err(|error| format!("MCP stdio initialize task failed: {error}"))?
            }
            Self::Http(connection) => connection.initialize_async().await,
        }
    }

    pub(super) async fn refresh_tools_async(self: &Arc<Self>) -> Result<(), String> {
        match self.as_ref() {
            Self::Stdio(_) => {
                let this = Arc::clone(self);
                tauri::async_runtime::spawn_blocking(move || match this.as_ref() {
                    Self::Stdio(connection) => connection.refresh_tools(),
                    Self::Http(_) => {
                        Err("use refresh_tools_async for HTTP connections".to_string())
                    }
                })
                .await
                .map_err(|error| format!("MCP stdio refresh_tools task failed: {error}"))?
            }
            Self::Http(connection) => connection.refresh_tools_async().await,
        }
    }

    pub(super) fn public_tools(&self) -> Result<Vec<McpToolDescriptor>, String> {
        match self {
            Self::Stdio(connection) => connection.public_tools(),
            Self::Http(connection) => connection.public_tools(),
        }
    }

    pub(super) fn call_tool_by_key(
        &self,
        tool_key: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        match self {
            Self::Stdio(connection) => connection.call_tool_by_key(tool_key, arguments),
            Self::Http(_) => Err("use call_tool_by_key_async for HTTP connections".to_string()),
        }
    }

    pub(super) async fn call_tool_by_key_async(
        self: &Arc<Self>,
        tool_key: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        match self.as_ref() {
            Self::Stdio(_) => {
                let this = Arc::clone(self);
                let tool_key = tool_key.to_string();
                tauri::async_runtime::spawn_blocking(move || match this.as_ref() {
                    Self::Stdio(connection) => connection.call_tool_by_key(&tool_key, arguments),
                    Self::Http(_) => {
                        Err("use call_tool_by_key_async for HTTP connections".to_string())
                    }
                })
                .await
                .map_err(|error| format!("MCP stdio call_tool task failed: {error}"))?
            }
            Self::Http(connection) => connection.call_tool_by_key_async(tool_key, arguments).await,
        }
    }

    pub(super) fn status(&self) -> Result<McpServerStatus, String> {
        match self {
            Self::Stdio(connection) => connection.status(),
            Self::Http(connection) => connection.status(),
        }
    }

    pub(super) fn shutdown(&self) {
        match self {
            Self::Stdio(connection) => connection.shutdown(),
            Self::Http(connection) => connection.shutdown(),
        }
    }
}

impl Drop for McpConnection {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub(super) type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

pub(super) fn remove_pending_response(pending: &PendingMap, id: u64) {
    if let Ok(mut pending) = pending.lock() {
        pending.remove(&id);
    }
}

#[cfg(test)]
mod pending_tests {
    use super::*;

    #[test]
    fn remove_pending_response_drops_timed_out_sender() {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (tx, _rx) = mpsc::channel::<Result<Value, String>>();
        pending.lock().unwrap().insert(7, tx);

        remove_pending_response(&pending, 7);

        assert!(pending.lock().unwrap().is_empty());
    }
}

#[derive(Clone, Debug)]
pub(super) struct McpToolInternal {
    pub(super) raw_name: String,
    pub(super) name: String,
    pub(super) key: String,
    pub(super) qualified_name: String,
    pub(super) description: String,
    pub(super) input_schema: Value,
}

pub(super) fn infer_mcp_tool_risk(
    tool: &McpToolInternal,
    transport: McpTransport,
) -> (McpToolRiskLevel, Vec<String>) {
    let haystack = format!("{} {}", tool.raw_name, tool.description).to_ascii_lowercase();
    let mut reasons = Vec::new();
    let high_keywords = [
        "write",
        "delete",
        "remove",
        "create",
        "update",
        "modify",
        "mutate",
        "execute",
        "exec",
        "shell",
        "command",
        "run",
        "kill",
        "install",
        "secret",
        "token",
        "password",
        "credential",
        "key",
    ];
    if high_keywords
        .iter()
        .any(|keyword| haystack.contains(keyword))
    {
        reasons.push("can mutate data, execute commands, or touch secrets".to_string());
        return (McpToolRiskLevel::High, reasons);
    }

    let medium_keywords = [
        "fetch", "http", "request", "search", "send", "email", "message", "upload", "download",
        "network", "web", "browser",
    ];
    if transport == McpTransport::Http {
        reasons.push("remote HTTP MCP server".to_string());
    }
    if medium_keywords
        .iter()
        .any(|keyword| haystack.contains(keyword))
    {
        reasons.push("network or external data access".to_string());
    }
    if !reasons.is_empty() {
        return (McpToolRiskLevel::Medium, reasons);
    }

    (
        McpToolRiskLevel::Low,
        vec!["read-only style tool".to_string()],
    )
}

pub(super) fn sanitize_mcp_tool(server_id: &str, tool: &Value) -> Option<McpToolInternal> {
    let raw_name = tool.get("name")?.as_str()?.to_string();
    let name = sanitize_text_token(&raw_name, MCP_NAME_LIMIT);
    if name.is_empty() {
        return None;
    }
    let key = safe_tool_key(&name);
    if key.is_empty() {
        return None;
    }
    let description = sanitize_text_token(
        tool.get("description")
            .and_then(Value::as_str)
            .unwrap_or(""),
        MCP_DESCRIPTION_LIMIT,
    );
    let input_schema = sanitize_input_schema(
        tool.get("inputSchema")
            .cloned()
            .unwrap_or_else(|| json!({})),
    );
    Some(McpToolInternal {
        raw_name,
        qualified_name: format!("mcp__{}__{}", server_id, key),
        name,
        key,
        description,
        input_schema,
    })
}

pub(super) fn sanitize_stderr_text(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\r' => '\n',
            '\n' | '\t' => ch,
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect()
}
