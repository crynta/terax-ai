use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::modules::artifacts::{self, ArtifactsState};
use crate::modules::capabilities::{WorkflowCapabilityState, WorkflowPolicyContext};
use crate::modules::mcp::McpState;
use crate::modules::secrets::SecretsState;
use crate::modules::workspace::{self, WorkspaceEnv, WorkspaceRegistry};

mod host;
mod local_agents;
mod native_tools;
mod provider_config;
mod store;

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

fn session_event_sink(app: &AppHandle) -> PiSessionEventSink {
    let app = app.clone();
    let history_path = store::history_path(&app).ok();
    Arc::new(move |event| {
        if let Some(path) = history_path.as_deref() {
            let _ = store::record_event_at_path(path, &event);
        }
        let _ = app.emit(PI_SESSION_EVENT_NAME, event);
    })
}

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
        let _ = app.emit(PI_SESSION_EVENT_NAME, event.clone());
    }
}

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
        let _ = state.set_history_path(Some(path));
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
    let _ = store::mark_unfinished_sessions_stopped(&app);
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

#[allow(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session create arguments"
)]
#[tauri::command]
pub fn workflow_pi_session_create(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
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

#[allow(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session create arguments"
)]
#[tauri::command]
pub fn pi_session_create(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
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
    let context = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
    .with_native_tool_context(native_tools::NativeToolContext::with_mcp_state(Arc::clone(
        mcp_state.inner(),
    )));
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

#[allow(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session resume arguments"
)]
#[tauri::command]
pub fn pi_session_resume(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
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
    let workspace_env = WorkspaceEnv::from_option(workspace);
    let cwd = resolve_session_cwd(&registry, session.cwd.as_deref(), &workspace_env)?;
    let provider_config = resolve_provider_config(&app, &secrets_state, provider_config)?;
    let session_dir = sdk_session_dir(&app)?;
    let session_dir_text = crate::modules::fs::to_canon(&session_dir);
    let sdk_session_file =
        validate_existing_sdk_session_file_path(&sdk_session_file, &session_dir)?;
    let context = PiHostContext::new(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
    .with_native_tool_context(native_tools::NativeToolContext::with_mcp_state(Arc::clone(
        mcp_state.inner(),
    )));
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

#[allow(
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

#[cfg(test)]
mod tests;
