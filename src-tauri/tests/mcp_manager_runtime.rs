use std::fs;
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};
use terax_lib::modules::capabilities::ApprovalPolicy;
use terax_lib::modules::mcp::{McpEnvVar, McpServerConfig, McpState, McpTransport};

mod mcp_manager_support;
use mcp_manager_support::{read_http_request, stdio_config, write_http_response};

#[test]
fn http_mcp_server_uses_streamable_http_oauth_and_session_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let seen_auth = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen_sessions = Arc::new(Mutex::new(Vec::<String>::new()));
    let auth_for_thread = Arc::clone(&seen_auth);
    let sessions_for_thread = Arc::clone(&seen_sessions);

    let server = thread::spawn(move || {
        for _ in 0..4 {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, body) = read_http_request(&mut stream);
            auth_for_thread.lock().unwrap().push(
                headers
                    .lines()
                    .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
                    .unwrap_or("")
                    .to_string(),
            );
            sessions_for_thread.lock().unwrap().push(
                headers
                    .lines()
                    .find(|line| line.to_ascii_lowercase().starts_with("mcp-session-id:"))
                    .unwrap_or("")
                    .to_string(),
            );
            match body.get("method").and_then(Value::as_str).unwrap_or("") {
                "initialize" => write_http_response(
                    &mut stream,
                    "200 OK",
                    "application/json",
                    &[("Mcp-Session-Id", "session-1")],
                    &json!({
                        "jsonrpc": "2.0",
                        "id": body["id"],
                        "result": {
                            "protocolVersion": "2025-06-18",
                            "capabilities": { "tools": {} },
                            "serverInfo": { "name": "remote", "version": "1.0.0" }
                        }
                    })
                    .to_string(),
                ),
                "notifications/initialized" => {
                    write_http_response(&mut stream, "202 Accepted", "application/json", &[], "")
                }
                "tools/list" => write_http_response(
                    &mut stream,
                    "200 OK",
                    "text/event-stream",
                    &[],
                    &format!(
                        "data: {}\n\n",
                        json!({
                            "jsonrpc": "2.0",
                            "id": body["id"],
                            "result": {
                                "tools": [{
                                    "name": "search.web",
                                    "description": "Remote search",
                                    "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }
                                }]
                            }
                        })
                    ),
                ),
                "tools/call" => write_http_response(
                    &mut stream,
                    "200 OK",
                    "application/json",
                    &[],
                    &json!({
                        "jsonrpc": "2.0",
                        "id": body["id"],
                        "result": { "content": [{ "type": "text", "text": format!("remote: {}", body["params"]["arguments"]["query"].as_str().unwrap()) }], "isError": false }
                    })
                    .to_string(),
                ),
                other => panic!("unexpected MCP HTTP method: {other}"),
            }
        }
    });

    let state = McpState::default();
    state
        .connect_http(McpServerConfig {
            id: "remote".to_string(),
            name: "Remote MCP".to_string(),
            transport: McpTransport::Http,
            command: String::new(),
            args: vec![],
            cwd: None,
            url: Some(format!("http://{addr}/mcp")),
            oauth_token_env: Some("REMOTE_TOKEN".to_string()),
            env: vec![McpEnvVar {
                name: "REMOTE_TOKEN".to_string(),
                value: "oauth-secret".to_string(),
            }],
        })
        .unwrap();

    let tools = state.tools().unwrap();
    assert_eq!(tools[0].qualified_name, "mcp__remote__search_web");
    assert_eq!(tools[0].approval_policy, ApprovalPolicy::Ask);
    let result = state
        .call_tool("mcp__remote__search_web", json!({ "query": "terax" }))
        .unwrap();
    assert_eq!(result.content[0].text.as_deref(), Some("remote: terax"));
    server.join().unwrap();

    let auth_headers = seen_auth.lock().unwrap();
    assert!(auth_headers
        .iter()
        .all(|line| line.contains("Bearer oauth-secret")));
    let session_headers = seen_sessions.lock().unwrap();
    assert!(session_headers
        .iter()
        .skip(1)
        .all(|line| line.contains("session-1")));
    assert_eq!(
        state.server_statuses().unwrap()[0].transport,
        McpTransport::Http
    );
}

#[test]
fn repeated_mcp_startup_failures_are_rate_limited() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("bad-mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'bad-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'startup failed' } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    for _ in 0..3 {
        let error = state
            .connect_stdio(stdio_config("bad", "Bad MCP", &script, temp.path()))
            .unwrap_err();
        assert!(error.contains("startup failed"), "{error}");
    }
    let backoff = state
        .connect_stdio(stdio_config("bad", "Bad MCP", &script, temp.path()))
        .unwrap_err();
    assert!(backoff.contains("temporarily paused"), "{backoff}");
}

#[test]
fn binary_tool_results_are_redacted_and_content_items_are_capped() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'binary-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'blob', description: 'Binary output', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoRAWBASE64' },
      ...Array.from({ length: 40 }, (_, i) => ({ type: 'text', text: `part ${i}` }))
    ], isError: false } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
        .connect_stdio(McpServerConfig {
            id: "binary".to_string(),
            name: "Binary MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    let result = state.call_tool("mcp__binary__blob", json!({})).unwrap();
    assert_eq!(result.content.len(), 16);
    assert_eq!(result.content[0].content_type, "image");
    assert_eq!(result.content[0].mime_type.as_deref(), Some("image/png"));
    assert!(result.content[0].data.is_none());
    assert!(result.content[0]
        .text
        .as_deref()
        .unwrap_or_default()
        .contains("omitted"));
    assert!(serde_json::to_string(&result).unwrap().contains("part 14"));
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("RAWBASE64"));
}

#[test]
fn connected_stdio_servers_report_status_and_stderr_tail() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("mcp-server.js");
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
    process.stderr.write('server warning from stderr\n');
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'status-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'status', description: 'Status tool', inputSchema: { type: 'object', properties: {} } }] } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
        .connect_stdio(McpServerConfig {
            id: "status".to_string(),
            name: "Status MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(25));
    let statuses = state.server_statuses().unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].server_id, "status");
    assert_eq!(statuses[0].server_name, "Status MCP");
    assert_eq!(statuses[0].status, "connected");
    assert_eq!(statuses[0].tool_count, 1);
    assert!(statuses[0].stderr_tail.contains("server warning"));
}

#[test]
fn exited_stdio_servers_report_exit_status_and_stderr_tail() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'exit-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'later', description: 'Will exit', inputSchema: { type: 'object', properties: {} } }] } });
    process.stderr.write('server exited after startup\n');
    setTimeout(() => process.exit(7), 5);
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
        .connect_stdio(McpServerConfig {
            id: "exit".to_string(),
            name: "Exit MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(50));
    let statuses = state.server_statuses().unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].status, "exited");
    assert_eq!(statuses[0].tool_count, 0);
    assert_eq!(statuses[0].exit_code, Some(7));
    assert!(statuses[0]
        .stderr_tail
        .contains("server exited after startup"));
    assert!(statuses[0]
        .last_failure
        .as_deref()
        .unwrap_or_default()
        .contains("MCP server exited"));
    assert!(state.tools().unwrap().is_empty());

    let error = state.call_tool("mcp__exit__later", json!({})).unwrap_err();
    assert!(error.contains("MCP server exited"));
    assert!(error.contains("7"));
    assert!(state.server_statuses().unwrap()[0]
        .last_failure
        .as_deref()
        .unwrap_or_default()
        .contains("7"));
}

#[test]
fn startup_errors_include_captured_stderr() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'bad-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    process.stderr.write('fatal startup details from stderr\n');
    setTimeout(() => write({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'tool listing failed' } }), 20);
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    let error = state
        .connect_stdio(McpServerConfig {
            id: "bad".to_string(),
            name: "Bad MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap_err();

    assert!(error.contains("tool listing failed"));
    assert!(error.contains("fatal startup details from stderr"));
    assert!(state.server_statuses().unwrap().is_empty());
}
