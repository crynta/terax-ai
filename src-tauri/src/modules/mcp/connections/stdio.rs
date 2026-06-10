use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

use super::super::sanitize::{
    apply_stdio_environment, validate_stdio_args, validate_stdio_command, validate_stdio_cwd,
};
use super::{
    infer_mcp_tool_risk, remove_pending_response, sanitize_mcp_tool, sanitize_stderr_text,
    McpToolInternal, PendingMap,
};
use crate::modules::capabilities::ApprovalPolicy;

use super::super::{
    McpServerConfig, McpServerStatus, McpToolCallResult, McpToolDescriptor, McpTransport,
    MCP_FAILURE_LIMIT, MCP_PROTOCOL_VERSION, MCP_REQUEST_TIMEOUT, MCP_STDERR_TAIL_LIMIT,
};

pub(in crate::modules::mcp) struct McpStdioConnection {
    server_id: String,
    server_name: String,
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    stderr_tail: Arc<Mutex<String>>,
    last_failure: Mutex<Option<String>>,
    pending: PendingMap,
    next_id: std::sync::atomic::AtomicU64,
    tools: Mutex<Vec<McpToolInternal>>,
}

impl McpStdioConnection {
    pub(super) fn spawn(
        server_id: String,
        server_name: String,
        config: McpServerConfig,
    ) -> Result<Self, String> {
        let command_path = validate_stdio_command(&config.command)?;
        validate_stdio_args(&config.args)?;
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
        let pending: PendingMap = Arc::new(Mutex::new(std::collections::HashMap::new()));
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
            next_id: std::sync::atomic::AtomicU64::new(1),
            tools: Mutex::new(Vec::new()),
        })
    }

    pub(super) fn initialize(&self) -> Result<(), String> {
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

    pub(super) fn refresh_tools(&self) -> Result<(), String> {
        let result = self.request("tools/list", json!({}))?;
        let list = result
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| "MCP tools/list response did not contain a tools array".to_string())?;
        let tools = list
            .iter()
            .filter_map(|tool| sanitize_mcp_tool(&self.server_id, tool))
            .collect::<Vec<_>>();
        *self
            .tools
            .lock()
            .map_err(|error| format!("MCP tools lock failed: {error}"))? = tools;
        Ok(())
    }

    pub(super) fn public_tools(&self) -> Result<Vec<McpToolDescriptor>, String> {
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

    pub(super) fn call_tool_by_key(
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
        Ok(super::super::sanitize::normalize_tool_result(result))
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.ensure_running()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = std::sync::mpsc::channel();
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
        let sanitized =
            super::super::sanitize::truncate_text(&sanitize_stderr_text(&error), MCP_FAILURE_LIMIT);
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

    pub(super) fn status(&self) -> Result<McpServerStatus, String> {
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

    pub(super) fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
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
