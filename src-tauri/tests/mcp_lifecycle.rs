mod common;

use std::fs;

use serde_json::json;
use terax_lib::modules::mcp::{McpServerConfig, McpState, McpTransport};

mod mcp_manager_support;
use mcp_manager_support::stdio_config;

fn echo_server_script(temp: &std::path::Path) -> std::path::PathBuf {
    let script = temp.join("mcp-server.js");
    fs::write(
        &script,
        r#"
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function write(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
(async () => {
for await (const line of rl) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'lifecycle-mcp', version: '1.0.0' } } });
  } else if (request.method === 'notifications/initialized') {
    // no-op
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `echo: ${request.params.arguments.text}` }], isError: false } });
  }
}
})();
"#,
    )
    .unwrap();
    script
}

#[test]
fn disconnect_removes_server_and_its_tools() {
    let temp = tempfile::tempdir().unwrap();
    let script = echo_server_script(temp.path());

    let state = McpState::default();
    state
        .connect_stdio(stdio_config("lc", "Lifecycle", &script, temp.path()))
        .unwrap();

    assert_eq!(state.tools().unwrap().len(), 1);
    assert_eq!(state.server_statuses().unwrap().len(), 1);

    let removed = state.disconnect("lc").unwrap();
    assert!(removed);
    assert!(state.tools().unwrap().is_empty());
    assert!(state.server_statuses().unwrap().is_empty());
}

#[test]
fn disconnect_returns_false_for_unknown_server() {
    let state = McpState::default();
    assert!(!state.disconnect("nonexistent").unwrap());
}

#[test]
fn reconnect_replaces_previous_server() {
    let temp = tempfile::tempdir().unwrap();
    let script = echo_server_script(temp.path());

    let state = McpState::default();
    state
        .connect_stdio(stdio_config("rc", "Reconnect", &script, temp.path()))
        .unwrap();

    let first_tool = state.tools().unwrap().remove(0);
    assert_eq!(first_tool.qualified_name, "mcp__rc__echo");

    state
        .connect_stdio(stdio_config("rc", "Reconnect V2", &script, temp.path()))
        .unwrap();

    assert_eq!(state.tools().unwrap().len(), 1);
    assert_eq!(state.server_statuses().unwrap().len(), 1);
    assert_eq!(
        state.server_statuses().unwrap()[0].server_name,
        "Reconnect V2"
    );

    let result = state
        .call_tool("mcp__rc__echo", json!({ "text": "after reconnect" }))
        .unwrap();
    assert_eq!(
        result.content[0].text.as_deref(),
        Some("echo: after reconnect")
    );

    state.disconnect("rc").unwrap();
}

#[test]
fn call_tool_errors_after_disconnect() {
    let temp = tempfile::tempdir().unwrap();
    let script = echo_server_script(temp.path());

    let state = McpState::default();
    state
        .connect_stdio(stdio_config("cd", "Call After Disc", &script, temp.path()))
        .unwrap();

    let result = state
        .call_tool("mcp__cd__echo", json!({ "text": "before" }))
        .unwrap();
    assert_eq!(result.content[0].text.as_deref(), Some("echo: before"));

    state.disconnect("cd").unwrap();

    let error = state
        .call_tool("mcp__cd__echo", json!({ "text": "after" }))
        .unwrap_err();
    assert!(error.contains("not connected"), "{error}");
}

#[test]
fn multiple_servers_coexist_independently() {
    let temp = tempfile::tempdir().unwrap();
    let script_a = temp.path().join("a.js");
    let script_b = temp.path().join("b.js");

    fs::write(
        &script_a,
        r#"
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function write(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
(async () => {
for await (const line of rl) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'alpha', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'ping', description: 'alpha ping', inputSchema: { type: 'object', properties: {} } }] } });
  }
}
})();
"#,
    )
    .unwrap();

    fs::write(
        &script_b,
        r#"
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function write(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
(async () => {
for await (const line of rl) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'beta', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'ping', description: 'beta ping', inputSchema: { type: 'object', properties: {} } }] } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
        .connect_stdio(McpServerConfig {
            id: "alpha".to_string(),
            name: "Alpha".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script_a.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();
    state
        .connect_stdio(McpServerConfig {
            id: "beta".to_string(),
            name: "Beta".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script_b.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    let tools = state.tools().unwrap();
    assert_eq!(tools.len(), 2);
    assert!(tools.iter().any(|t| t.qualified_name == "mcp__alpha__ping"));
    assert!(tools.iter().any(|t| t.qualified_name == "mcp__beta__ping"));

    state.disconnect("alpha").unwrap();
    let remaining = state.tools().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].qualified_name, "mcp__beta__ping");

    state.disconnect("beta").unwrap();
    assert!(state.tools().unwrap().is_empty());
}

#[test]
fn tool_descriptor_returns_none_for_disconnected_server() {
    let temp = tempfile::tempdir().unwrap();
    let script = echo_server_script(temp.path());

    let state = McpState::default();
    state
        .connect_stdio(stdio_config("td", "Tool Desc", &script, temp.path()))
        .unwrap();

    assert!(state.tool_descriptor("mcp__td__echo").unwrap().is_some());

    state.disconnect("td").unwrap();
    assert!(state.tool_descriptor("mcp__td__echo").unwrap().is_none());
}

#[test]
fn approval_policy_for_tool_returns_none_after_disconnect() {
    let temp = tempfile::tempdir().unwrap();
    let script = echo_server_script(temp.path());

    let state = McpState::default();
    state
        .connect_stdio(stdio_config("ap", "Approval", &script, temp.path()))
        .unwrap();

    assert!(state
        .approval_policy_for_tool("mcp__ap__echo")
        .unwrap()
        .is_some());

    state.disconnect("ap").unwrap();
    assert!(state
        .approval_policy_for_tool("mcp__ap__echo")
        .unwrap()
        .is_none());
}
