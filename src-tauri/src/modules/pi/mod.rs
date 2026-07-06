//! Pi AI session lifecycle: host process spawning, JSON-RPC protocol, session create/send/resume/delete, native tool execution, and history persistence.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::modules::artifacts::{self, ArtifactsState};
use crate::modules::mcp::McpState;
use crate::modules::workspace::WorkspaceEnv;

mod agent_tools;
mod local_agents;
mod native_tools;
mod profile_models;
pub mod skills;
mod store;

pub use agent_tools::*;

mod types;
use types::PiCommandResult;
pub use types::*;

mod state;
pub use state::PiState;

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

const PI_ENV_API_KEY_NAMES: &[&str] = &[
    "AI21_API_KEY",
    "AI_GATEWAY_API_KEY",
    "ANTHROPIC_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AZURE_OPENAI_API_KEY",
    "CEREBRAS_API_KEY",
    "CLOUDFLARE_API_KEY",
    "CO_API_KEY",
    "COPILOT_GITHUB_TOKEN",
    "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_CLOUD_API_KEY",
    "GROQ_API_KEY",
    "HF_TOKEN",
    "KIMI_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_CN_API_KEY",
    "MISTRAL_API_KEY",
    "MOONSHOT_API_KEY",
    "OPENAI_API_KEY",
    "OPENCODE_API_KEY",
    "OPENROUTER_API_KEY",
    "PERPLEXITY_API_KEY",
    "TOGETHER_API_KEY",
    "XAI_API_KEY",
    "XIAOMI_API_KEY",
    "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
    "XIAOMI_TOKEN_PLAN_CN_API_KEY",
    "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
    "ZAI_API_KEY",
];

#[tauri::command]
pub fn pi_env_api_key(name: String) -> PiCommandResult<Option<String>> {
    if !PI_ENV_API_KEY_NAMES.contains(&name.as_str()) {
        return Err(PiCommandError::plain(
            "unsupported Pi API key environment name",
        ));
    }
    Ok(std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

#[tauri::command]
pub fn pi_models_list() -> PiCommandResult<PiProfileModelsList> {
    Ok(profile_models::list_from_dir(
        &profile_models::default_profile_agent_dir(),
    ))
}

#[tauri::command]
pub fn pi_skills_status(
    workspace_root: Option<String>,
    workspace: Option<WorkspaceEnv>,
    include_profile: Option<bool>,
) -> PiCommandResult<skills::PiSkillsStatus> {
    let mut roots = Vec::new();
    let workspace = WorkspaceEnv::from_option(workspace);

    if let Some(workspace_root) = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
    {
        let root = crate::modules::workspace::resolve_path(workspace_root, &workspace);
        roots.push(skills::SkillRoot {
            path: root.join(".pi").join("skills"),
            scope: skills::PiSkillScope::Project,
        });
        roots.push(skills::SkillRoot {
            path: root.join(".agents").join("skills"),
            scope: skills::PiSkillScope::Project,
        });
    }

    if include_profile.unwrap_or(true) {
        if let Some(home) = dirs::home_dir() {
            roots.push(skills::SkillRoot {
                path: home.join(".pi").join("agent").join("skills"),
                scope: skills::PiSkillScope::User,
            });
            roots.push(skills::SkillRoot {
                path: home.join(".agents").join("skills"),
                scope: skills::PiSkillScope::User,
            });
        }
    }

    Ok(skills::status(roots))
}

#[tauri::command]
pub fn pi_status(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.snapshot()
}

// The Pi agent runs in the webview; there is no external runtime to start or
// stop. These remain as no-ops returning the ready snapshot so existing runtime
// controls degrade gracefully.
#[tauri::command]
pub fn pi_start(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.snapshot()
}

#[tauri::command]
pub fn pi_stop(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.mark_unfinished_sessions_stopped();
    state.snapshot()
}

/// Host-free diagnostics describing the in-process webview agent. Capability
/// audits are loaded separately by the panel; this reports the runtime shape.
#[tauri::command]
pub fn pi_diagnostics() -> PiCommandResult<PiDiagnostics> {
    Ok(webview_diagnostics())
}

fn webview_diagnostics() -> PiDiagnostics {
    PiDiagnostics {
        host_version: "webview".to_string(),
        pi_sdk_loaded: true,
        pi_packages: vec![],
        node: PiNodeDiagnostics {
            version: "webview".to_string(),
            exec_path: String::new(),
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            pid: std::process::id(),
            cwd: String::new(),
        },
        config: PiConfigDiagnostics {
            tool_mode: "rust-mediated".to_string(),
            enabled_tools: vec![],
            approval_required_tools: vec![],
            session_storage: "store".to_string(),
            api_keys: vec![],
            forwarded_env_names: vec![],
        },
        capabilities: PiCapabilityDiagnostics::default(),
        protocol: PiProtocolDiagnostics::default(),
        limits: PiLimitDiagnostics::default(),
        manager: PiManagerDiagnostics::default(),
        capability_audit: vec![],
        sessions: vec![],
    }
}

#[tauri::command]
pub fn pi_sessions_history(app: AppHandle) -> PiCommandResult<PiSessionsList> {
    Ok(store::load(&app)?)
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
    if component.is_empty() {
        "session".to_string()
    } else {
        component
    }
}

fn append_events_dedup(history_events: &mut Vec<PiSessionEvent>, events: &[PiSessionEvent]) {
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
        id: format!(
            "evt_{}_archive_{}",
            event_id_component(&now),
            event_id_component(&session_id)
        ),
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
    Ok(PiSessionArchiveResult {
        session: archived_session,
    })
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
        id: format!(
            "evt_{}_restore_{}",
            event_id_component(&now),
            event_id_component(&session_id)
        ),
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
    Ok(PiSessionRestoreResult {
        session: restored_session,
    })
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
            .ok_or_else(|| {
                PiCommandError::plain(
                    "Fork event not found in session history (may have been truncated)",
                )
            })?;

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
        auth_mode: parent.auth_mode.clone(),
        provider_id: parent.provider_id.clone(),
        model_id: parent.model_id.clone(),
        source_model_id: parent.source_model_id.clone(),
        base_url: parent.base_url.clone(),
        custom_endpoint_id: parent.custom_endpoint_id.clone(),
        sdk_session_file: None,
        archived_at: None,
        forked_from: Some(PiSessionForkRef {
            parent_session_id: parent_session_id.clone(),
            fork_event_id: fork_event_id.clone(),
        }),
    };

    // Create forked event
    let fork_event = PiSessionEvent {
        id: format!(
            "evt_{}_fork_{}",
            event_id_component(&now),
            event_id_component(&fork_id)
        ),
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
        return Err(PiCommandError::plain("Rollback event not found in session"));
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
    history
        .events
        .retain(|e| !(e.session_id == session_id && ids_to_remove.contains(&e.id)));

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
            let entry = model_map
                .entry(key)
                .or_insert_with(|| PiUsageModelBreakdown {
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
        models.sort_by(|a, b| {
            b.cost_usd
                .partial_cmp(&a.cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
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
pub fn pi_store_record_events(app: AppHandle, events: Vec<PiSessionEvent>) -> Result<(), String> {
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
