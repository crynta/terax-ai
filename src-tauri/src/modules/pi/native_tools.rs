use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::modules::artifacts::{ArtifactStore, ArtifactSummary, ArtifactUpdateReason};
use crate::modules::capabilities::{
    capability_manifest_with_mcp_tools, core_capability_manifest, ApprovalPolicy,
    CapabilityManifest,
};
use crate::modules::mcp::McpState;
use crate::modules::workspace::WorkspaceEnv;

mod artifact_tools;
mod fs_tools;
mod mcp_tools;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 50 * 1024;
const DEFAULT_LS_LIMIT: usize = 500;
const HARD_LS_LIMIT: usize = 2_000;
const DEFAULT_GREP_LIMIT: usize = 100;
const DEFAULT_FIND_LIMIT: usize = 1_000;
const HARD_SEARCH_LIMIT: usize = 2_000;
const DEFAULT_BASH_TIMEOUT_SECS: u64 = 30;
const HARD_BASH_TIMEOUT_SECS: u64 = 300;

pub(super) type ArtifactUpdateSink =
    Arc<dyn Fn(ArtifactSummary, ArtifactUpdateReason) + Send + Sync>;

#[derive(Clone, Default)]
pub(super) struct NativeToolContext {
    artifact_store: Option<ArtifactStore>,
    artifact_update_sink: Option<ArtifactUpdateSink>,
    mcp_state: Option<Arc<McpState>>,
}

impl NativeToolContext {
    #[cfg(test)]
    pub(super) fn with_artifacts(
        artifact_store: ArtifactStore,
        artifact_update_sink: Option<ArtifactUpdateSink>,
    ) -> Self {
        Self::with_artifacts_and_mcp_state(artifact_store, artifact_update_sink, None)
    }

    pub(super) fn with_artifacts_and_mcp_state(
        artifact_store: ArtifactStore,
        artifact_update_sink: Option<ArtifactUpdateSink>,
        mcp_state: Option<Arc<McpState>>,
    ) -> Self {
        Self {
            artifact_store: Some(artifact_store),
            artifact_update_sink,
            mcp_state,
        }
    }

    #[cfg(test)]
    pub(super) fn with_mcp_state(mcp_state: Arc<McpState>) -> Self {
        Self {
            artifact_store: None,
            artifact_update_sink: None,
            mcp_state: Some(mcp_state),
        }
    }

    pub(super) fn capability_manifest(&self) -> CapabilityManifest {
        let Some(mcp_state) = self.mcp_state.as_ref() else {
            return core_capability_manifest();
        };
        match mcp_state.tools() {
            Ok(tools) => capability_manifest_with_mcp_tools(&tools),
            Err(_) => core_capability_manifest(),
        }
    }

    pub(super) fn capability_manifest_for_tool(
        &self,
        tool_name: &str,
    ) -> Option<CapabilityManifest> {
        let mcp_state = self.mcp_state.as_ref()?;
        if !tool_name.starts_with("mcp__") {
            return None;
        }
        let tool = mcp_state.tool_descriptor(tool_name).ok().flatten()?;
        Some(capability_manifest_with_mcp_tools(&[tool]))
    }

    pub(super) fn mcp_approval_policy_for_tool(&self, tool_name: &str) -> Option<ApprovalPolicy> {
        let mcp_state = self.mcp_state.as_ref()?;
        if !tool_name.starts_with("mcp__") {
            return None;
        }
        mcp_state.approval_policy_for_tool(tool_name).ok().flatten()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolApprovalMetadata {
    pub policy: Option<ApprovalPolicy>,
    pub approved: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolRequest {
    pub session_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub cwd: String,
    #[serde(default)]
    pub workspace_env: Option<WorkspaceEnv>,
    #[serde(default)]
    pub approval: Option<NativeToolApprovalMetadata>,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolResult {
    pub content: Vec<NativeToolContent>,
    pub details: Value,
}

#[derive(Debug, Serialize)]
pub struct NativeToolContent {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
}

impl NativeToolResult {
    fn text(text: impl Into<String>, details: Value) -> Self {
        Self {
            content: vec![NativeToolContent {
                kind: "text",
                text: text.into(),
            }],
            details: mediated_details(details),
        }
    }
}

fn mediated_details(details: Value) -> Value {
    match details {
        Value::Object(mut object) => {
            object
                .entry("mediatedBy".to_string())
                .or_insert_with(|| Value::String("Terax Rust".to_string()));
            Value::Object(object)
        }
        Value::Null => {
            let mut object = Map::new();
            object.insert(
                "mediatedBy".to_string(),
                Value::String("Terax Rust".to_string()),
            );
            Value::Object(object)
        }
        other => {
            let mut object = Map::new();
            object.insert(
                "mediatedBy".to_string(),
                Value::String("Terax Rust".to_string()),
            );
            object.insert("result".to_string(), other);
            Value::Object(object)
        }
    }
}

#[cfg(test)]
fn execute(request: NativeToolRequest) -> Result<NativeToolResult, String> {
    execute_with_context(request, &NativeToolContext::default())
}

pub(super) fn execute_with_context(
    request: NativeToolRequest,
    context: &NativeToolContext,
) -> Result<NativeToolResult, String> {
    let workspace = fs_tools::canonical_workspace(&request.cwd)?;
    let workspace_env = request.workspace_env.clone().unwrap_or_default();
    let input = ToolInput::new(&request.input);
    match request.tool_name.as_str() {
        "read" => fs_tools::execute_read(&workspace, input),
        "ls" => fs_tools::execute_ls(&workspace, input),
        "grep" => fs_tools::execute_grep(&workspace, input),
        "find" => fs_tools::execute_find(&workspace, input),
        "bash" => fs_tools::execute_bash(&workspace, input, &workspace_env),
        "edit" => fs_tools::execute_edit(&workspace, input),
        "write" => fs_tools::execute_write(&workspace, input),
        "create_artifact" => artifact_tools::execute_create_artifact(&request, input, context),
        "edit_artifact" => artifact_tools::execute_edit_artifact(&request, input, context),
        "read_artifact" => artifact_tools::execute_read_artifact(&request, input, context),
        "list_artifacts" => artifact_tools::execute_list_artifacts(&request, input, context),
        tool_name if tool_name.starts_with("mcp__") => {
            mcp_tools::execute_mcp_tool(&request, tool_name, request.input.clone(), context)
        }
        other => Err(format!("unsupported native Pi tool: {other}")),
    }
}

struct ToolInput<'a> {
    value: &'a Value,
}

impl<'a> ToolInput<'a> {
    fn new(value: &'a Value) -> Self {
        Self { value }
    }

    fn string(&self, key: &str) -> Result<String, String> {
        self.optional_string(key)?
            .ok_or_else(|| format!("native tool input requires `{key}`"))
    }

    fn optional_string(&self, key: &str) -> Result<Option<String>, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(value)) if !value.trim().is_empty() => Ok(Some(value.clone())),
            Some(Value::String(_)) => Err(format!("native tool input `{key}` must not be empty")),
            Some(_) => Err(format!("native tool input `{key}` must be a string")),
        }
    }

    fn optional_usize(&self, key: &str) -> Result<Option<usize>, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => value
                .as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .map(Some)
                .ok_or_else(|| format!("native tool input `{key}` must be a positive integer")),
            Some(_) => Err(format!("native tool input `{key}` must be a number")),
        }
    }

    fn optional_u64(&self, key: &str) -> Result<Option<u64>, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => value
                .as_u64()
                .map(Some)
                .ok_or_else(|| format!("native tool input `{key}` must be a positive integer")),
            Some(_) => Err(format!("native tool input `{key}` must be a number")),
        }
    }

    fn optional_bool(&self, key: &str) -> Result<bool, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(value)) => Ok(*value),
            Some(_) => Err(format!("native tool input `{key}` must be a boolean")),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use serde_json::json;

    use super::*;

    fn request(cwd: &Path, tool_name: &str, input: Value) -> NativeToolRequest {
        NativeToolRequest {
            session_id: "pi-test".to_string(),
            tool_call_id: "call-test".to_string(),
            tool_name: tool_name.to_string(),
            cwd: cwd.to_string_lossy().into_owned(),
            workspace_env: None,
            approval: None,
            input,
        }
    }

    fn first_text(result: NativeToolResult) -> String {
        result.content.into_iter().next().unwrap().text
    }

    fn artifact_context(store: crate::modules::artifacts::ArtifactStore) -> NativeToolContext {
        NativeToolContext::with_artifacts(store, None)
    }

    #[test]
    fn artifact_create_uses_session_id_and_redacts_content_from_result() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::modules::artifacts::ArtifactStore::new(dir.path().join("artifacts"));
        let secret_content = "<section>artifact body must not echo</section>";

        let result = execute_with_context(
            request(
                dir.path(),
                "create_artifact",
                json!({
                    "slug": "Hero",
                    "kind": "html",
                    "title": "Hero",
                    "content": secret_content
                }),
            ),
            &artifact_context(store.clone()),
        )
        .unwrap();

        let text = first_text(result);
        assert!(text.contains("Created artifact hero"), "{text}");
        assert!(!text.contains(secret_content), "{text}");
        let artifact = store.get("pi-test", "hero", None).unwrap();
        assert_eq!(artifact.content, secret_content);
    }

    #[test]
    fn artifact_tools_reject_model_provided_conversation_id() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::modules::artifacts::ArtifactStore::new(dir.path().join("artifacts"));

        let error = execute_with_context(
            request(
                dir.path(),
                "create_artifact",
                json!({
                    "conversationId": "pi-other",
                    "slug": "Hero",
                    "kind": "html",
                    "content": "body"
                }),
            ),
            &artifact_context(store),
        )
        .unwrap_err();

        assert!(error.contains("conversationId"), "{error}");
    }

    #[test]
    fn artifact_read_is_capped_and_list_returns_summaries_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::modules::artifacts::ArtifactStore::new(dir.path().join("artifacts"));
        store
            .create(
                "pi-test",
                crate::modules::artifacts::ArtifactCreateInput {
                    slug: "large".to_string(),
                    title: None,
                    kind: crate::modules::artifacts::ArtifactKind::Text,
                    content: "x".repeat(MAX_OUTPUT_BYTES + 1),
                },
            )
            .unwrap();

        let list = execute_with_context(
            request(dir.path(), "list_artifacts", json!({})),
            &artifact_context(store.clone()),
        )
        .unwrap();
        let list_text = first_text(list);
        assert!(list_text.contains("large"), "{list_text}");
        assert!(!list_text.contains(&"x".repeat(100)), "{list_text}");

        let error = execute_with_context(
            request(dir.path(), "read_artifact", json!({ "id": "large" })),
            &artifact_context(store),
        )
        .unwrap_err();
        assert!(error.contains("ARTIFACT_TOO_LARGE"), "{error}");
    }

    #[test]
    fn read_is_workspace_scoped_and_truncated_by_lines() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("note.txt"), "one\ntwo\nthree").unwrap();
        fs::write(root.path().join("note.txt"), "outside").unwrap();

        let result = execute(request(
            &workspace,
            "read",
            json!({ "path": "note.txt", "offset": 2, "limit": 1 }),
        ))
        .unwrap();

        assert_eq!(first_text(result), "two");
        let outside = execute(request(
            &workspace,
            "read",
            json!({ "path": "../note.txt" }),
        ))
        .unwrap_err();
        assert!(outside.contains("inside the workspace"), "{outside}");
    }

    #[test]
    fn read_refuses_sensitive_paths() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".env"), "TOKEN=secret").unwrap();

        let error = execute(request(dir.path(), "read", json!({ "path": ".env" }))).unwrap_err();

        assert!(error.contains("sensitive path"), "{error}");
    }

    #[test]
    fn read_refuses_sensitive_directories() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = dir.path().join("secrets");
        fs::create_dir(&secrets).unwrap();
        fs::write(secrets.join("note.txt"), "hidden").unwrap();

        let error = execute(request(
            dir.path(),
            "read",
            json!({ "path": "secrets/note.txt" }),
        ))
        .unwrap_err();

        assert!(error.contains("sensitive path"), "{error}");
    }

    #[test]
    fn ls_skips_sensitive_entries() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("public.txt"), "public").unwrap();
        fs::write(dir.path().join(".env"), "TOKEN=secret").unwrap();
        fs::create_dir(dir.path().join("credentials")).unwrap();

        let result = execute(request(dir.path(), "ls", json!({ "path": "." }))).unwrap();
        let text = first_text(result);

        assert!(text.contains("public.txt"), "{text}");
        assert!(!text.contains(".env"), "{text}");
        assert!(!text.contains("credentials"), "{text}");
    }

    #[test]
    fn grep_skips_sensitive_files_inside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("public.txt"), "needle in public").unwrap();
        fs::write(dir.path().join("tokens.json"), "needle in secret").unwrap();
        fs::create_dir(dir.path().join("secrets")).unwrap();
        fs::write(dir.path().join("secrets/note.txt"), "needle in dir").unwrap();

        let result = execute(request(
            dir.path(),
            "grep",
            json!({ "pattern": "needle", "path": "." }),
        ))
        .unwrap();
        let text = first_text(result);

        assert!(text.contains("public.txt"), "{text}");
        assert!(!text.contains("tokens.json"), "{text}");
        assert!(!text.contains("secrets/note.txt"), "{text}");
    }

    #[test]
    fn find_skips_sensitive_files_inside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("public.txt"), "public").unwrap();
        fs::write(dir.path().join("tokens.json"), "secret").unwrap();
        fs::create_dir(dir.path().join("secrets")).unwrap();
        fs::write(dir.path().join("secrets/note.txt"), "secret").unwrap();

        let result = execute(request(
            dir.path(),
            "find",
            json!({ "pattern": "*", "path": "." }),
        ))
        .unwrap();
        let text = first_text(result);

        assert!(text.contains("public.txt"), "{text}");
        assert!(!text.contains("tokens.json"), "{text}");
        assert!(!text.contains("secrets/note.txt"), "{text}");
    }

    #[test]
    fn bash_refuses_wsl_workspace_env_until_wsl_execution_is_wired() {
        let dir = tempfile::tempdir().unwrap();

        let error = execute(NativeToolRequest {
            session_id: "pi-wsl".to_string(),
            tool_call_id: "call-bash".to_string(),
            tool_name: "bash".to_string(),
            cwd: dir.path().to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Wsl {
                distro: "Ubuntu-24.04".to_string(),
            }),
            approval: None,
            input: json!({ "command": "pwd" }),
        })
        .unwrap_err();

        assert!(error.contains("disabled for WSL workspaces"), "{error}");
    }

    #[test]
    fn edit_applies_unique_non_overlapping_replacements() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        fs::write(&path, "alpha beta gamma").unwrap();

        execute(request(
            dir.path(),
            "edit",
            json!({
                "path": "note.txt",
                "edits": [{ "oldText": "beta", "newText": "BETA" }]
            }),
        ))
        .unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "alpha BETA gamma");
    }

    #[test]
    fn write_creates_missing_workspace_parents() {
        let dir = tempfile::tempdir().unwrap();

        execute(request(
            dir.path(),
            "write",
            json!({ "path": "nested/note.txt", "content": "hello" }),
        ))
        .unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("nested/note.txt")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn mcp_native_tool_routes_through_context_state() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-test', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'say', description: 'Say text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `mcp: ${request.params.arguments.text}` }], isError: false } });
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
                args: vec![script.to_string_lossy().into_owned()],
                cwd: Some(dir.path().to_string_lossy().into_owned()),
                url: None,
                oauth_token_env: None,
                env: vec![],
            })
            .unwrap();
        let context = NativeToolContext::with_mcp_state(mcp_state);

        let result = execute_with_context(
            request(dir.path(), "mcp__echo__say", json!({ "text": "hello" })),
            &context,
        )
        .unwrap();

        assert_eq!(first_text(result), "mcp: hello");
    }

    #[test]
    fn mcp_native_tool_stores_binary_results_as_artifacts_without_forwarding_raw_data() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'artifact-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'image', description: 'Image data', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'image', mimeType: 'image/png', data: 'RAWBASE64SECRET' }], isError: false } });
  }
}
})();
"#,
        )
        .unwrap();
        let mcp_state = Arc::new(crate::modules::mcp::McpState::default());
        mcp_state
            .connect_stdio(crate::modules::mcp::McpServerConfig {
                id: "artifact".to_string(),
                name: "Artifact".to_string(),
                transport: crate::modules::mcp::McpTransport::Stdio,
                command: "node".to_string(),
                args: vec![script.to_string_lossy().into_owned()],
                cwd: Some(dir.path().to_string_lossy().into_owned()),
                url: None,
                oauth_token_env: None,
                env: vec![],
            })
            .unwrap();
        let store = crate::modules::artifacts::ArtifactStore::new(dir.path().join("artifacts"));
        let context =
            NativeToolContext::with_artifacts_and_mcp_state(store.clone(), None, Some(mcp_state));

        let result = execute_with_context(
            request(dir.path(), "mcp__artifact__image", json!({})),
            &context,
        )
        .unwrap();
        let details = serde_json::to_string(&result.details).unwrap();
        let text = first_text(result);
        let artifacts = store.list("pi-test").unwrap();
        let artifact = store.get("pi-test", &artifacts[0].slug, None).unwrap();

        assert_eq!(artifacts.len(), 1);
        assert_eq!(
            artifact.summary.kind,
            crate::modules::artifacts::ArtifactKind::Json
        );
        assert!(text.contains("artifact"), "{text}");
        assert!(details.contains("artifacts"), "{details}");
        assert!(artifact.content.contains("RAWBASE64SECRET"));
        assert!(!details.contains("RAWBASE64SECRET"));
    }

    #[test]
    fn mcp_native_tool_caps_large_raw_data_artifacts() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'large-artifact-mcp', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'image', description: 'Large image data', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (request.method === 'tools/call') {
    const data = 'A'.repeat(300000) + 'RAWTAILSECRET';
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'image', mimeType: 'image/png', data }], isError: false } });
  }
}
})();
"#,
        )
        .unwrap();
        let mcp_state = Arc::new(crate::modules::mcp::McpState::default());
        mcp_state
            .connect_stdio(crate::modules::mcp::McpServerConfig {
                id: "large-artifact".to_string(),
                name: "Large artifact".to_string(),
                transport: crate::modules::mcp::McpTransport::Stdio,
                command: "node".to_string(),
                args: vec![script.to_string_lossy().into_owned()],
                cwd: Some(dir.path().to_string_lossy().into_owned()),
                url: None,
                oauth_token_env: None,
                env: vec![],
            })
            .unwrap();
        let store = crate::modules::artifacts::ArtifactStore::new(dir.path().join("artifacts"));
        let context =
            NativeToolContext::with_artifacts_and_mcp_state(store.clone(), None, Some(mcp_state));

        let result = execute_with_context(
            request(dir.path(), "mcp__large-artifact__image", json!({})),
            &context,
        )
        .unwrap();
        let details = serde_json::to_string(&result.details).unwrap();
        let artifacts = store.list("pi-test").unwrap();
        let artifact = store.get("pi-test", &artifacts[0].slug, None).unwrap();

        assert_eq!(artifacts.len(), 1);
        assert!(artifact.content.contains("\"dataOmitted\":true"));
        assert!(artifact.content.contains("\"rawDataBytes\":300013"));
        assert!(artifact.content.contains("\"maxRawDataBytes\":"));
        assert!(
            artifact.summary.content_bytes < 1024,
            "{}",
            artifact.content
        );
        assert!(!artifact.content.contains("RAWTAILSECRET"));
        assert!(!details.contains("RAWTAILSECRET"));
    }

    #[test]
    fn mcp_native_tool_redacts_binary_result_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("mcp-server.js");
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
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'binary-native', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'image', description: 'Image data', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (request.method === 'tools/call') {
    write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'image', mimeType: 'image/png', data: 'RAWBASE64SECRET' }], isError: false } });
  }
}
})();
"#,
        )
        .unwrap();
        let mcp_state = Arc::new(crate::modules::mcp::McpState::default());
        mcp_state
            .connect_stdio(crate::modules::mcp::McpServerConfig {
                id: "binary".to_string(),
                name: "Binary".to_string(),
                transport: crate::modules::mcp::McpTransport::Stdio,
                command: "node".to_string(),
                args: vec![script.to_string_lossy().into_owned()],
                cwd: Some(dir.path().to_string_lossy().into_owned()),
                url: None,
                oauth_token_env: None,
                env: vec![],
            })
            .unwrap();
        let context = NativeToolContext::with_mcp_state(mcp_state);

        let result = execute_with_context(
            request(dir.path(), "mcp__binary__image", json!({})),
            &context,
        )
        .unwrap();
        let details = serde_json::to_string(&result.details).unwrap();
        let text = first_text(result);

        assert!(text.contains("omitted"));
        assert!(details.contains("image/png"));
        assert!(!details.contains("RAWBASE64SECRET"));
    }

    #[test]
    fn mcp_native_tool_requires_context_state() {
        let dir = tempfile::tempdir().unwrap();

        let error = execute_with_context(
            request(dir.path(), "mcp__echo__say", json!({ "text": "hello" })),
            &NativeToolContext::default(),
        )
        .unwrap_err();

        assert!(error.contains("MCP"), "{error}");
    }
}
