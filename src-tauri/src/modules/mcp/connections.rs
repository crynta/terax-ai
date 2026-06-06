use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};

use crate::modules::capabilities::ApprovalPolicy;

use super::sanitize::{
    apply_stdio_environment, normalize_tool_result, safe_tool_key, sanitize_input_schema,
    sanitize_text_token, truncate_text, validate_http_url, validate_stdio_command,
    validate_stdio_cwd,
};
use super::{
    McpServerConfig, McpServerStatus, McpToolCallResult, McpToolDescriptor, McpToolRiskLevel,
    McpTransport, MCP_DESCRIPTION_LIMIT, MCP_FAILURE_LIMIT, MCP_HTTP_BODY_LIMIT, MCP_NAME_LIMIT,
    MCP_PROTOCOL_VERSION, MCP_REQUEST_TIMEOUT, MCP_STDERR_TAIL_LIMIT,
};

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
            Self::Http(connection) => connection.initialize(),
        }
    }

    pub(super) fn refresh_tools(&self) -> Result<(), String> {
        match self {
            Self::Stdio(connection) => connection.refresh_tools(),
            Self::Http(connection) => connection.refresh_tools(),
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
            Self::Http(connection) => connection.call_tool_by_key(tool_key, arguments),
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

pub(super) struct McpStdioConnection {
    server_id: String,
    server_name: String,
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    stderr_tail: Arc<Mutex<String>>,
    last_failure: Mutex<Option<String>>,
    pending: PendingMap,
    next_id: AtomicU64,
    tools: Mutex<Vec<McpToolInternal>>,
}

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

fn remove_pending_response(pending: &PendingMap, id: u64) {
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
struct McpToolInternal {
    raw_name: String,
    name: String,
    key: String,
    qualified_name: String,
    description: String,
    input_schema: Value,
}

fn infer_mcp_tool_risk(
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

impl McpStdioConnection {
    pub(super) fn spawn(
        server_id: String,
        server_name: String,
        config: McpServerConfig,
    ) -> Result<Self, String> {
        let command_path = validate_stdio_command(&config.command)?;
        let cwd = validate_stdio_cwd(config.cwd.as_deref())?;
        let mut command = Command::new(&command_path);
        command.args(config.args.iter().map(String::as_str));
        if let Some(cwd) = cwd.as_deref() {
            command.current_dir(cwd);
        }
        apply_stdio_environment(&mut command, &config.env);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start MCP server {}: {error}", config.id))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MCP server stdin was not piped".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MCP server stdout was not piped".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "MCP server stderr was not piped".to_string())?;
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let stderr_tail = Arc::new(Mutex::new(String::new()));
        spawn_stdout_reader(BufReader::new(stdout), Arc::clone(&pending));
        spawn_stderr_reader(stderr, Arc::clone(&stderr_tail));
        Ok(Self {
            server_id,
            server_name,
            child: Mutex::new(child),
            stdin: Arc::new(Mutex::new(stdin)),
            stderr_tail,
            last_failure: Mutex::new(None),
            pending,
            next_id: AtomicU64::new(1),
            tools: Mutex::new(Vec::new()),
        })
    }

    fn initialize(&self) -> Result<(), String> {
        let _ = self.request(
            "initialize",
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "terax", "version": env!("CARGO_PKG_VERSION") },
            }),
        )?;
        self.notify("notifications/initialized", json!({}))
    }

    fn refresh_tools(&self) -> Result<(), String> {
        let result = self.request("tools/list", json!({}))?;
        let list = result
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| "MCP tools/list response did not contain a tools array".to_string())?;
        let tools = list
            .iter()
            .filter_map(|tool| self.sanitize_tool(tool))
            .collect::<Vec<_>>();
        *self
            .tools
            .lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))? = tools;
        Ok(())
    }

    fn public_tools(&self) -> Result<Vec<McpToolDescriptor>, String> {
        if self.ensure_running().is_err() {
            return Ok(Vec::new());
        }
        let tools = self
            .tools
            .lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))?;
        Ok(tools
            .iter()
            .map(|tool| {
                let (risk_level, risk_reasons) = infer_mcp_tool_risk(tool, McpTransport::Stdio);
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

    fn call_tool_by_key(
        &self,
        tool_key: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        self.ensure_running()?;
        let raw_name = {
            let tools = self
                .tools
                .lock()
                .map_err(|error| format!("MCP tools lock failed: {error}"))?;
            tools
                .iter()
                .find(|tool| tool.key == tool_key)
                .map(|tool| tool.raw_name.clone())
                .ok_or_else(|| format!("MCP tool not found: mcp__{}__{tool_key}", self.server_id))?
        };
        let result = self.request(
            "tools/call",
            json!({
                "name": raw_name,
                "arguments": if arguments.is_object() { arguments } else { json!({}) },
            }),
        )?;
        Ok(normalize_tool_result(result))
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.ensure_running()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|error| format!("MCP pending lock failed: {error}"))?
            .insert(id, tx);
        let envelope = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(error) = self.write_envelope(&envelope) {
            remove_pending_response(&self.pending, id);
            return Err(self.record_failure(self.with_stderr_context(error)));
        }
        match rx.recv_timeout(MCP_REQUEST_TIMEOUT) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(self.record_failure(self.with_stderr_context(error))),
            Err(_) => {
                remove_pending_response(&self.pending, id);
                Err(self.record_failure(
                    self.with_stderr_context(format!("MCP request timed out: {method}")),
                ))
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_envelope(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .map_err(|error| self.record_failure(self.with_stderr_context(error)))
    }

    fn write_envelope(&self, envelope: &Value) -> Result<(), String> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|error| format!("MCP stdin lock failed: {error}"))?;
        let line = serde_json::to_vec(envelope).map_err(|error| error.to_string())?;
        stdin
            .write_all(&line)
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("failed to write MCP request: {error}"))
    }

    fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|tail| tail.clone())
            .unwrap_or_default()
    }

    fn with_stderr_context(&self, error: String) -> String {
        let stderr_tail = self.stderr_tail();
        if stderr_tail.trim().is_empty() {
            error
        } else {
            format!("{error}; MCP server stderr: {}", stderr_tail.trim())
        }
    }

    fn record_failure(&self, error: String) -> String {
        let sanitized = truncate_text(&sanitize_stderr_text(&error), MCP_FAILURE_LIMIT);
        if let Ok(mut last_failure) = self.last_failure.lock() {
            *last_failure = Some(sanitized.clone());
        }
        sanitized
    }

    fn clear_tools(&self) {
        if let Ok(mut tools) = self.tools.lock() {
            tools.clear();
        }
    }

    fn ensure_running(&self) -> Result<(), String> {
        let mut child = self
            .child
            .lock()
            .map_err(|error| format!("MCP child lock failed: {error}"))?;
        match child.try_wait() {
            Ok(Some(status)) => {
                self.clear_tools();
                Err(self.record_failure(
                    self.with_stderr_context(format!("MCP server exited with {status}")),
                ))
            }
            Ok(None) => Ok(()),
            Err(error) => Err(self.record_failure(
                self.with_stderr_context(format!("failed to inspect MCP server process: {error}")),
            )),
        }
    }

    fn status(&self) -> Result<McpServerStatus, String> {
        let (status, exit_code) = {
            let mut child = self
                .child
                .lock()
                .map_err(|error| format!("MCP child lock failed: {error}"))?;
            match child.try_wait() {
                Ok(Some(exit_status)) => {
                    self.clear_tools();
                    let failure =
                        self.with_stderr_context(format!("MCP server exited with {exit_status}"));
                    self.record_failure(failure);
                    ("exited".to_string(), exit_status.code())
                }
                Ok(None) => ("connected".to_string(), None),
                Err(error) => {
                    let failure = self.with_stderr_context(format!(
                        "failed to inspect MCP server process: {error}"
                    ));
                    self.record_failure(failure);
                    (format!("error: {error}"), None)
                }
            }
        };
        let tool_count = self
            .tools
            .lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))?
            .len();
        let last_failure = self
            .last_failure
            .lock()
            .ok()
            .and_then(|value| value.clone());
        Ok(McpServerStatus {
            server_id: self.server_id.clone(),
            server_name: self.server_name.clone(),
            transport: McpTransport::Stdio,
            status,
            tool_count,
            exit_code,
            stderr_tail: self.stderr_tail(),
            last_failure,
            restart_backoff_ms: None,
        })
    }

    fn sanitize_tool(&self, tool: &Value) -> Option<McpToolInternal> {
        sanitize_mcp_tool(&self.server_id, tool)
    }

    fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub(super) struct McpHttpConnection {
    server_id: String,
    server_name: String,
    url: String,
    oauth_token: Option<String>,
    client: reqwest::blocking::Client,
    session_id: Mutex<Option<String>>,
    last_failure: Mutex<Option<String>>,
    next_id: AtomicU64,
    tools: Mutex<Vec<McpToolInternal>>,
}

impl McpHttpConnection {
    fn new(
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
        let client = reqwest::blocking::Client::builder()
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
            next_id: AtomicU64::new(1),
            tools: Mutex::new(Vec::new()),
        })
    }

    fn initialize(&self) -> Result<(), String> {
        let _ = self.request(
            "initialize",
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "terax", "version": env!("CARGO_PKG_VERSION") },
            }),
        )?;
        self.notify("notifications/initialized", json!({}))
    }

    fn refresh_tools(&self) -> Result<(), String> {
        let result = self.request("tools/list", json!({}))?;
        let list = result
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| "MCP tools/list response did not contain a tools array".to_string())?;
        let tools = list
            .iter()
            .filter_map(|tool| self.sanitize_tool(tool))
            .collect::<Vec<_>>();
        *self
            .tools
            .lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))? = tools;
        Ok(())
    }

    fn public_tools(&self) -> Result<Vec<McpToolDescriptor>, String> {
        let tools = self
            .tools
            .lock()
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

    fn call_tool_by_key(
        &self,
        tool_key: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        let raw_name = {
            let tools = self
                .tools
                .lock()
                .map_err(|error| format!("MCP tools lock failed: {error}"))?;
            tools
                .iter()
                .find(|tool| tool.key == tool_key)
                .map(|tool| tool.raw_name.clone())
                .ok_or_else(|| format!("MCP tool not found: mcp__{}__{tool_key}", self.server_id))?
        };
        let result = self.request(
            "tools/call",
            json!({
                "name": raw_name,
                "arguments": if arguments.is_object() { arguments } else { json!({}) },
            }),
        )?;
        Ok(normalize_tool_result(result))
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let envelope = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let value = self.post_envelope(&envelope)?;
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

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let envelope = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.post_envelope(&envelope).map(|_| ())
    }

    fn post_envelope(&self, envelope: &Value) -> Result<Value, String> {
        let body = serde_json::to_vec(envelope).map_err(|error| error.to_string())?;
        let mut request = self
            .client
            .post(&self.url)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .header("Mcp-Protocol-Version", MCP_PROTOCOL_VERSION)
            .body(body);
        if let Some(session_id) = self
            .session_id
            .lock()
            .map_err(|error| format!("MCP HTTP session lock failed: {error}"))?
            .clone()
        {
            request = request.header("Mcp-Session-Id", session_id);
        }
        if let Some(token) = self.oauth_token.as_deref() {
            request = request.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = request
            .send()
            .map_err(|error| self.record_failure(format!("MCP HTTP request failed: {error}")))?;
        if let Some(session_id) = response
            .headers()
            .get("Mcp-Session-Id")
            .and_then(|value| value.to_str().ok())
            .map(|value| sanitize_text_token(value, MCP_NAME_LIMIT))
            .filter(|value| !value.is_empty())
        {
            if let Ok(mut stored) = self.session_id.lock() {
                *stored = Some(session_id);
            }
        }
        if response.status().as_u16() == 202 {
            return Ok(json!({}));
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
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
        if let Ok(mut last_failure) = self.last_failure.lock() {
            *last_failure = Some(sanitized.clone());
        }
        sanitized
    }

    fn status(&self) -> Result<McpServerStatus, String> {
        let tool_count = self
            .tools
            .lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))?
            .len();
        let last_failure = self
            .last_failure
            .lock()
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

    fn sanitize_tool(&self, tool: &Value) -> Option<McpToolInternal> {
        sanitize_mcp_tool(&self.server_id, tool)
    }

    fn shutdown(&self) {}
}

fn sanitize_mcp_tool(server_id: &str, tool: &Value) -> Option<McpToolInternal> {
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

fn spawn_stdout_reader(stdout: BufReader<std::process::ChildStdout>, pending: PendingMap) {
    thread::spawn(move || {
        for line in stdout.lines() {
            let Ok(line) = line else { break };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = value.get("id").and_then(Value::as_u64) else {
                continue;
            };
            let result = if let Some(error) = value.get("error") {
                Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP request failed")
                    .to_string())
            } else {
                Ok(value.get("result").cloned().unwrap_or_else(|| json!({})))
            };
            if let Ok(mut pending) = pending.lock() {
                if let Some(tx) = pending.remove(&id) {
                    let _ = tx.send(result);
                }
            }
        }
        if let Ok(mut pending) = pending.lock() {
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err("MCP server exited".to_string()));
            }
        }
    });
}

fn spawn_stderr_reader(mut stderr: std::process::ChildStderr, tail: Arc<Mutex<String>>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 1024];
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => append_stderr_tail(&tail, &String::from_utf8_lossy(&buffer[..size])),
                Err(_) => break,
            }
        }
    });
}

fn append_stderr_tail(tail: &Arc<Mutex<String>>, chunk: &str) {
    let sanitized = sanitize_stderr_text(chunk);
    if sanitized.is_empty() {
        return;
    }
    let Ok(mut tail) = tail.lock() else {
        return;
    };
    tail.push_str(&sanitized);
    if tail.len() <= MCP_STDERR_TAIL_LIMIT {
        return;
    }
    let excess = tail.len() - MCP_STDERR_TAIL_LIMIT;
    let drain_to = tail
        .char_indices()
        .find(|(index, _)| *index >= excess)
        .map(|(index, _)| index)
        .unwrap_or(tail.len());
    tail.drain(..drain_to);
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
