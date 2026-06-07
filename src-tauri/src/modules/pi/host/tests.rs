use std::fs;

use tempfile::tempdir;

use super::*;

#[test]
fn debug_host_candidate_prefers_repo_source_before_bundled_resource() {
    let resource_dir = PathBuf::from("resources-root");
    let candidates = host_path_candidates(Some(&resource_dir));
    let repo_host = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecars/pi-host/host.js");
    let bundled_host = resource_dir.join("sidecars/pi-host/host.js");

    let repo_position = candidates
        .iter()
        .position(|candidate| candidate == &repo_host)
        .expect("repo source host candidate is present");
    let bundled_position = candidates
        .iter()
        .position(|candidate| candidate == &bundled_host)
        .expect("bundled resource host candidate is present");

    assert!(repo_position < bundled_position);
}

#[test]
fn bundled_node_candidate_uses_resource_dir() {
    let resource_dir = PathBuf::from("resources-root");
    let candidates = node_binary_candidates(Some(&resource_dir));

    assert_eq!(
        candidates.first(),
        Some(&resource_dir.join(bundled_node_relative_path()))
    );
    assert!(candidates.contains(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(generated_node_relative_path())
    ));
}

#[cfg(unix)]
#[test]
fn select_usable_node_binary_skips_broken_candidates() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempdir().unwrap();
    let broken = temp.path().join("broken-node");
    let working = temp.path().join("working-node");
    fs::write(&broken, "#!/bin/sh\nexit 1\n").unwrap();
    fs::write(&working, "#!/bin/sh\necho v0.0.0\n").unwrap();
    fs::set_permissions(&broken, fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(&working, fs::Permissions::from_mode(0o755)).unwrap();

    assert_eq!(
        select_usable_node_binary(vec![broken, working.clone()]),
        Some(working)
    );
}

#[test]
fn dev_candidates_include_repo_root_from_manifest_dir() {
    let candidates = host_path_candidates(None);
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    assert!(candidates.contains(&manifest_dir.join("..").join("sidecars/pi-host/host.js")));
}

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn host_environment_uses_allowlist_without_provider_secrets_or_test_faux_by_default() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("ANTHROPIC_API_KEY", "blocked-provider-secret");
    std::env::set_var("TERAX_PI_NODE_MODULES", "/tmp/pi-node-modules");
    std::env::set_var(
        "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
        r#"{"name":"read","arguments":{"path":"package.json"}}"#,
    );
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_REASONING", "true");
    std::env::remove_var("TERAX_PI_HOST_ENABLE_TEST_FAUX");
    std::env::set_var("TERAX_SHOULD_NOT_LEAK", "blocked-secret");
    let environment = host_environment();

    assert!(environment
        .iter()
        .any(|(name, value)| name == "TERAX_PI_NODE_MODULES" && value == "/tmp/pi-node-modules"));
    assert!(!environment
        .iter()
        .any(|(name, _)| name == "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL"));
    assert!(!environment
        .iter()
        .any(|(name, _)| name == "TERAX_PI_HOST_TEST_FAUX_REASONING"));
    assert!(!environment
        .iter()
        .any(|(name, _)| name == "ANTHROPIC_API_KEY"));
    assert!(!environment
        .iter()
        .any(|(name, _)| name == "TERAX_SHOULD_NOT_LEAK"));

    std::env::remove_var("ANTHROPIC_API_KEY");
    std::env::remove_var("TERAX_PI_NODE_MODULES");
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_TOOL_CALL");
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_REASONING");
    std::env::remove_var("TERAX_SHOULD_NOT_LEAK");
}

#[test]
fn host_environment_forwards_test_faux_only_with_explicit_debug_opt_in() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("TERAX_PI_HOST_ENABLE_TEST_FAUX", "1");
    std::env::set_var(
        "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
        r#"{"name":"read","arguments":{"path":"package.json"}}"#,
    );
    std::env::set_var("TERAX_PI_HOST_TEST_FAUX_REASONING", "true");
    let environment = host_environment();

    assert!(environment
        .iter()
        .any(|(name, value)| name == "TERAX_PI_HOST_ENABLE_TEST_FAUX" && value == "1"));
    assert!(environment
        .iter()
        .any(|(name, value)| name == "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL"
            && value.contains("package.json")));
    assert!(environment
        .iter()
        .any(|(name, value)| name == "TERAX_PI_HOST_TEST_FAUX_REASONING" && value == "true"));

    std::env::remove_var("TERAX_PI_HOST_ENABLE_TEST_FAUX");
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_TOOL_CALL");
    std::env::remove_var("TERAX_PI_HOST_TEST_FAUX_REASONING");
}

#[test]
fn session_event_notification_parses_event_envelope() {
    let event = session_event_notification(
            r#"{"jsonrpc":"2.0","method":"session.event","params":{"id":"evt-1","type":"session.output.delta","sessionId":"pi-1","createdAt":"2026-01-01T00:00:00.000Z","payload":{"text":"hi"}}}"#,
        )
        .unwrap();

    assert_eq!(event.id, "evt-1");
    assert_eq!(event.event_type, "session.output.delta");
    assert_eq!(event.session_id, "pi-1");
    assert_eq!(event.payload["text"], "hi");
}

#[test]
fn session_event_notification_ignores_responses() {
    assert!(
        session_event_notification(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#).is_none()
    );
}

#[test]
fn pending_responses_deliver_out_of_order_lines_by_id() {
    let pending = PendingResponses::default();
    let first = pending.register(1);
    let second = pending.register(2);

    assert!(pending.complete_response(2, "two\n".to_string()));
    assert!(pending.complete_response(1, "one\n".to_string()));
    assert!(!pending.complete_response(3, "orphan\n".to_string()));

    assert_eq!(
        first
            .recv_timeout(Duration::from_millis(50))
            .unwrap()
            .unwrap(),
        "one\n"
    );
    assert_eq!(
        second
            .recv_timeout(Duration::from_millis(50))
            .unwrap()
            .unwrap(),
        "two\n"
    );
}

#[test]
fn host_rejects_protocol_mismatch_on_ping() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("host.js");
    fs::write(
        &script,
        r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: 1 } })}\n`);
  }
}
"#,
    )
    .unwrap();

    let error =
        match PiHost::spawn_inner(PathBuf::from("node"), script, Duration::from_secs(5), None) {
            Ok(_) => panic!("host should reject a protocol mismatch"),
            Err(error) => error,
        };

    assert!(error.contains("Unsupported Pi host protocol version: 1"));
}

#[test]
fn host_matches_concurrent_out_of_order_responses_by_id() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("host.js");
    fs::write(
        &script,
        r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = [];

function write(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function resultFor(request) {
  if (request.method === 'status') {
    return { phase: 'ready', detail: 'first response' };
  }
  if (request.method === 'info') {
    return { hostVersion: 'fake', piSdkLoaded: true, piPackages: [] };
  }
  throw new Error(`unexpected method ${request.method}`);
}

for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: request.params.protocolVersion } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  pending.push(request);
  if (pending.length === 2) {
    const [first, second] = pending.splice(0, 2);
    write({ jsonrpc: '2.0', id: second.id, result: resultFor(second) });
    write({ jsonrpc: '2.0', id: first.id, result: resultFor(first) });
  }
}
"#,
    )
    .unwrap();

    let host = Arc::new(
        PiHost::spawn_inner(PathBuf::from("node"), script, Duration::from_secs(5), None).unwrap(),
    );
    let status_host = Arc::clone(&host);
    let info_host = Arc::clone(&host);

    let status = thread::spawn(move || status_host.status());
    let info = thread::spawn(move || info_host.info());

    let status = status.join().unwrap().unwrap();
    let info = info.join().unwrap().unwrap();

    assert_eq!(status.phase, PiPhase::Ready);
    assert_eq!(status.detail.as_deref(), Some("first response"));
    assert_eq!(info.host_version, "fake");

    host.shutdown();
}

#[test]
fn host_handles_reverse_native_tool_requests() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("note.txt"), "native bridge ok").unwrap();
    let cwd_json = serde_json::to_string(&workspace.to_string_lossy()).unwrap();
    let script = temp.path().join("host.js");
    let source = r#"
import { createInterface } from 'node:readline';
const cwd = __CWD__;
const sessionId = 'pi-native-test';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let statusRequest = null;
function write(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: request.params.protocolVersion } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  if (request.method === 'sessions.create') {
    if (!request.params.capabilityManifest || !request.params.capabilityManifest.tools.some((tool) => tool.name === 'bash' && tool.approval === 'ask')) {
      write({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'missing capability manifest' } });
      continue;
    }
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        session: {
          id: sessionId,
          title: 'Native test',
          cwd,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastPrompt: null
        },
        events: []
      }
    });
    continue;
  }
  if (request.method === 'status') {
    statusRequest = request;
    write({
      jsonrpc: '2.0',
      id: 100,
      method: 'nativeTools.execute',
      params: {
        sessionId,
        toolCallId: 'call-read',
        toolName: 'read',
        cwd,
        input: { path: 'note.txt' }
      }
    });
    continue;
  }
  if (request.method === 'diagnostics') {
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        hostVersion: '0.1.0',
        piSdkLoaded: true,
        piPackages: [],
        node: { version: 'test', execPath: 'node', platform: 'test', arch: 'test', pid: 1, cwd },
        config: { toolMode: 'rust-mediated', enabledTools: ['read'], approvalRequiredTools: [], sessionStorage: 'test', apiKeys: [] },
        sessions: []
      }
    });
    continue;
  }
  if (request.id === 100 && request.result) {
    write({
      jsonrpc: '2.0',
      id: statusRequest.id,
      result: {
        phase: 'ready',
        detail: request.result.content[0].text
      }
    });
  }
}
"#
        .replace("__CWD__", &cwd_json);
    fs::write(&script, source).unwrap();

    let host =
        PiHost::spawn_inner(PathBuf::from("node"), script, Duration::from_secs(5), None).unwrap();
    let created = host
        .session_create(
            Some("Native test".to_string()),
            Some(workspace.to_string_lossy().into_owned()),
            None,
            None,
            WorkspaceEnv::Local,
        )
        .unwrap();

    let status = host.status().unwrap();
    let diagnostics = host.diagnostics().unwrap();

    assert_eq!(created.session.id, "pi-native-test");

    assert_eq!(status.phase, PiPhase::Ready);
    assert_eq!(status.detail.as_deref(), Some("native bridge ok"));
    assert_eq!(diagnostics.capability_audit.len(), 1);
    assert_eq!(diagnostics.capability_audit[0].tool_name, "read");
    assert_eq!(diagnostics.capability_audit[0].session_id, "pi-native-test");
    host.shutdown();
}

#[test]
fn session_create_forwards_mcp_capabilities_from_native_context() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let mcp_script = temp.path().join("mcp-server.js");
    fs::write(
            &mcp_script,
            r#"
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function write(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
(async () => {
for await (const line of rl) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'say', description: 'Say text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  }
}
})();
"#,
        )
        .unwrap();
    let mcp_state = Arc::new(crate::modules::mcp::McpState::default());
    mcp_state
        .connect_stdio(crate::modules::mcp::McpServerConfig {
            id: "echo".to_string(),
            name: "Echo".to_string(),
            transport: crate::modules::mcp::McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![mcp_script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();

    let host_script = temp.path().join("host.js");
    let cwd_json = serde_json::to_string(&workspace.to_string_lossy()).unwrap();
    let source = r#"
import { createInterface } from 'node:readline';
const cwd = __CWD__;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
function write(envelope) { process.stdout.write(`${JSON.stringify(envelope)}\n`); }
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: request.params.protocolVersion } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  if (request.method === 'sessions.create') {
    const tools = request.params.capabilityManifest?.tools ?? [];
    const hasMcp = tools.some((tool) => tool.name === 'mcp__echo__say' && tool.approval === 'ask' && tool.modelVisible === true);
    if (!hasMcp) {
      write({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'missing MCP capability' } });
      continue;
    }
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        session: {
          id: 'pi-mcp-manifest',
          title: 'MCP manifest',
          cwd,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastPrompt: null
        },
        events: []
      }
    });
    continue;
  }
  if (request.method === 'sessions.configure') {
    const tools = request.params.capabilityManifest?.tools ?? [];
    const hasMcp = tools.some((tool) => tool.name === 'mcp__echo__say' && tool.approval === 'ask' && tool.modelVisible === true);
    if (!hasMcp) {
      write({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'missing configured MCP capability' } });
      continue;
    }
    write({ jsonrpc: '2.0', id: request.id, result: { session: { id: request.params.sessionId } } });
    continue;
  }
  if (request.method === 'sessions.send') {
    if (request.params.capabilityManifest !== undefined) {
      write({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'send must not carry capability manifest' } });
      continue;
    }
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        accepted: true,
        session: {
          id: 'pi-mcp-manifest',
          title: 'MCP manifest',
          cwd,
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
          lastPrompt: request.params.prompt
        },
        events: []
      }
    });
  }
}
"#
        .replace("__CWD__", &cwd_json);
    fs::write(&host_script, source).unwrap();

    let host = PiHost::spawn_inner_with_timeouts_and_native_tool_context(
        PathBuf::from("node"),
        host_script,
        RequestTimeouts::uniform(Duration::from_secs(5)),
        None,
        native_tools::NativeToolContext::with_mcp_state(mcp_state),
    )
    .unwrap();
    let created = host
        .session_create(
            Some("MCP manifest".to_string()),
            Some(workspace.to_string_lossy().into_owned()),
            None,
            None,
            WorkspaceEnv::Local,
        )
        .unwrap();

    assert_eq!(created.session.id, "pi-mcp-manifest");
    let sent = host
        .session_send(
            "pi-mcp-manifest".to_string(),
            "call mcp".to_string(),
            None,
            None,
            None,
        )
        .unwrap();
    assert!(sent.accepted);
    assert_eq!(sent.session.last_prompt.as_deref(), Some("call mcp"));
    host.shutdown();
}

#[test]
fn session_send_skips_unchanged_capability_configure() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let host_script = temp.path().join("host.js");
    let cwd_json = serde_json::to_string(&workspace.to_string_lossy()).unwrap();
    let source = r#"
import { createInterface } from 'node:readline';
const cwd = __CWD__;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
function write(envelope) { process.stdout.write(`${JSON.stringify(envelope)}\n`); }
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: request.params.protocolVersion } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  if (request.method === 'sessions.create') {
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        session: {
          id: 'pi-cache',
          title: 'Cache',
          cwd,
          status: 'idle',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastPrompt: null
        },
        events: []
      }
    });
    continue;
  }
  if (request.method === 'sessions.configure') {
    write({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'unexpected configure' } });
    continue;
  }
  if (request.method === 'sessions.send') {
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        accepted: true,
        session: {
          id: 'pi-cache',
          title: 'Cache',
          cwd,
          status: 'running',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
          lastPrompt: request.params.prompt
        },
        events: []
      }
    });
  }
}
"#
    .replace("__CWD__", &cwd_json);
    fs::write(&host_script, source).unwrap();

    let host = PiHost::spawn_inner(
        PathBuf::from("node"),
        host_script,
        Duration::from_secs(5),
        None,
    )
    .unwrap();
    let created = host
        .session_create(
            Some("Cache".to_string()),
            Some(workspace.to_string_lossy().into_owned()),
            None,
            None,
            WorkspaceEnv::Local,
        )
        .unwrap();

    for prompt in ["first", "second"] {
        let sent = host
            .session_send(
                created.session.id.clone(),
                prompt.to_string(),
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(sent.session.last_prompt.as_deref(), Some(prompt));
    }

    host.shutdown();
}

#[test]
fn native_bridge_artifact_tools_bind_to_verified_session_id() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let store = crate::modules::artifacts::ArtifactStore::new(temp.path().join("artifacts"));
    let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
    sessions.lock().unwrap().insert(
        "pi-verified".to_string(),
        NativeToolSession {
            cwd: std::fs::canonicalize(&workspace).unwrap(),
            workspace_env: WorkspaceEnv::Local,
        },
    );
    let context = native_tools::NativeToolContext::with_artifacts(store.clone(), None);

    let result = execute_verified_native_tool(
        &sessions,
        NativeToolRequest {
            session_id: "pi-verified".to_string(),
            tool_call_id: "call-create".to_string(),
            tool_name: "create_artifact".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({
                "slug": "bound",
                "kind": "text",
                "content": "verified content"
            }),
        },
        &context,
    )
    .unwrap();

    assert_eq!(result.details["artifact"]["conversationId"], "pi-verified");
    assert_eq!(
        store.get("pi-verified", "bound", None).unwrap().content,
        "verified content"
    );
}

#[test]
fn native_bridge_rejects_unapproved_ask_capability_before_execution() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let marker = workspace.join("should-not-exist.txt");
    let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
    sessions.lock().unwrap().insert(
        "pi-verified".to_string(),
        NativeToolSession {
            cwd: std::fs::canonicalize(&workspace).unwrap(),
            workspace_env: WorkspaceEnv::Local,
        },
    );

    let error = execute_verified_native_tool(
        &sessions,
        NativeToolRequest {
            session_id: "pi-verified".to_string(),
            tool_call_id: "call-bash".to_string(),
            tool_name: "bash".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "command": format!("printf blocked > {}", marker.display()) }),
        },
        &native_tools::NativeToolContext::default(),
    )
    .unwrap_err();

    assert!(error.contains("requires approval"), "{error}");
    assert!(!marker.exists());
}

#[test]
fn native_bridge_allows_approved_ask_capability_once() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
    sessions.lock().unwrap().insert(
        "pi-verified".to_string(),
        NativeToolSession {
            cwd: std::fs::canonicalize(&workspace).unwrap(),
            workspace_env: WorkspaceEnv::Local,
        },
    );
    let approvals = NativeToolApprovals::default();
    approvals.remember_pending("pi-verified", "call-bash", "bash");
    approvals.approve_pending("pi-verified", "call-bash");

    let result = execute_verified_native_tool_with_approvals(
        &sessions,
        &approvals,
        NativeToolRequest {
            session_id: "pi-verified".to_string(),
            tool_call_id: "call-bash".to_string(),
            tool_name: "bash".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "command": "printf approved" }),
        },
        &native_tools::NativeToolContext::default(),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&result).unwrap()["content"][0]["text"],
        "approved"
    );

    let replay = execute_verified_native_tool_with_approvals(
        &sessions,
        &approvals,
        NativeToolRequest {
            session_id: "pi-verified".to_string(),
            tool_call_id: "call-bash".to_string(),
            tool_name: "bash".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "command": "printf replay" }),
        },
        &native_tools::NativeToolContext::default(),
    )
    .unwrap_err();
    assert!(replay.contains("requires approval"), "{replay}");
}

#[test]
fn native_bridge_allows_auto_mcp_capability_without_approval() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'auto-test', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'query', description: 'Query docs', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `query: ${request.params.arguments.query}` }], isError: false } });
  }
}
})();
"#,
    )
    .unwrap();
    let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
    sessions.lock().unwrap().insert(
        "pi-auto-mcp".to_string(),
        NativeToolSession {
            cwd: std::fs::canonicalize(&workspace).unwrap(),
            workspace_env: WorkspaceEnv::Local,
        },
    );
    let mcp_state = Arc::new(crate::modules::mcp::McpState::default());
    mcp_state
        .connect_stdio(crate::modules::mcp::McpServerConfig {
            id: "auto".to_string(),
            name: "Auto".to_string(),
            transport: crate::modules::mcp::McpTransport::Stdio,
            command: "node".to_string(),
            args: vec![script.to_string_lossy().into_owned()],
            cwd: Some(temp.path().to_string_lossy().into_owned()),
            url: None,
            oauth_token_env: None,
            env: vec![],
        })
        .unwrap();
    mcp_state.set_tool_preference(crate::modules::mcp::McpToolPreference {
        qualified_name: "mcp__auto__query".to_string(),
        model_visible: true,
        approval_policy: crate::modules::capabilities::ApprovalPolicy::Auto,
    });
    let approvals = NativeToolApprovals::default();
    let audit = crate::modules::capabilities::audit::CapabilityAuditLog::default();
    let context = native_tools::NativeToolContext::with_mcp_state(Arc::clone(&mcp_state));

    let result = execute_verified_native_tool_with_policy(
        &sessions,
        &approvals,
        &audit,
        NativeToolRequest {
            session_id: "pi-auto-mcp".to_string(),
            tool_call_id: "call-query".to_string(),
            tool_name: "mcp__auto__query".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "query": "hooks" }),
        },
        &context,
    )
    .unwrap();

    assert_eq!(
        serde_json::to_value(&result).unwrap()["content"][0]["text"],
        "query: hooks"
    );
    let entries = audit.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].tool_name, "mcp__auto__query");
    assert!(!entries[0].approved);
    assert!(entries[0].allowed);
    assert_eq!(
        entries[0].outcome,
        crate::modules::capabilities::audit::CapabilityAuditOutcome::Succeeded
    );

    mcp_state.set_tool_preference(crate::modules::mcp::McpToolPreference {
        qualified_name: "mcp__auto__query-docs".to_string(),
        model_visible: true,
        approval_policy: crate::modules::capabilities::ApprovalPolicy::Auto,
    });
    let error = execute_verified_native_tool_with_policy(
        &sessions,
        &approvals,
        &audit,
        NativeToolRequest {
            session_id: "pi-auto-mcp".to_string(),
            tool_call_id: "call-stale-query".to_string(),
            tool_name: "mcp__auto__query-docs".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "query": "hooks" }),
        },
        &context,
    )
    .unwrap_err();
    assert!(error.contains("MCP tool not found"), "{error}");
    assert!(!error.contains("unknown capability tool"), "{error}");
}

#[test]
fn native_bridge_audits_blocked_and_successful_capability_calls() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("note.txt"), "hello").unwrap();
    let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
    sessions.lock().unwrap().insert(
        "pi-verified".to_string(),
        NativeToolSession {
            cwd: std::fs::canonicalize(&workspace).unwrap(),
            workspace_env: WorkspaceEnv::Local,
        },
    );
    let approvals = NativeToolApprovals::default();
    let audit = crate::modules::capabilities::audit::CapabilityAuditLog::default();

    let _ = execute_verified_native_tool_with_policy(
        &sessions,
        &approvals,
        &audit,
        NativeToolRequest {
            session_id: "pi-verified".to_string(),
            tool_call_id: "call-blocked".to_string(),
            tool_name: "bash".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "command": "printf blocked" }),
        },
        &native_tools::NativeToolContext::default(),
    )
    .unwrap_err();
    execute_verified_native_tool_with_policy(
        &sessions,
        &approvals,
        &audit,
        NativeToolRequest {
            session_id: "pi-verified".to_string(),
            tool_call_id: "call-read".to_string(),
            tool_name: "read".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "path": "note.txt" }),
        },
        &native_tools::NativeToolContext::default(),
    )
    .unwrap();

    let entries = audit.entries();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].tool_name, "bash");
    assert!(!entries[0].allowed);
    assert_eq!(
        entries[0].outcome,
        crate::modules::capabilities::audit::CapabilityAuditOutcome::Blocked
    );
    assert_eq!(entries[1].tool_name, "read");
    assert!(entries[1].allowed);
    assert_eq!(
        entries[1].outcome,
        crate::modules::capabilities::audit::CapabilityAuditOutcome::Succeeded
    );
}

#[test]
fn native_bridge_rejects_workspace_env_mismatch_before_execution() {
    let temp = tempdir().unwrap();
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("note.txt"), "native bridge ok").unwrap();
    let sessions: NativeToolSessions = Arc::new(Mutex::new(HashMap::new()));
    sessions.lock().unwrap().insert(
        "pi-wsl".to_string(),
        NativeToolSession {
            cwd: std::fs::canonicalize(&workspace).unwrap(),
            workspace_env: WorkspaceEnv::Wsl {
                distro: "Ubuntu-24.04".to_string(),
            },
        },
    );

    let error = execute_verified_native_tool(
        &sessions,
        NativeToolRequest {
            session_id: "pi-wsl".to_string(),
            tool_call_id: "call-read".to_string(),
            tool_name: "read".to_string(),
            cwd: workspace.to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Local),
            input: json!({ "path": "note.txt" }),
        },
        &native_tools::NativeToolContext::default(),
    )
    .unwrap_err();

    assert!(error.contains("workspace env"), "{error}");
}

#[test]
fn production_timeouts_are_method_specific() {
    let timeouts = RequestTimeouts::production();

    assert!(timeouts.for_method("status") < timeouts.for_method("sessions.create"));
    assert!(timeouts.for_method("sessions.stop") < timeouts.for_method("models.list"));
    assert_eq!(timeouts.for_method("status"), Duration::from_secs(3));
}

#[test]
fn method_errors_preserve_structured_recovery_data() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("host.js");
    fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: request.params.protocolVersion } })}\n`);
    continue;
  }
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32006,
      message: 'Pi host supports at most 20 sessions',
      data: {
        code: 'PI_RESOURCE_LIMIT',
        category: 'resource_limit',
        retryable: false,
        remediation: 'Close older Pi sessions or shorten the prompt, then try again.'
      }
    }
  })}\n`);
}
"#,
        )
        .unwrap();
    let host = PiHost::spawn_inner_with_timeouts(
        PathBuf::from("node"),
        script,
        RequestTimeouts::for_tests(Duration::from_secs(1)),
        None,
    )
    .unwrap();

    let error = host.status().unwrap_err();
    let data = error.structured_data().unwrap();

    assert_eq!(data.code, "PI_RESOURCE_LIMIT");
    assert_eq!(data.category, "resource_limit");
    assert!(!data.retryable);
    assert_eq!(
        data.remediation,
        "Close older Pi sessions or shorten the prompt, then try again."
    );

    host.shutdown();
}

#[test]
fn request_timeout_uses_method_specific_duration() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("host.js");
    fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { pong: true, protocolVersion: request.params.protocolVersion } })}\n`);
  }
}
"#,
        )
        .unwrap();
    let timeouts = RequestTimeouts::for_tests(Duration::from_millis(500))
        .with_method("status", Duration::from_millis(75));
    let host =
        PiHost::spawn_inner_with_timeouts(PathBuf::from("node"), script, timeouts, None).unwrap();

    let error = host.status().unwrap_err().message();

    assert!(error.contains("status` timed out after 75ms"), "{error}");
    host.kill_child();
}

#[test]
fn startup_timeout_includes_captured_stderr() {
    let temp = tempdir().unwrap();
    let script = temp.path().join("host.js");
    fs::write(
        &script,
        "process.stderr.write('pi host boot note\\n'); setInterval(() => {}, 1000);",
    )
    .unwrap();

    let error = match PiHost::spawn_inner(
        PathBuf::from("node"),
        script,
        Duration::from_millis(500),
        None,
    ) {
        Ok(_) => panic!("host should time out during ping"),
        Err(error) => error,
    };

    assert!(error.contains("timed out"), "{error}");
    assert!(error.contains("pi host boot note"), "{error}");
}
