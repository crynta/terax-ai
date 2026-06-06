use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::json;
use terax_lib::modules::capabilities::ApprovalPolicy;
use terax_lib::modules::mcp::{
    mcp_connect_saved_stdio_at_path, mcp_env_secret_account, mcp_oauth_complete_at_path,
    mcp_oauth_start_at_path, mcp_oauth_wait_for_callback_once,
    mcp_runtime_config_from_stored_with_env_loader, mcp_server_config_remove_at_path,
    mcp_server_config_save_at_path, mcp_server_configs_list_at_path, mcp_tool_policy_set_at_path,
    mcp_tool_preference_set_at_path, mcp_tool_preferences_list_at_path, McpEnvVar,
    McpOAuthCallbackWaitRequest, McpOAuthCompleteRequest, McpOAuthStartRequest, McpServerConfig,
    McpState, McpStoredEnvVar, McpStoredServerConfig, McpToolPreference, McpToolRiskLevel,
    McpTransport,
};

mod mcp_manager_support;
use mcp_manager_support::{read_http_request_text, write_http_response, EnvVarGuard};

#[test]
fn stdio_server_tools_are_namespaced_and_callable() {
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test-mcp', version: '1.0.0' } } });
  } else if (request.method === 'notifications/initialized') {
    // no-op
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `echo: ${request.params.arguments.text}` }], isError: false } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
        .connect_stdio(McpServerConfig {
            id: "test".to_string(),
            name: "Test MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    let tools = state.tools().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].qualified_name, "mcp__test__echo");
    assert_eq!(tools[0].server_name, "Test MCP");
    assert!(tools[0].model_visible);
    assert_eq!(tools[0].risk_level, McpToolRiskLevel::Low);
    assert!(tools[0]
        .risk_reasons
        .iter()
        .any(|reason| reason.contains("read-only")));
    assert_eq!(
        tools[0].input_schema["properties"]["text"]["type"],
        "string"
    );

    state.set_tool_preference(McpToolPreference {
        qualified_name: "mcp__test__echo".to_string(),
        model_visible: false,
        approval_policy: terax_lib::modules::capabilities::ApprovalPolicy::Deny,
    });
    assert!(!state.tools().unwrap()[0].model_visible);

    let result = state
        .call_tool("mcp__test__echo", json!({ "text": "hello" }))
        .unwrap();
    assert_eq!(result.content[0].text.as_deref(), Some("echo: hello"));
    assert!(!result.is_error);
}

#[test]
fn mcp_tools_include_rust_inferred_risk_metadata() {
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'risk-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [
      { name: 'delete_file', description: 'Delete a workspace file', inputSchema: { type: 'object', properties: {} } },
      { name: 'web_search', description: 'Search external websites', inputSchema: { type: 'object', properties: {} } }
    ] } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
        .connect_stdio(McpServerConfig {
            id: "risk".to_string(),
            name: "Risk MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    let tools = state.tools().unwrap();
    let delete_tool = tools
        .iter()
        .find(|tool| tool.name == "delete_file")
        .unwrap();
    assert_eq!(delete_tool.risk_level, McpToolRiskLevel::High);
    assert!(delete_tool
        .risk_reasons
        .iter()
        .any(|reason| reason.contains("mutate")));

    let search_tool = tools.iter().find(|tool| tool.name == "web_search").unwrap();
    assert_eq!(search_tool.risk_level, McpToolRiskLevel::Medium);
    assert!(search_tool
        .risk_reasons
        .iter()
        .any(|reason| reason.contains("external data")));
}

#[test]
fn mcp_tool_schemas_are_sanitized_for_prompt_safety() {
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'bad\nname', description: 'A'.repeat(2000), inputSchema: { type: 'object', properties: Object.fromEntries(Array.from({length: 40}, (_, i) => [`field_${i}\nINJECT`, { type: 'string', description: 'B'.repeat(1000) }])) } }] } });
  }
}
})();
"#,
    )
    .unwrap();

    let state = McpState::default();
    state
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
        .unwrap();

    let tool = state.tools().unwrap().remove(0);
    assert_eq!(tool.name, "bad name");
    assert!(tool.description.len() <= 512);
    assert!(tool.description.chars().all(|ch| ch != '\n' && ch != '\r'));
    assert!(tool.input_schema["properties"].as_object().unwrap().len() <= 12);
}

#[test]
fn stdio_connect_rejects_unsafe_commands_and_bad_cwd_with_clear_errors() {
    let temp = tempfile::tempdir().unwrap();
    let state = McpState::default();

    let relative_command_error = state
        .connect_stdio(McpServerConfig {
            id: "relative".to_string(),
            name: "Relative".to_string(),
            transport: McpTransport::Stdio,
            command: "./server".to_string(),
            args: vec![],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap_err();
    assert!(
        relative_command_error.contains("absolute executable path or allowlisted command"),
        "{relative_command_error}"
    );

    let disallowed_command_error = state
        .connect_stdio(McpServerConfig {
            id: "badcmd".to_string(),
            name: "Bad Command".to_string(),
            transport: McpTransport::Stdio,
            command: "definitely-not-allowlisted".to_string(),
            args: vec![],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap_err();
    assert!(
        disallowed_command_error.contains("allowlisted command"),
        "{disallowed_command_error}"
    );

    let missing_cwd_error = state
        .connect_stdio(McpServerConfig {
            id: "badcwd".to_string(),
            name: "Bad Cwd".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![],
            cwd: Some(temp.path().join("missing").to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap_err();
    assert!(
        missing_cwd_error.contains("MCP stdio cwd does not exist"),
        "{missing_cwd_error}"
    );

    let missing_absolute_error = state
        .connect_stdio(McpServerConfig {
            id: "missingbin".to_string(),
            name: "Missing Bin".to_string(),
            transport: McpTransport::Stdio,
            command: temp
                .path()
                .join("missing-bin")
                .to_string_lossy()
                .into_owned(),
            args: vec![],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap_err();
    assert!(
        missing_absolute_error.contains("MCP stdio command does not exist"),
        "{missing_absolute_error}"
    );
}

#[test]
fn stdio_server_configs_persist_without_env_values_or_auto_connect() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("nested").join("servers.json");

    let saved = mcp_server_config_save_at_path(
        &path,
        McpServerConfig {
            id: "local".to_string(),
            name: " Local MCP \n Server ".to_string(),
            transport: McpTransport::Stdio,
            command: "definitely-not-run-by-save".to_string(),
            args: vec!["--stdio".to_string()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![
                McpEnvVar {
                    name: "SAFE_TOKEN".to_string(),
                    value: "super-secret-value".to_string(),
                },
                McpEnvVar {
                    name: "TERAX_INTERNAL_SECRET".to_string(),
                    value: "must-not-store".to_string(),
                },
            ],
        },
    )
    .unwrap();

    assert_eq!(saved.id, "local");
    assert_eq!(saved.name, "Local MCP Server");
    assert_eq!(saved.env.len(), 1);
    assert_eq!(saved.env[0].name, "SAFE_TOKEN");

    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("definitely-not-run-by-save"));
    assert!(!content.contains("super-secret-value"));
    assert!(!content.contains("must-not-store"));
    assert!(!content.contains("TERAX_INTERNAL_SECRET"));

    let listed = mcp_server_configs_list_at_path(&path).unwrap();
    assert_eq!(listed, vec![saved]);

    let state = McpState::default();
    assert!(state.tools().unwrap().is_empty());
}

#[test]
fn http_server_configs_persist_url_and_oauth_env_without_token_values() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("servers.json");

    let saved = mcp_server_config_save_at_path(
        &path,
        McpServerConfig {
            id: "remote".to_string(),
            name: "Remote MCP".to_string(),
            transport: McpTransport::Http,
            command: String::new(),
            args: vec!["ignored".to_string()],
            cwd: Some("/ignored".to_string()),
            url: Some("https://mcp.example.com/mcp".to_string()),
            oauth_token_env: Some("REMOTE_TOKEN".to_string()),
            env: vec![McpEnvVar {
                name: "REMOTE_TOKEN".to_string(),
                value: "oauth-secret-must-not-store".to_string(),
            }],
        },
    )
    .unwrap();

    assert_eq!(saved.transport, McpTransport::Http);
    assert_eq!(saved.command, "");
    assert!(saved.args.is_empty());
    assert!(saved.cwd.is_none());
    assert_eq!(saved.url.as_deref(), Some("https://mcp.example.com/mcp"));
    assert_eq!(saved.oauth_token_env.as_deref(), Some("REMOTE_TOKEN"));
    assert_eq!(saved.env[0].name, "REMOTE_TOKEN");

    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("https://mcp.example.com/mcp"));
    assert!(!content.contains("oauth-secret-must-not-store"));
}

#[test]
fn http_oauth_flow_discovers_metadata_registers_client_and_updates_token_env() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("servers.json");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{addr}");
    let token_request_body = Arc::new(Mutex::new(String::new()));
    let token_request_body_for_thread = Arc::clone(&token_request_body);

    let server = thread::spawn(move || {
        for _ in 0..6 {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, body) = read_http_request_text(&mut stream);
            let first_line = headers.lines().next().unwrap_or_default().to_string();
            let mut parts = first_line.split_whitespace();
            let method = parts.next().unwrap_or_default();
            let path = parts
                .next()
                .unwrap_or_default()
                .split('?')
                .next()
                .unwrap_or_default();
            match (method, path) {
                ("GET", "/.well-known/oauth-protected-resource") => write_http_response(
                    &mut stream,
                    "200 OK",
                    "application/json",
                    &[],
                    &json!({ "authorization_servers": [base] }).to_string(),
                ),
                ("GET", "/.well-known/oauth-authorization-server") => write_http_response(
                    &mut stream,
                    "200 OK",
                    "application/json",
                    &[],
                    &json!({
                        "authorization_endpoint": format!("{base}/authorize"),
                        "token_endpoint": format!("{base}/token"),
                        "registration_endpoint": format!("{base}/register"),
                    })
                    .to_string(),
                ),
                ("POST", "/register") => write_http_response(
                    &mut stream,
                    "201 Created",
                    "application/json",
                    &[],
                    &json!({ "client_id": "dynamic-terax" }).to_string(),
                ),
                ("POST", "/token") => {
                    *token_request_body_for_thread.lock().unwrap() = body;
                    write_http_response(
                        &mut stream,
                        "200 OK",
                        "application/json",
                        &[],
                        &json!({
                            "access_token": "issued-access-token",
                            "expires_in": 3600,
                            "scope": "mcp",
                        })
                        .to_string(),
                    )
                }
                other => panic!("unexpected OAuth HTTP request: {other:?}"),
            }
        }
    });

    mcp_server_config_save_at_path(
        &path,
        McpServerConfig {
            id: "remote".to_string(),
            name: "Remote MCP".to_string(),
            transport: McpTransport::Http,
            command: String::new(),
            args: vec![],
            cwd: None,
            url: Some(format!("http://{addr}/mcp")),
            oauth_token_env: None,
            env: vec![],
        },
    )
    .unwrap();

    let start = tauri::async_runtime::block_on(mcp_oauth_start_at_path(
        &path,
        McpOAuthStartRequest {
            server_id: "remote".to_string(),
            client_id: None,
            redirect_uri: None,
            scopes: vec![],
        },
    ))
    .unwrap();

    assert_eq!(start.client_id, "dynamic-terax");
    assert_eq!(start.token_env, "REMOTE_MCP_OAUTH_TOKEN");
    assert!(start.authorization_url.contains("/authorize?"));
    assert!(start.authorization_url.contains("client_id=dynamic-terax"));
    assert!(start
        .authorization_url
        .contains("code_challenge_method=S256"));
    assert!(start.authorization_url.contains("scope=mcp"));
    assert!(start.code_verifier.len() >= 40);

    let token = tauri::async_runtime::block_on(mcp_oauth_complete_at_path(
        &path,
        &McpOAuthCompleteRequest {
            server_id: "remote".to_string(),
            code_or_redirect_url: format!(
                "{}?code=abc123&state={}",
                start.redirect_uri, start.state
            ),
            state: start.state,
            code_verifier: start.code_verifier,
            redirect_uri: start.redirect_uri,
            client_id: start.client_id,
            token_env: start.token_env,
        },
    ))
    .unwrap();

    assert_eq!(token.access_token, "issued-access-token");
    assert_eq!(token.expires_in, Some(3600));
    assert!(token_request_body.lock().unwrap().contains("code=abc123"));
    let saved = mcp_server_configs_list_at_path(&path).unwrap();
    assert_eq!(
        saved[0].oauth_token_env.as_deref(),
        Some("REMOTE_MCP_OAUTH_TOKEN")
    );
    assert_eq!(saved[0].env[0].name, "REMOTE_MCP_OAUTH_TOKEN");

    server.join().unwrap();
}

#[test]
fn oauth_loopback_callback_listener_returns_redirect_url() {
    let probe = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let redirect_uri = format!("http://127.0.0.1:{port}/mcp/oauth/callback");
    let wait_thread = thread::spawn({
        let redirect_uri = redirect_uri.clone();
        move || {
            mcp_oauth_wait_for_callback_once(&McpOAuthCallbackWaitRequest {
                state: "state-123".to_string(),
                redirect_uri,
                timeout_ms: Some(5_000),
            })
        }
    });

    let mut stream = loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(stream) => break stream,
            Err(error) => {
                if wait_thread.is_finished() {
                    panic!("callback listener exited before accepting: {error}");
                }
                thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    };
    let request =
        "GET /mcp/oauth/callback?code=abc&state=state-123 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.contains("200 OK"));

    let result = wait_thread.join().unwrap().unwrap();
    assert_eq!(
        result.code_or_redirect_url,
        format!("{redirect_uri}?code=abc&state=state-123")
    );
}

#[test]
fn keyring_env_loader_prefers_secret_values_without_persisting_values() {
    let record = McpStoredServerConfig {
        id: "env".to_string(),
        name: "Env MCP".to_string(),
        transport: McpTransport::Stdio,
        command: "node".to_string(),
        args: vec!["server.js".to_string()],
        cwd: None,
        url: None,
        oauth_token_env: None,
        env: vec![
            McpStoredEnvVar {
                name: "SAFE_TOKEN".to_string(),
            },
            McpStoredEnvVar {
                name: "OTHER_TOKEN".to_string(),
            },
        ],
    };

    let runtime = mcp_runtime_config_from_stored_with_env_loader(record, |server_id, env_name| {
        assert_eq!(server_id, "env");
        (env_name == "SAFE_TOKEN").then(|| "keyring-token".to_string())
    });

    assert_eq!(runtime.env.len(), 1);
    assert_eq!(runtime.env[0].name, "SAFE_TOKEN");
    assert_eq!(runtime.env[0].value, "keyring-token");
    assert_eq!(
        mcp_env_secret_account("env", "SAFE_TOKEN").unwrap(),
        "env/SAFE_TOKEN"
    );
    assert!(mcp_env_secret_account("bad/slash", "SAFE_TOKEN").is_err());
    assert!(mcp_env_secret_account("env", "TERAX_PRIVATE").is_err());
}

#[test]
fn stdio_server_configs_update_and_remove_by_sanitized_id() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("servers.json");

    let first = mcp_server_config_save_at_path(
        &path,
        McpServerConfig {
            id: "alpha".to_string(),
            name: "Alpha".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec!["first.js".to_string()],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![],
        },
    )
    .unwrap();
    assert_eq!(first.name, "Alpha");

    let updated = mcp_server_config_save_at_path(
        &path,
        McpServerConfig {
            id: "alpha".to_string(),
            name: "Updated".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec!["second.js".to_string()],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![],
        },
    )
    .unwrap();

    let listed = mcp_server_configs_list_at_path(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0], updated);
    assert_eq!(listed[0].args, vec!["second.js"]);

    assert!(mcp_server_config_remove_at_path(&path, "alpha").unwrap());
    assert!(!mcp_server_config_remove_at_path(&path, "alpha").unwrap());
    assert!(mcp_server_configs_list_at_path(&path).unwrap().is_empty());
}

#[test]
fn saved_stdio_server_configs_connect_with_runtime_env_values() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("servers.json");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'env-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'token', description: process.env.SAFE_TOKEN || 'missing', inputSchema: { type: 'object', properties: {} } }] } });
  }
}
})();
"#,
    )
    .unwrap();

    mcp_server_config_save_at_path(
        &path,
        McpServerConfig {
            id: "env".to_string(),
            name: "Env MCP".to_string(),
            transport: McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![McpEnvVar {
                name: "SAFE_TOKEN".to_string(),
                value: "stored-secret-must-not-be-used".to_string(),
            }],
        },
    )
    .unwrap();

    let _env_guard = EnvVarGuard::set("SAFE_TOKEN", "runtime-token");
    let state = McpState::default();
    mcp_connect_saved_stdio_at_path(&state, &path, "env").unwrap();
    let tool = state.tools().unwrap().remove(0);
    assert_eq!(tool.description, "runtime-token");
}

#[test]
fn mcp_tool_preferences_persist_visibility_and_approval_policy_by_qualified_tool_name() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("tool-preferences.json");

    let saved =
        mcp_tool_policy_set_at_path(&path, "mcp__test__echo", ApprovalPolicy::Auto).unwrap();
    assert_eq!(saved.qualified_name, "mcp__test__echo");
    assert!(saved.model_visible);
    assert_eq!(saved.approval_policy, ApprovalPolicy::Auto);

    assert_eq!(
        mcp_tool_preferences_list_at_path(&path).unwrap(),
        vec![saved]
    );

    let updated =
        mcp_tool_policy_set_at_path(&path, "mcp__test__echo", ApprovalPolicy::Deny).unwrap();
    assert!(!updated.model_visible);
    assert_eq!(updated.approval_policy, ApprovalPolicy::Deny);
    assert_eq!(
        mcp_tool_preferences_list_at_path(&path).unwrap(),
        vec![updated]
    );

    let ask = mcp_tool_preference_set_at_path(&path, "mcp__test__echo", true).unwrap();
    assert_eq!(ask.approval_policy, ApprovalPolicy::Ask);
    assert!(mcp_tool_policy_set_at_path(&path, "read", ApprovalPolicy::Ask).is_err());
}
