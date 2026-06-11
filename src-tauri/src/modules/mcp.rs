//! Model Context Protocol (MCP) bridge: server config management, stdio/HTTP connections, tool discovery, and tool invocation with approval flow.

use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::modules::capabilities::{
    capability_manifest_with_mcp_tools, ApprovalPolicy, CapabilityManifest,
};
use crate::modules::secrets::{
    delete_secret_value, get_secret_value, set_secret_value, SecretsState,
};

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MCP_RESTART_FAILURE_WINDOW: Duration = Duration::from_secs(60);
const MCP_RESTART_COOLDOWN: Duration = Duration::from_secs(30);
const MCP_RESTART_FAILURE_THRESHOLD: usize = 3;
const MCP_HTTP_BODY_LIMIT: usize = 1024 * 1024;
const MCP_TEXT_RESULT_LIMIT: usize = 64 * 1024;
const MCP_CONTENT_ITEM_LIMIT: usize = 16;
const MCP_MIME_TYPE_LIMIT: usize = 120;
const MCP_NAME_LIMIT: usize = 80;
const MCP_DESCRIPTION_LIMIT: usize = 512;
const MCP_SCHEMA_PROPERTY_LIMIT: usize = 12;
const MCP_SCHEMA_DESCRIPTION_LIMIT: usize = 240;
const MCP_STORED_CONFIG_MAX_BYTES: u64 = 256 * 1024;
const MCP_STORED_SERVER_LIMIT: usize = 64;
const MCP_STORED_ARG_LIMIT: usize = 64;
const MCP_STORED_ENV_LIMIT: usize = 32;
const MCP_STORED_TEXT_LIMIT: usize = 4096;
const MCP_TOOL_PREFERENCES_MAX_BYTES: u64 = 256 * 1024;
const MCP_TOOL_PREFERENCE_LIMIT: usize = 512;
const MCP_STDERR_TAIL_LIMIT: usize = 8 * 1024;
const MCP_FAILURE_LIMIT: usize = 1024;
const MCP_ENV_SECRET_SERVICE: &str = "terax-mcp-env";
const MCP_OAUTH_DEFAULT_SCOPE: &str = "mcp";
const MCP_OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:38573/mcp/oauth/callback";
const MCP_OAUTH_CLIENT_NAME: &str = "Terax";
const MCP_OAUTH_FALLBACK_CLIENT_ID: &str = "terax";
const MCP_ALLOWED_COMMANDS: &[&str] = &[
    "node", "npx", "npm", "pnpm", "bun", "deno", "uvx", "uv", "python", "python3",
];

mod config_store;
mod connections;
mod oauth;
mod sanitize;
mod types;
#[cfg(feature = "openclicky")]
pub mod cli;
#[cfg(feature = "openclicky")]
pub mod server;
#[cfg(feature = "openclicky")]
pub mod server_tools;
use config_store::{mcp_config_path, mcp_tool_preferences_path, sync_tool_preferences_from_app};
pub use config_store::{
    mcp_connect_saved_stdio_at_path, mcp_connect_saved_stdio_at_path_with_env_loader,
    mcp_runtime_config_from_stored_with_env_loader, mcp_server_config_remove_at_path,
    mcp_server_config_save_at_path, mcp_server_configs_list_at_path, mcp_tool_policy_set_at_path,
    mcp_tool_preference_set_at_path, mcp_tool_preferences_list_at_path,
};
use connections::McpConnection;
pub use oauth::{
    mcp_oauth_complete_at_path, mcp_oauth_start_at_path, mcp_oauth_wait_for_callback_once,
};
pub use sanitize::mcp_env_secret_account;
use sanitize::{parse_qualified_tool_name, sanitize_server_id, sanitize_text_token};
pub use types::*;

#[derive(Default)]
pub struct McpState {
    connections: Mutex<HashMap<String, Arc<McpConnection>>>,
    tool_preferences: Mutex<HashMap<String, McpToolPreference>>,
    restart_backoff: Mutex<HashMap<String, McpRestartBackoff>>,
}

#[derive(Default)]
struct McpRestartBackoff {
    failures: Vec<Instant>,
    paused_until: Option<Instant>,
}

impl McpState {
    /// Connects to an MCP server over stdio, initializing the connection and refreshing tools.
    pub fn connect_stdio(&self, mut config: McpServerConfig) -> Result<(), String> {
        config.transport = McpTransport::Stdio;
        self.connect_config(config)
    }

    /// Connects to an MCP server over HTTP, initializing the connection and refreshing tools.
    pub fn connect_http(&self, mut config: McpServerConfig) -> Result<(), String> {
        config.transport = McpTransport::Http;
        self.connect_config(config)
    }

    /// Connects to an MCP server over HTTP using an async transport.
    pub async fn connect_http_async(&self, mut config: McpServerConfig) -> Result<(), String> {
        config.transport = McpTransport::Http;
        self.connect_config_async(config).await
    }

    /// Connects to an MCP server using the transport specified in the config.
    pub fn connect_config(&self, config: McpServerConfig) -> Result<(), String> {
        let server_id = sanitize_server_id(&config.id)?;
        self.ensure_restart_allowed(&server_id)?;
        let server_name = sanitize_text_token(&config.name, MCP_NAME_LIMIT);
        let connection = match McpConnection::spawn(server_id.clone(), server_name, config) {
            Ok(connection) => Arc::new(connection),
            Err(error) => {
                self.record_restart_failure(&server_id);
                return Err(error);
            }
        };
        let startup_result = connection
            .initialize()
            .and_then(|_| connection.refresh_tools());
        if let Err(error) = startup_result {
            self.record_restart_failure(&server_id);
            connection.shutdown();
            return Err(error);
        }
        self.clear_restart_failures(&server_id);
        let mut connections = self
            .connections
            .lock()
            .map_err(|error| format!("MCP registry lock failed: {error}"))?;
        if let Some(previous) = connections.insert(server_id, Arc::clone(&connection)) {
            previous.shutdown();
        }
        Ok(())
    }

    /// Connects to an MCP server asynchronously using the transport specified in the config.
    pub async fn connect_config_async(&self, config: McpServerConfig) -> Result<(), String> {
        let server_id = sanitize_server_id(&config.id)?;
        self.ensure_restart_allowed(&server_id)?;
        let server_name = sanitize_text_token(&config.name, MCP_NAME_LIMIT);
        let connection = match McpConnection::spawn(server_id.clone(), server_name, config) {
            Ok(connection) => Arc::new(connection),
            Err(error) => {
                self.record_restart_failure(&server_id);
                return Err(error);
            }
        };
        connection.initialize_async().await?;
        let startup_result = connection.refresh_tools_async().await;
        if let Err(error) = startup_result {
            self.record_restart_failure(&server_id);
            connection.shutdown();
            return Err(error);
        }
        self.clear_restart_failures(&server_id);
        let mut connections = self
            .connections
            .lock()
            .map_err(|error| format!("MCP registry lock failed: {error}"))?;
        if let Some(previous) = connections.insert(server_id, Arc::clone(&connection)) {
            previous.shutdown();
        }
        Ok(())
    }

    /// Disconnects from the given MCP server, returning whether a connection was found.
    pub fn disconnect(&self, server_id: &str) -> Result<bool, String> {
        let server_id = sanitize_server_id(server_id)?;
        let mut connections = self
            .connections
            .lock()
            .map_err(|error| format!("MCP registry lock failed: {error}"))?;
        let Some(connection) = connections.remove(&server_id) else {
            return Ok(false);
        };
        if connection.status()?.status != "connected" {
            self.record_restart_failure(&server_id);
        }
        connection.shutdown();
        Ok(true)
    }

    fn ensure_restart_allowed(&self, server_id: &str) -> Result<(), String> {
        let Some(remaining) = self.restart_backoff_remaining(server_id) else {
            return Ok(());
        };
        Err(format!(
            "MCP server restart is temporarily paused after repeated failures; retry in {}s",
            remaining.as_secs().max(1)
        ))
    }

    fn restart_backoff_remaining(&self, server_id: &str) -> Option<Duration> {
        let Ok(mut backoff) = self.restart_backoff.lock() else {
            return None;
        };
        let state = backoff.get_mut(server_id)?;
        let paused_until = state.paused_until?;
        let now = Instant::now();
        if paused_until <= now {
            state.paused_until = None;
            state.failures.clear();
            return None;
        }
        Some(paused_until.saturating_duration_since(now))
    }

    fn restart_backoff_millis(&self, server_id: &str) -> Option<u64> {
        self.restart_backoff_remaining(server_id)
            .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
    }

    fn record_restart_failure(&self, server_id: &str) {
        let Ok(mut backoff) = self.restart_backoff.lock() else {
            return;
        };
        let now = Instant::now();
        let state = backoff.entry(server_id.to_string()).or_default();
        state.failures.retain(|instant| {
            now.saturating_duration_since(*instant) <= MCP_RESTART_FAILURE_WINDOW
        });
        state.failures.push(now);
        if state.failures.len() >= MCP_RESTART_FAILURE_THRESHOLD {
            state.paused_until = Some(now + MCP_RESTART_COOLDOWN);
        }
    }

    fn clear_restart_failures(&self, server_id: &str) {
        if let Ok(mut backoff) = self.restart_backoff.lock() {
            backoff.remove(server_id);
        }
    }

    /// Applies a single tool preference override, updating the in-memory preference map.
    pub fn set_tool_preference(&self, preference: McpToolPreference) {
        if let Ok(mut preferences) = self.tool_preferences.lock() {
            preferences.insert(preference.qualified_name.clone(), preference);
        }
    }

    /// Replaces all in-memory tool preferences with the provided list.
    pub fn set_tool_preferences(&self, preferences: Vec<McpToolPreference>) {
        if let Ok(mut stored) = self.tool_preferences.lock() {
            stored.clear();
            stored.extend(
                preferences
                    .into_iter()
                    .map(|preference| (preference.qualified_name.clone(), preference)),
            );
        }
    }

    fn tool_preference(&self, qualified_name: &str) -> Option<McpToolPreference> {
        self.tool_preferences
            .lock()
            .ok()
            .and_then(|preferences| preferences.get(qualified_name).cloned())
    }

    fn apply_tool_preference(&self, tool: &mut McpToolDescriptor) {
        let Some(preference) = self.tool_preference(&tool.qualified_name) else {
            tool.model_visible = true;
            tool.approval_policy = ApprovalPolicy::Ask;
            return;
        };
        tool.approval_policy = preference.approval_policy;
        tool.model_visible =
            preference.model_visible && preference.approval_policy != ApprovalPolicy::Deny;
    }

    /// Returns all discovered MCP tools across connected servers, with tool preferences applied.
    pub fn tools(&self) -> Result<Vec<McpToolDescriptor>, String> {
        let connections = self
            .connections
            .lock()
            .map_err(|error| format!("MCP registry lock failed: {error}"))?;
        let mut tools = Vec::new();
        for connection in connections.values() {
            tools.extend(connection.public_tools()?);
        }
        for tool in &mut tools {
            self.apply_tool_preference(tool);
        }
        tools.sort_by(|left, right| left.qualified_name.cmp(&right.qualified_name));
        Ok(tools)
    }

    /// Returns the approval policy for a given qualified tool name.
    pub fn approval_policy_for_tool(
        &self,
        qualified_name: &str,
    ) -> Result<Option<ApprovalPolicy>, String> {
        if let Some(preference) = self.tool_preference(qualified_name) {
            return Ok(Some(preference.approval_policy));
        }
        Ok(self
            .tool_descriptor(qualified_name)?
            .map(|tool| tool.approval_policy))
    }

    /// Returns the tool descriptor for a given qualified tool name, including any preference overrides.
    pub fn tool_descriptor(
        &self,
        qualified_name: &str,
    ) -> Result<Option<McpToolDescriptor>, String> {
        let (server_id, tool_key) = parse_qualified_tool_name(qualified_name)?;
        let connection = {
            let connections = self
                .connections
                .lock()
                .map_err(|error| format!("MCP registry lock failed: {error}"))?;
            connections.get(&server_id).cloned()
        };
        let Some(connection) = connection else {
            return Ok(None);
        };
        let mut tool = connection
            .public_tools()?
            .into_iter()
            .find(|tool| tool.qualified_name == qualified_name);
        if let Some(tool) = tool.as_mut() {
            self.apply_tool_preference(tool);
            return Ok(Some(tool.clone()));
        }
        let Some(preference) = self.tool_preference(qualified_name) else {
            return Ok(None);
        };
        if preference.approval_policy == ApprovalPolicy::Deny || !preference.model_visible {
            return Ok(None);
        }
        let status = connection.status()?;
        Ok(Some(McpToolDescriptor {
            server_id,
            server_name: status.server_name,
            name: tool_key,
            qualified_name: qualified_name.to_string(),
            description: "MCP tool from saved policy preference".to_string(),
            input_schema: json!({ "type": "object", "properties": {}, "required": [] }),
            model_visible: true,
            approval_policy: preference.approval_policy,
            risk_level: McpToolRiskLevel::Medium,
            risk_reasons: vec!["Tool metadata was unavailable during policy check".to_string()],
        }))
    }

    /// Returns the status of all connected MCP servers.
    pub fn server_statuses(&self) -> Result<Vec<McpServerStatus>, String> {
        let connections = self
            .connections
            .lock()
            .map_err(|error| format!("MCP registry lock failed: {error}"))?;
        let mut statuses = connections
            .values()
            .map(|connection| connection.status())
            .collect::<Result<Vec<_>, _>>()?;
        for status in &mut statuses {
            status.restart_backoff_ms = self.restart_backoff_millis(&status.server_id);
        }
        statuses.sort_by(|left, right| left.server_id.cmp(&right.server_id));
        Ok(statuses)
    }

    /// Invokes an MCP tool synchronously by its qualified name (stdio transport only).
    pub fn call_tool(
        &self,
        qualified_name: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        let (server_id, tool_key) = parse_qualified_tool_name(qualified_name)?;
        let connection = {
            let connections = self
                .connections
                .lock()
                .map_err(|error| format!("MCP registry lock failed: {error}"))?;
            connections
                .get(&server_id)
                .cloned()
                .ok_or_else(|| format!("MCP server is not connected: {server_id}"))?
        };
        connection.call_tool_by_key(&tool_key, arguments)
    }

    /// Invokes an MCP tool asynchronously by its qualified name (supports both stdio and HTTP transports).
    pub async fn call_tool_async(
        &self,
        qualified_name: &str,
        arguments: Value,
    ) -> Result<McpToolCallResult, String> {
        let (server_id, tool_key) = parse_qualified_tool_name(qualified_name)?;
        let connection = {
            let connections = self
                .connections
                .lock()
                .map_err(|error| format!("MCP registry lock failed: {error}"))?;
            connections
                .get(&server_id)
                .cloned()
                .ok_or_else(|| format!("MCP server is not connected: {server_id}"))?
        };
        connection
            .call_tool_by_key_async(&tool_key, arguments)
            .await
    }
}

#[tauri::command]
pub fn mcp_server_configs_list(app: AppHandle) -> Result<Vec<McpStoredServerConfig>, String> {
    mcp_server_configs_list_at_path(&mcp_config_path(&app)?)
}

#[tauri::command]
pub fn mcp_server_config_save(
    app: AppHandle,
    config: McpServerConfig,
) -> Result<McpStoredServerConfig, String> {
    mcp_server_config_save_at_path(&mcp_config_path(&app)?, config)
}

#[tauri::command]
pub fn mcp_server_config_remove(app: AppHandle, server_id: String) -> Result<bool, String> {
    mcp_server_config_remove_at_path(&mcp_config_path(&app)?, &server_id)
}

#[tauri::command]
pub fn mcp_tool_preferences_list(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
) -> Result<Vec<McpToolPreference>, String> {
    let preferences = mcp_tool_preferences_list_at_path(&mcp_tool_preferences_path(&app)?)?;
    state.set_tool_preferences(preferences.clone());
    Ok(preferences)
}

#[tauri::command]
pub fn mcp_tool_preference_set(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    qualified_name: String,
    model_visible: bool,
) -> Result<McpToolPreference, String> {
    let preference = mcp_tool_preference_set_at_path(
        &mcp_tool_preferences_path(&app)?,
        &qualified_name,
        model_visible,
    )?;
    state.set_tool_preference(preference.clone());
    Ok(preference)
}

#[tauri::command]
pub fn mcp_tool_policy_set(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    qualified_name: String,
    approval_policy: ApprovalPolicy,
) -> Result<McpToolPreference, String> {
    let preference = mcp_tool_policy_set_at_path(
        &mcp_tool_preferences_path(&app)?,
        &qualified_name,
        approval_policy,
    )?;
    state.set_tool_preference(preference.clone());
    Ok(preference)
}

#[tauri::command]
pub fn mcp_env_secret_statuses(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    server_id: String,
    names: Vec<String>,
) -> Result<Vec<McpEnvSecretStatus>, String> {
    let server_id = sanitize_server_id(&server_id)?;
    names
        .into_iter()
        .map(|name| {
            let account = mcp_env_secret_account(&server_id, &name)?;
            let configured = get_secret_value(&app, &secrets, MCP_ENV_SECRET_SERVICE, &account)?
                .map(|value| !value.is_empty())
                .unwrap_or(false);
            Ok(McpEnvSecretStatus {
                server_id: server_id.clone(),
                name,
                configured,
            })
        })
        .collect()
}

#[tauri::command]
pub fn mcp_env_secret_set(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    server_id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    if value.is_empty() {
        return Err("MCP env value must not be empty; remove it instead".to_string());
    }
    let account = mcp_env_secret_account(&server_id, &name)?;
    set_secret_value(&app, &secrets, MCP_ENV_SECRET_SERVICE, &account, &value)
}

#[tauri::command]
pub fn mcp_env_secret_remove(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    server_id: String,
    name: String,
) -> Result<(), String> {
    let account = mcp_env_secret_account(&server_id, &name)?;
    delete_secret_value(&app, &secrets, MCP_ENV_SECRET_SERVICE, &account)
}

#[tauri::command]
pub async fn mcp_oauth_start(
    app: AppHandle,
    request: McpOAuthStartRequest,
) -> Result<McpOAuthStartResult, String> {
    mcp_oauth_start_at_path(&mcp_config_path(&app)?, request).await
}

#[tauri::command]
pub async fn mcp_oauth_wait_for_callback(
    request: McpOAuthCallbackWaitRequest,
) -> Result<McpOAuthCallbackWaitResult, String> {
    tauri::async_runtime::spawn_blocking(move || mcp_oauth_wait_for_callback_once(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn mcp_oauth_complete(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    request: McpOAuthCompleteRequest,
) -> Result<McpOAuthCompleteResult, String> {
    let token = mcp_oauth_complete_at_path(&mcp_config_path(&app)?, &request).await?;
    let account = mcp_env_secret_account(&request.server_id, &request.token_env)?;
    set_secret_value(
        &app,
        &secrets,
        MCP_ENV_SECRET_SERVICE,
        &account,
        &token.access_token,
    )?;
    Ok(McpOAuthCompleteResult {
        server_id: request.server_id,
        token_env: request.token_env,
        access_token_stored: true,
        expires_in: token.expires_in,
        scope: token.scope,
    })
}

#[tauri::command]
pub fn mcp_connect_saved_stdio(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    secrets: tauri::State<'_, SecretsState>,
    server_id: String,
) -> Result<(), String> {
    sync_tool_preferences_from_app(&app, state.inner().as_ref())?;
    let config_path = mcp_config_path(&app)?;
    mcp_connect_saved_stdio_at_path_with_env_loader(
        state.inner().as_ref(),
        &config_path,
        &server_id,
        |saved_server_id, env_name| {
            mcp_env_secret_account(saved_server_id, env_name)
                .ok()
                .and_then(|account| {
                    get_secret_value(&app, &secrets, MCP_ENV_SECRET_SERVICE, &account)
                        .ok()
                        .flatten()
                })
                .or_else(|| env::var(env_name).ok())
        },
    )
}

#[tauri::command]
pub async fn mcp_connect_stdio(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    config: McpServerConfig,
) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        sync_tool_preferences_from_app(&app, state.as_ref())?;
        state.connect_stdio(config)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn mcp_connect_http(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    config: McpServerConfig,
) -> Result<(), String> {
    let mcp_state = Arc::clone(state.inner());
    let sync_state = Arc::clone(&mcp_state);
    let sync_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        sync_tool_preferences_from_app(&sync_app, sync_state.as_ref())
    })
    .await
    .map_err(|error| error.to_string())??;
    mcp_state.connect_http_async(config).await
}

#[tauri::command]
pub fn mcp_disconnect(
    state: tauri::State<'_, Arc<McpState>>,
    server_id: String,
) -> Result<bool, String> {
    state.disconnect(&server_id)
}

#[tauri::command]
pub fn mcp_tools(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
) -> Result<Vec<McpToolDescriptor>, String> {
    sync_tool_preferences_from_app(&app, state.inner().as_ref())?;
    state.tools()
}

/// Returns the full capability manifest (core native tools + MCP tools with
/// resolved approval policies). This is the single policy authority the webview
/// Pi agent consults to decide which tools require approval, matching how the
/// sidecar enforced policy.
#[tauri::command]
pub fn pi_capability_manifest(
    app: AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
) -> Result<CapabilityManifest, String> {
    sync_tool_preferences_from_app(&app, state.inner().as_ref())?;
    let tools = state.tools().unwrap_or_default();
    Ok(capability_manifest_with_mcp_tools(&tools))
}

#[tauri::command]
pub fn mcp_server_statuses(
    state: tauri::State<'_, Arc<McpState>>,
) -> Result<Vec<McpServerStatus>, String> {
    state.server_statuses()
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: tauri::State<'_, Arc<McpState>>,
    app_audit: tauri::State<'_, crate::modules::capabilities::AppCapabilityState>,
    qualified_name: String,
    arguments: Value,
) -> Result<McpToolCallResult, String> {
    // Record every direct MCP tool invocation in the capability audit. Agent
    // MCP calls route through pi_agent_tool_execute (which audits separately);
    // this covers direct UI-driven calls so the ledger is complete.
    app_audit
        .execute_app_capability_async("app.mcp_tool", || async move {
            state
                .inner()
                .call_tool_async(&qualified_name, arguments)
                .await
        })
        .await
}

impl Drop for McpState {
    fn drop(&mut self) {
        if let Ok(connections) = self.connections.get_mut() {
            for connection in connections.values() {
                connection.shutdown();
            }
        }
    }
}
