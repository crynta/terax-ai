//! Pi AI session lifecycle: host process spawning, JSON-RPC protocol, session create/send/resume/delete, native tool execution, and history persistence.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::modules::artifacts::{self, ArtifactsState};
use crate::modules::capabilities::{WorkflowCapabilityState, WorkflowPolicyContext};
use crate::modules::mcp::McpState;
use crate::modules::secrets::SecretsState;
use crate::modules::workspace::{self, WorkspaceEnv, WorkspaceRegistry};

mod agent_tools;
mod host;
mod local_agents;
mod native_tools;
mod provider_config;
mod store;

pub use agent_tools::*;

use host::PiSessionEventSink;

mod types;
use provider_config::{default_pi_agent_dir, resolve_provider_config};
use types::PiCommandResult;
pub use types::*;

mod state;
pub use state::PiState;
use state::{
    CreateSessionRequest, DeleteSessionRequest, PiHostContext, RenameSessionRequest,
    ResumeSessionRequest, SendPromptRequest, ToolRespondRequest,
};

fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

fn sdk_session_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pi-sdk-sessions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Validates that a Pi SDK session file path stays within the app's session directory.
fn validate_sdk_session_file_path(
    session_file: &str,
    session_dir: &Path,
) -> Result<String, String> {
    let path = PathBuf::from(session_file);
    if !path.is_absolute() {
        return Err("Pi SDK session file must be an absolute path".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Pi SDK session file must have a parent directory".to_string())?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Pi SDK session file directory is not accessible: {e}"))?;
    let canonical_session_dir = std::fs::canonicalize(session_dir)
        .map_err(|e| format!("Pi SDK session directory is not accessible: {e}"))?;
    if !canonical_parent.starts_with(&canonical_session_dir) {
        return Err("Pi SDK session file must stay inside the Terax session directory".to_string());
    }

    match std::fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
                return Err("Pi SDK session file must be a regular file".to_string());
            }
            let canonical_file = std::fs::canonicalize(&path)
                .map_err(|e| format!("Pi SDK session file is not accessible: {e}"))?;
            if !canonical_file.starts_with(&canonical_session_dir) {
                return Err(
                    "Pi SDK session file must stay inside the Terax session directory".to_string(),
                );
            }
            Ok(crate::modules::fs::to_canon(canonical_file))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(crate::modules::fs::to_canon(&path))
        }
        Err(error) => Err(format!("Pi SDK session file is not accessible: {error}")),
    }
}

/// Validates that a Pi SDK session file exists and stays within the app's session directory.
fn validate_existing_sdk_session_file_path(
    session_file: &str,
    session_dir: &Path,
) -> Result<String, String> {
    let normalized = validate_sdk_session_file_path(session_file, session_dir)?;
    if !Path::new(&normalized).is_file() {
        return Err("Pi SDK session file must exist before resume".to_string());
    }
    Ok(normalized)
}

fn validate_session_sdk_file(session: &mut PiSession, session_dir: &Path) -> Result<(), String> {
    let Some(session_file) = session.sdk_session_file.as_deref() else {
        return Err("Pi session did not report an SDK session file".to_string());
    };
    session.sdk_session_file = Some(validate_sdk_session_file_path(session_file, session_dir)?);
    Ok(())
}

/// Creates the event sink that broadcasts Pi session events to the frontend and records them to history.
fn session_event_sink(app: &AppHandle) -> PiSessionEventSink {
    let app = app.clone();
    let history_path = store::history_path(&app).ok();
    Arc::new(move |event| {
        if let Some(path) = history_path.as_deref() {
            if let Err(e) = store::record_event_at_path(path, &event) {
                log::debug!("pi session history record failed: {e}");
            }
        }
        if let Err(e) = app.emit(PI_SESSION_EVENT_NAME, event) {
            log::debug!("{PI_SESSION_EVENT_NAME} emit failed: {e}");
        }
    })
}

/// Builds a [`native_tools::NativeToolContext`] for artifact and MCP tool execution within Pi sessions.
fn artifact_native_tool_context(
    app: &AppHandle,
    artifacts_state: &ArtifactsState,
    mcp_state: Option<Arc<McpState>>,
) -> PiCommandResult<native_tools::NativeToolContext> {
    let store = artifacts_state
        .store_for_app(app)
        .map_err(|error| PiCommandError::plain(error.message))?;
    let app = app.clone();
    let sink: native_tools::ArtifactUpdateSink = Arc::new(move |artifact, reason| {
        artifacts::emit_artifact_update(&app, artifact, reason);
    });
    Ok(native_tools::NativeToolContext::with_artifacts_and_mcp_state(store, Some(sink), mcp_state))
}

fn emit_session_events(app: &AppHandle, events: &[PiSessionEvent]) {
    for event in events {
        if let Err(e) = app.emit(PI_SESSION_EVENT_NAME, event.clone()) {
            log::debug!("{PI_SESSION_EVENT_NAME} emit failed: {e}");
        }
    }
}

/// Resolves and authorizes the working directory for a Pi session.
fn resolve_session_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace_env: &WorkspaceEnv,
) -> Result<String, String> {
    let Some(resolved) = workspace::authorize_spawn_cwd(registry, cwd, workspace_env)? else {
        return Err("Pi session requires an authorized workspace cwd".to_string());
    };
    Ok(crate::modules::fs::to_canon(&resolved))
}

/// Resolves and authorizes an optional context directory (workspace root or terminal cwd).
fn resolve_context_dir(
    registry: &WorkspaceRegistry,
    value: Option<&str>,
    workspace_env: &WorkspaceEnv,
    label: &str,
) -> Result<Option<String>, String> {
    let Some(raw) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = workspace::authorize_spawn_cwd(registry, Some(raw), workspace_env)
        .map_err(|error| format!("{label} is invalid: {error}"))?;
    Ok(resolved.as_deref().map(crate::modules::fs::to_canon))
}

/// Resolves and authorizes an optional context file path, verifying it is a real file under an authorized root.
fn resolve_context_file(
    registry: &WorkspaceRegistry,
    value: Option<&str>,
    workspace_env: &WorkspaceEnv,
    label: &str,
) -> Result<Option<String>, String> {
    let Some(raw) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = workspace::resolve_path(raw, workspace_env);
    let canonical = std::fs::canonicalize(&resolved)
        .map_err(|error| format!("{label} is not accessible: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("{label} is not a file: {}", canonical.display()));
    }
    if !registry.is_authorized(&canonical) {
        return Err(format!(
            "{label} is outside the authorized workspace: {}",
            canonical.display()
        ));
    }
    Ok(Some(crate::modules::fs::to_canon(&canonical)))
}

/// Resolves all context paths (workspace root, terminal cwd, active file) for a user prompt.
fn resolve_prompt_context(
    registry: &WorkspaceRegistry,
    context: Option<PiPromptContext>,
    workspace_env: &WorkspaceEnv,
) -> Result<Option<PiPromptContext>, String> {
    let Some(context) = context else {
        return Ok(None);
    };
    let resolved = PiPromptContext {
        workspace_root: resolve_context_dir(
            registry,
            context.workspace_root.as_deref(),
            workspace_env,
            "workspace_root",
        )?,
        active_terminal_cwd: resolve_context_dir(
            registry,
            context.active_terminal_cwd.as_deref(),
            workspace_env,
            "active_terminal_cwd",
        )?,
        active_file: resolve_context_file(
            registry,
            context.active_file.as_deref(),
            workspace_env,
            "active_file",
        )?,
        active_terminal_private: context.active_terminal_private,
    };

    if resolved.workspace_root.is_none()
        && resolved.active_terminal_cwd.is_none()
        && resolved.active_file.is_none()
        && !resolved.active_terminal_private
    {
        Ok(None)
    } else {
        Ok(Some(resolved))
    }
}

fn bind_history_path(app: &AppHandle, state: &PiState) {
    if let Ok(path) = store::history_path(app) {
        if let Err(e) = state.set_history_path(Some(path)) {
            log::debug!("bind history path failed: {e}");
        }
    }
}

#[tauri::command]
pub fn pi_local_agents_status(workspace: Option<WorkspaceEnv>) -> PiLocalAgentsStatus {
    local_agents::status(workspace)
}

#[tauri::command]
pub fn pi_status(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.snapshot()
}

#[tauri::command]
pub fn pi_start(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.start_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub fn pi_stop(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    if let Err(e) = store::mark_unfinished_sessions_stopped(&app) {
        log::debug!("mark unfinished sessions stopped failed: {e}");
    }
    state.stop()
}

#[tauri::command]
pub fn pi_host_info(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> PiCommandResult<PiHostInfo> {
    bind_history_path(&app, &state);
    state.info_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub fn pi_diagnostics(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> PiCommandResult<PiDiagnostics> {
    bind_history_path(&app, &state);
    state.diagnostics_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub fn pi_models_list(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> PiCommandResult<PiProfileModelsList> {
    bind_history_path(&app, &state);
    state.models_list_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        default_pi_agent_dir()?,
    )
}

#[tauri::command]
pub fn pi_sessions_history(app: AppHandle) -> PiCommandResult<PiSessionsList> {
    Ok(store::load(&app)?)
}

#[tauri::command]
pub fn pi_sessions_list(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> PiCommandResult<PiSessionsList> {
    bind_history_path(&app, &state);
    state.sessions_list_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAgentPolicyRequest {
    pub approved: bool,
    pub document_id: String,
    pub node_id: String,
    pub tool_name: String,
}

impl WorkflowAgentPolicyRequest {
    fn tool_name(&self) -> Result<&'static str, String> {
        match self.tool_name.as_str() {
            "workflow.agent_prompt" => Ok("workflow.agent_prompt"),
            "workflow.browser_automation" => Ok("workflow.browser_automation"),
            other => Err(format!("unsupported workflow agent capability: {other}")),
        }
    }

    fn policy_context(&self) -> WorkflowPolicyContext {
        WorkflowPolicyContext {
            approved: self.approved,
            document_id: self.document_id.clone(),
            node_id: self.node_id.clone(),
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session create arguments"
)]
#[tauri::command]
pub fn workflow_pi_session_create(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    secrets_state: tauri::State<'_, SecretsState>,
    mcp_state: tauri::State<'_, Arc<McpState>>,
    workflow_state: tauri::State<'_, WorkflowCapabilityState>,
    title: Option<String>,
    cwd: Option<String>,
    provider_config: Option<PiProviderConfig>,
    workspace: Option<WorkspaceEnv>,
    policy: WorkflowAgentPolicyRequest,
) -> Result<PiSessionCreateResult, String> {
    let tool_name = policy.tool_name()?;
    let context = policy.policy_context();
    workflow_state.execute_workflow_capability(&context, tool_name, || {
        pi_session_create(
            app,
            state,
            artifacts_state,
            registry,
            secrets_state,
            mcp_state,
            title,
            cwd,
            provider_config,
            workspace,
        )
        .map_err(|error| error.message)
    })
}

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session create arguments"
)]
#[tauri::command]
pub fn pi_session_create(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    secrets_state: tauri::State<'_, SecretsState>,
    mcp_state: tauri::State<'_, Arc<McpState>>,
    title: Option<String>,
    cwd: Option<String>,
    provider_config: Option<PiProviderConfig>,
    workspace: Option<WorkspaceEnv>,
) -> PiCommandResult<PiSessionCreateResult> {
    bind_history_path(&app, &state);
    let workspace_env = WorkspaceEnv::from_option(workspace);
    let cwd = resolve_session_cwd(&registry, cwd.as_deref(), &workspace_env)?;
    let provider_config = resolve_provider_config(&app, &secrets_state, provider_config)?;
    let session_dir = sdk_session_dir(&app)?;
    let session_dir_text = crate::modules::fs::to_canon(&session_dir);
    let native_tool_context = artifact_native_tool_context(
        &app,
        artifacts_state.inner(),
        Some(Arc::clone(mcp_state.inner())),
    )?;
    let context = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
    .with_native_tool_context(native_tool_context);
    let mut result = state.session_create(
        context,
        CreateSessionRequest {
            title,
            cwd: Some(cwd),
            provider_config,
            session_dir: Some(session_dir_text),
            workspace_env,
        },
    )?;
    validate_session_sdk_file(&mut result.session, &session_dir)?;
    store::record_session_result(&app, &result.session, &result.events)?;
    emit_session_events(&app, &result.events);
    Ok(result)
}

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session resume arguments"
)]
#[tauri::command]
pub fn pi_session_resume(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    secrets_state: tauri::State<'_, SecretsState>,
    mcp_state: tauri::State<'_, Arc<McpState>>,
    session_id: String,
    provider_config: Option<PiProviderConfig>,
    workspace: Option<WorkspaceEnv>,
) -> PiCommandResult<PiSessionResumeResult> {
    bind_history_path(&app, &state);
    let history = store::load(&app)?;
    let session = history
        .sessions
        .iter()
        .find(|session| session.id == session_id)
        .cloned()
        .ok_or_else(|| PiCommandError::plain("Pi session history entry was not found"))?;
    let sdk_session_file = session
        .sdk_session_file
        .clone()
        .ok_or_else(|| PiCommandError::plain("Pi session has no SDK session file to resume"))?;
    let workspace_env = session
        .workspace_env
        .clone()
        .unwrap_or_else(|| WorkspaceEnv::from_option(workspace));
    let cwd = resolve_session_cwd(&registry, session.cwd.as_deref(), &workspace_env)?;
    let provider_config = resolve_provider_config(&app, &secrets_state, provider_config)?;
    let session_dir = sdk_session_dir(&app)?;
    let session_dir_text = crate::modules::fs::to_canon(&session_dir);
    let sdk_session_file =
        validate_existing_sdk_session_file_path(&sdk_session_file, &session_dir)?;
    let native_tool_context = artifact_native_tool_context(
        &app,
        artifacts_state.inner(),
        Some(Arc::clone(mcp_state.inner())),
    )?;
    let context = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
    .with_native_tool_context(native_tool_context);
    let mut result = state.session_resume(
        context,
        ResumeSessionRequest {
            session_id: session.id,
            title: session.title,
            cwd,
            sdk_session_file,
            session_dir: Some(session_dir_text),
            provider_config,
            created_at: Some(session.created_at),
            last_prompt: session.last_prompt,
            thinking_level: session.thinking_level,
            workspace_env,
        },
    )?;
    validate_session_sdk_file(&mut result.session, &session_dir)?;
    store::record_session_result(&app, &result.session, &result.events)?;
    emit_session_events(&app, &result.events);
    Ok(result)
}

#[expect(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session send arguments"
)]
#[tauri::command]
pub fn pi_session_send(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    mcp_state: tauri::State<'_, Arc<McpState>>,
    session_id: String,
    prompt: String,
    context: Option<PiPromptContext>,
    regenerate_branch_group_id: Option<String>,
    thinking_level: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> PiCommandResult<PiSessionSendResult> {
    bind_history_path(&app, &state);
    let workspace_env = WorkspaceEnv::from_option(workspace);
    let context = resolve_prompt_context(&registry, context, &workspace_env)?;
    let native_tool_context =
        artifact_native_tool_context(&app, &artifacts_state, Some(Arc::clone(mcp_state.inner())))?;
    let context_handle = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
    .with_native_tool_context(native_tool_context);
    let result = state.session_send(
        context_handle,
        SendPromptRequest {
            session_id,
            prompt,
            context,
            regenerate_branch_group_id,
            thinking_level,
        },
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    emit_session_events(&app, &result.events);
    Ok(result)
}

#[tauri::command]
pub fn pi_session_tool_respond(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    mcp_state: tauri::State<'_, Arc<McpState>>,
    session_id: String,
    tool_call_id: String,
    approved: bool,
) -> PiCommandResult<PiSessionToolRespondResult> {
    bind_history_path(&app, &state);
    let native_tool_context =
        artifact_native_tool_context(&app, &artifacts_state, Some(Arc::clone(mcp_state.inner())))?;
    let context = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
    .with_native_tool_context(native_tool_context);
    let result = state.session_tool_respond(
        context,
        ToolRespondRequest {
            session_id,
            tool_call_id,
            approved,
        },
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    emit_session_events(&app, &result.events);
    Ok(result)
}

#[tauri::command]
pub fn pi_session_rename(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
    title: String,
) -> PiCommandResult<PiSessionRenameResult> {
    bind_history_path(&app, &state);
    let context = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    );
    let result = state.session_rename(context, RenameSessionRequest { session_id, title })?;
    store::record_session_result(&app, &result.session, &result.events)?;
    emit_session_events(&app, &result.events);
    Ok(result)
}

fn is_pi_session_not_found_error(error: &PiCommandError) -> bool {
    error.code.as_deref() == Some("PI_SESSION_NOT_FOUND")
}

fn delete_pi_session_core(
    app: &AppHandle,
    state: &PiState,
    session_id: String,
) -> PiCommandResult<PiSessionDeleteResult> {
    bind_history_path(app, state);
    let context = PiHostContext::new(resource_dir(app).as_deref(), Some(session_event_sink(app)));
    let result = match state.session_delete(
        context,
        DeleteSessionRequest {
            session_id: session_id.clone(),
        },
    ) {
        Ok(result) => result,
        Err(error) if is_pi_session_not_found_error(&error) => {
            let history = store::load(app)?;
            if !history
                .sessions
                .iter()
                .any(|session| session.id == session_id)
            {
                return Err(error);
            }
            PiSessionDeleteResult {
                events: vec![store::deleted_event(session_id)],
            }
        }
        Err(error) => return Err(error),
    };
    store::record_session_events(app, &result.events)?;
    emit_session_events(app, &result.events);
    Ok(result)
}

#[tauri::command]
pub fn pi_session_delete(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> PiCommandResult<PiSessionDeleteResult> {
    delete_pi_session_core(&app, state.inner(), session_id)
}

#[tauri::command]
pub fn pi_session_delete_with_artifacts(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    artifacts_state: tauri::State<'_, ArtifactsState>,
    session_id: String,
) -> PiCommandResult<PiSessionDeleteWithArtifactsResult> {
    let session_delete = delete_pi_session_core(&app, state.inner(), session_id.clone())?;
    let (artifact_delete, artifact_cleanup_error) = match artifacts_state.store_for_app(&app) {
        Ok(store) => match store.delete_conversation(&session_id) {
            Ok(result) => {
                artifacts::emit_artifact_conversation_delete(
                    &app,
                    session_id,
                    result.deleted_count,
                );
                (
                    Some(PiArtifactDeleteResult {
                        deleted: result.deleted,
                        deleted_count: result.deleted_count,
                    }),
                    None,
                )
            }
            Err(error) => (None, Some(error.message)),
        },
        Err(error) => (None, Some(error.message)),
    };

    Ok(PiSessionDeleteWithArtifactsResult {
        session_delete,
        artifact_delete,
        artifact_cleanup_error,
    })
}

#[tauri::command]
pub fn pi_session_stop(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> PiCommandResult<PiSessionStopResult> {
    bind_history_path(&app, &state);
    let result = state.session_stop_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        session_id,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    emit_session_events(&app, &result.events);
    Ok(result)
}

// ─── Archive / Restore ───

fn now_iso_timestamp() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    epoch_millis_to_iso_utc(millis)
}

fn epoch_millis_to_iso_utc(epoch_millis: u128) -> String {
    let total_seconds = (epoch_millis / 1_000) as i64;
    let milliseconds = epoch_millis % 1_000;
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds:03}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let days = days_since_unix_epoch + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn event_id_component(value: &str) -> String {
    let component: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    if component.is_empty() { "session".to_string() } else { component }
}

fn append_events_dedup(
    history_events: &mut Vec<PiSessionEvent>,
    events: &[PiSessionEvent],
) {
    use std::collections::HashSet;
    let mut known_ids: HashSet<String> = history_events.iter().map(|e| e.id.clone()).collect();
    for event in events {
        if known_ids.insert(event.id.clone()) {
            history_events.insert(0, event.clone());
        }
    }
    history_events.truncate(500);
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionArchiveResult {
    pub session: PiSession,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionRestoreResult {
    pub session: PiSession,
}

#[tauri::command]
pub fn pi_session_archive(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> PiCommandResult<PiSessionArchiveResult> {
    bind_history_path(&app, &state);
    let _guard = store::history_lock()?;
    let path = store::history_path(&app)?;
    let mut history = store::load_from_path(&path)?;
    let session = history
        .sessions
        .iter_mut()
        .find(|s| s.id == session_id)
        .ok_or_else(|| PiCommandError::plain("Pi session not found"))?;
    if session.archived_at.is_some() {
        return Err(PiCommandError::plain("Pi session is already archived"));
    }
    if session.status == "running" {
        return Err(PiCommandError::plain("Cannot archive a running session"));
    }
    let now = now_iso_timestamp();
    session.archived_at = Some(now.clone());
    session.updated_at = now.clone();
    let event = PiSessionEvent {
        id: format!("evt_{}_archive_{}", event_id_component(&now), event_id_component(&session_id)),
        event_type: session_event_type::ARCHIVED.to_string(),
        session_id: session_id.clone(),
        created_at: now,
        payload: serde_json::json!({ "sessionId": session_id }),
    };
    let archived_session = session.clone();
    append_events_dedup(&mut history.events, std::slice::from_ref(&event));
    store::save_to_path(&path, &history)?;
    drop(_guard);
    emit_session_events(&app, &[event]);
    Ok(PiSessionArchiveResult { session: archived_session })
}

#[tauri::command]
pub fn pi_session_restore(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> PiCommandResult<PiSessionRestoreResult> {
    bind_history_path(&app, &state);
    let _guard = store::history_lock()?;
    let path = store::history_path(&app)?;
    let mut history = store::load_from_path(&path)?;
    let session = history
        .sessions
        .iter_mut()
        .find(|s| s.id == session_id)
        .ok_or_else(|| PiCommandError::plain("Pi session not found"))?;
    if session.archived_at.is_none() {
        return Err(PiCommandError::plain("Pi session is not archived"));
    }
    let now = now_iso_timestamp();
    session.archived_at = None;
    session.updated_at = now.clone();
    let event = PiSessionEvent {
        id: format!("evt_{}_restore_{}", event_id_component(&now), event_id_component(&session_id)),
        event_type: session_event_type::RESTORED.to_string(),
        session_id: session_id.clone(),
        created_at: now,
        payload: serde_json::json!({ "sessionId": session_id }),
    };
    let restored_session = session.clone();
    append_events_dedup(&mut history.events, std::slice::from_ref(&event));
    store::save_to_path(&path, &history)?;
    drop(_guard);
    emit_session_events(&app, &[event]);
    Ok(PiSessionRestoreResult { session: restored_session })
}

// ─── Fork from turn ───

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionForkResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[tauri::command]
pub fn pi_session_fork(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    parent_session_id: String,
    fork_event_id: Option<String>,
    title: Option<String>,
) -> PiCommandResult<PiSessionForkResult> {
    bind_history_path(&app, &state);
    let _guard = store::history_lock()?;
    let history = store::load_from_path(&store::history_path(&app)?)?;

    // Find the parent session
    let parent = history
        .sessions
        .iter()
        .find(|s| s.id == parent_session_id)
        .ok_or_else(|| PiCommandError::plain("Parent Pi session not found"))?;

    let fork_id = format!("fork_{}", uuid_short());
    let now = now_iso_timestamp();

    // Collect events from the parent up to the fork point.
    // Events are stored newest-first (index 0 = most recent).
    // We want events older than or equal to fork_event_id.
    let parent_events: Vec<PiSessionEvent> = if let Some(fork_eid) = &fork_event_id {
        let session_events: Vec<&PiSessionEvent> = history
            .events
            .iter()
            .filter(|e| e.session_id == parent_session_id)
            .collect();

        // Find the position of fork_eid in the session's events
        let fork_idx = session_events
            .iter()
            .position(|e| e.id == *fork_eid)
            .ok_or_else(|| PiCommandError::plain(
                "Fork event not found in session history (may have been truncated)",
            ))?;

        // Take from fork_idx onwards (older events in newest-first order)
        session_events
            .iter()
            .skip(fork_idx)
            .cloned()
            .cloned()
            .collect()
    } else {
        history
            .events
            .iter()
            .filter(|e| e.session_id == parent_session_id)
            .cloned()
            .collect()
    };

    // Rewrite session IDs and generate new IDs to avoid dedup collisions
    let forked_events: Vec<PiSessionEvent> = parent_events
        .into_iter()
        .map(|mut e| {
            let old_id = e.id.clone();
            e.id = format!("{}_{}", old_id, fork_id);
            e.session_id = fork_id.clone();
            e
        })
        .collect();

    // Create the new forked session
    let session = PiSession {
        id: fork_id.clone(),
        title: title.unwrap_or_else(|| format!("{} (fork)", parent.title)),
        cwd: parent.cwd.clone(),
        status: "idle".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
        last_prompt: None,
        workspace_env: parent.workspace_env.clone(),
        thinking_level: parent.thinking_level.clone(),
        sdk_session_file: None,
        archived_at: None,
        forked_from: Some(PiSessionForkRef {
            parent_session_id: parent_session_id.clone(),
            fork_event_id: fork_event_id.clone(),
        }),
    };

    // Create forked event
    let fork_event = PiSessionEvent {
        id: format!("evt_{}_fork_{}", event_id_component(&now), event_id_component(&fork_id)),
        event_type: session_event_type::FORKED.to_string(),
        session_id: fork_id,
        created_at: now,
        payload: serde_json::json!({
            "parentSessionId": parent_session_id,
            "forkEventId": fork_event_id,
            "session": session,
        }),
    };

    // Persist the new session and its fork event + copied parent events
    let mut all_events = forked_events;
    all_events.push(fork_event.clone());
    store::record_session_result(&app, &session, &all_events)?;
    drop(_guard);
    emit_session_events(&app, std::slice::from_ref(&fork_event));

    Ok(PiSessionForkResult {
        session,
        events: vec![fork_event],
    })
}

// ─── Rollback to checkpoint ───

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionRollbackResult {
    pub session: PiSession,
    pub removed_event_count: usize,
}

#[tauri::command]
pub fn pi_session_rollback(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
    rollback_event_id: String,
) -> PiCommandResult<PiSessionRollbackResult> {
    bind_history_path(&app, &state);
    let _guard = store::history_lock()?;
    let path = store::history_path(&app)?;
    let mut history = store::load_from_path(&path)?;

    // Validate session exists and is idle/stopped
    {
        let session = history
            .sessions
            .iter()
            .find(|s| s.id == session_id)
            .ok_or_else(|| PiCommandError::plain("Pi session not found"))?;

        if session.status != "idle" && session.status != "stopped" {
            return Err(PiCommandError::plain(
                "Can only rollback idle or stopped sessions",
            ));
        }
    }

    // Verify the rollback event exists
    let has_event = history
        .events
        .iter()
        .any(|e| e.session_id == session_id && e.id == rollback_event_id);
    if !has_event {
        return Err(PiCommandError::plain(
            "Rollback event not found in session",
        ));
    }

    // Collect event IDs to remove.
    // Events are stored newest-first. Events newer than the rollback point
    // come BEFORE it in the array. We want to remove those.
    let session_event_ids: Vec<String> = history
        .events
        .iter()
        .filter(|e| e.session_id == session_id)
        .map(|e| e.id.clone())
        .collect();

    // Find the rollback point index in the session's event sequence
    let rollback_idx = session_event_ids
        .iter()
        .position(|id| *id == rollback_event_id)
        .unwrap_or(session_event_ids.len());

    // Events to remove: those newer than the rollback point (indices 0..rollback_idx exclusive)
    let ids_to_remove: std::collections::HashSet<String> = session_event_ids
        .iter()
        .take(rollback_idx)
        .cloned()
        .collect();

    let removed_count = ids_to_remove.len();

    // Remove the events
    history.events.retain(|e| {
        !(e.session_id == session_id && ids_to_remove.contains(&e.id))
    });

    // Update session timestamp
    let now = now_iso_timestamp();
    if let Some(session) = history.sessions.iter_mut().find(|s| s.id == session_id) {
        session.updated_at = now.clone();
    }

    // Save
    store::save_to_path(&path, &history)?;

    // Emit rollback event so the frontend can update live state
    let rollback_event = PiSessionEvent {
        id: format!("evt_{}_rollback", event_id_component(&now)),
        event_type: session_event_type::ROLLBACK.to_string(),
        session_id: session_id.clone(),
        created_at: now,
        payload: serde_json::json!({
            "sessionId": session_id,
            "rollbackEventId": rollback_event_id,
            "removedEventCount": removed_count,
        }),
    };
    drop(_guard);
    emit_session_events(&app, &[rollback_event]);

    let session = history
        .sessions
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or_else(|| PiCommandError::plain("Pi session not found after rollback"))?;

    Ok(PiSessionRollbackResult {
        session,
        removed_event_count: removed_count,
    })
}

// ─── Usage telemetry ───

#[tauri::command]
pub fn pi_usage_summary(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: Option<String>,
) -> PiCommandResult<PiUsageSummary> {
    bind_history_path(&app, &state);
    let history = store::load(&app)?;

    let mut summary = PiUsageSummary::default();
    let mut model_map: std::collections::HashMap<String, PiUsageModelBreakdown> =
        std::collections::HashMap::new();

    for event in &history.events {
        // Filter by session_id if specified
        if let Some(ref sid) = session_id {
            if event.session_id != *sid {
                continue;
            }
        }

        if event.event_type != session_event_type::USAGE {
            continue;
        }

        let record: PiUsageRecord = match serde_json::from_value(event.payload.clone()) {
            Ok(r) => r,
            Err(_) => continue,
        };

        summary.total_input_tokens += record.input_tokens;
        summary.total_output_tokens += record.output_tokens;
        summary.total_cached_input_tokens += record.cached_input_tokens.unwrap_or(0);
        let cost = record.cost_usd.unwrap_or(0.0);
        if !cost.is_nan() {
            summary.total_cost_usd += cost.max(0.0);
        }
        summary.turn_count += 1;

        // Per-model breakdown
        if let Some(ref model_id) = record.model_id {
            let key = model_id.clone();
            let entry = model_map.entry(key).or_insert_with(|| PiUsageModelBreakdown {
                model_id: model_id.clone(),
                provider_id: record.provider_id.clone(),
                ..Default::default()
            });
            entry.input_tokens += record.input_tokens;
            entry.output_tokens += record.output_tokens;
            entry.cached_input_tokens += record.cached_input_tokens.unwrap_or(0);
            if !cost.is_nan() {
                entry.cost_usd += cost.max(0.0);
            }
            entry.turn_count += 1;
        }
    }

    if !model_map.is_empty() {
        let mut models: Vec<PiUsageModelBreakdown> = model_map.into_values().collect();
        models.sort_by(|a, b| b.cost_usd.partial_cmp(&a.cost_usd).unwrap_or(std::cmp::Ordering::Equal));
        summary.by_model = Some(models);
    }

    Ok(summary)
}

fn uuid_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t % 0xFFFF_FFFF_FFFF)
}

#[cfg(test)]
mod tests;

// ─── Webview agent persistence commands ───
// These commands allow the webview-backed Pi agent to persist sessions
// and events through the same store used by the sidecar path.

#[tauri::command]
pub fn pi_store_record_session(
    app: AppHandle,
    session: PiSession,
    events: Vec<PiSessionEvent>,
) -> Result<(), String> {
    store::record_session_result(&app, &session, &events)?;
    emit_session_events(&app, &events);
    Ok(())
}

#[tauri::command]
pub fn pi_store_record_events(
    app: AppHandle,
    events: Vec<PiSessionEvent>,
) -> Result<(), String> {
    store::record_session_events(&app, &events)?;
    emit_session_events(&app, &events);
    Ok(())
}

#[tauri::command]
pub fn pi_store_record_transcript(
    app: AppHandle,
    session_id: String,
    transcript: String,
) -> Result<(), String> {
    store::record_transcript(&app, &session_id, &transcript)
}

#[tauri::command]
pub fn pi_store_load_transcript(
    app: AppHandle,
    session_id: String,
) -> Result<Option<String>, String> {
    store::load_transcript(&app, &session_id)
}

#[tauri::command]
pub fn pi_store_delete_transcript(app: AppHandle, session_id: String) -> Result<(), String> {
    store::delete_transcript(&app, &session_id)
}
