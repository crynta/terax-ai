pub mod edits;
pub mod react;
pub mod store;
pub mod types;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub use edits::{apply_exact_edits, ArtifactTextEdit};
pub use react::{compile_react_artifact, ReactCompileInput, ReactCompileResult};
pub use store::{
    Artifact, ArtifactCreateInput, ArtifactDeleteResult, ArtifactExportResult, ArtifactStore,
    ArtifactSummary, ArtifactVersionSummary,
};
pub use types::{
    conversation_key, normalize_slug, validate_conversation_id, ArtifactError, ArtifactKind,
    ArtifactResult,
};

use crate::modules::pi::{pi_sessions_history, PiSessionsList};

pub const ARTIFACT_UPDATE_EVENT_NAME: &str = "artifact:update";
pub const ARTIFACT_DELETE_EVENT_NAME: &str = "artifact:delete";
pub const ARTIFACT_CONVERSATION_DELETE_EVENT_NAME: &str = "artifact:conversation-delete";
pub const MODEL_COMPARE_ARTIFACT_CONVERSATION_ID: &str = "model-compare";

const APP_ARTIFACT_CONVERSATION_IDS: &[&str] = &[MODEL_COMPARE_ARTIFACT_CONVERSATION_ID];

#[derive(Default)]
pub struct ArtifactsState {
    stores: Mutex<HashMap<PathBuf, ArtifactStore>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactUpdateReason {
    Create,
    Update,
    Edit,
    Save,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactUpdateEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub conversation_id: String,
    pub artifact: ArtifactSummary,
    pub reason: ArtifactUpdateReason,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDeleteEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub conversation_id: String,
    pub slug: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactConversationDeleteEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub conversation_id: String,
    pub deleted_count: usize,
}

impl ArtifactsState {
    pub fn store_for_app(&self, app: &AppHandle) -> ArtifactResult<ArtifactStore> {
        let root = artifacts_root(app)?;
        let mut stores = self
            .stores
            .lock()
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
        Ok(stores
            .entry(root.clone())
            .or_insert_with(|| ArtifactStore::new(root))
            .clone())
    }
}

#[tauri::command]
pub fn artifacts_list(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
) -> ArtifactResult<Vec<ArtifactSummary>> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    state.store_for_app(&app)?.list(&conversation_id)
}

#[tauri::command]
pub fn artifacts_get(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    slug: String,
    version: Option<u32>,
) -> ArtifactResult<Artifact> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    state
        .store_for_app(&app)?
        .get(&conversation_id, &slug, version)
}

#[tauri::command]
pub fn artifacts_compile_react(input: ReactCompileInput) -> ArtifactResult<ReactCompileResult> {
    compile_react_artifact(input)
}

#[tauri::command]
pub fn artifacts_create(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    input: ArtifactCreateInput,
) -> ArtifactResult<Artifact> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    let artifact = state.store_for_app(&app)?.create(&conversation_id, input)?;
    emit_artifact_update(&app, artifact.summary.clone(), ArtifactUpdateReason::Create);
    Ok(artifact)
}

#[tauri::command]
pub fn artifacts_update(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    slug: String,
    content: String,
    base_version: Option<u32>,
) -> ArtifactResult<Artifact> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    let artifact =
        state
            .store_for_app(&app)?
            .update(&conversation_id, &slug, &content, base_version)?;
    emit_artifact_update(&app, artifact.summary.clone(), ArtifactUpdateReason::Save);
    Ok(artifact)
}

#[tauri::command]
pub fn artifacts_edit(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    slug: String,
    edits: Vec<ArtifactTextEdit>,
    base_version: Option<u32>,
) -> ArtifactResult<Artifact> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    let artifact =
        state
            .store_for_app(&app)?
            .edit(&conversation_id, &slug, &edits, base_version)?;
    emit_artifact_update(&app, artifact.summary.clone(), ArtifactUpdateReason::Edit);
    Ok(artifact)
}

#[tauri::command]
pub fn artifacts_versions(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    slug: String,
) -> ArtifactResult<Vec<ArtifactVersionSummary>> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    state.store_for_app(&app)?.versions(&conversation_id, &slug)
}

#[tauri::command]
pub fn artifacts_export(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    slug: String,
    destination_path: String,
    version: Option<u32>,
) -> ArtifactResult<ArtifactExportResult> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    let destination = PathBuf::from(destination_path);
    state
        .store_for_app(&app)?
        .export_to(&conversation_id, &slug, version, &destination)
}

#[tauri::command]
pub fn artifacts_delete(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
    slug: String,
) -> ArtifactResult<ArtifactDeleteResult> {
    let conversation_id = ensure_conversation_exists(&app, &conversation_id)?;
    let slug = normalize_slug(&slug)?;
    let result = state.store_for_app(&app)?.delete(&conversation_id, &slug)?;
    emit_artifact_delete(&app, conversation_id, slug);
    Ok(result)
}

#[tauri::command]
pub fn artifacts_delete_for_conversation(
    app: AppHandle,
    state: State<'_, ArtifactsState>,
    conversation_id: String,
) -> ArtifactResult<ArtifactDeleteResult> {
    let conversation_id = validate_conversation_id(&conversation_id)?;
    let result = state
        .store_for_app(&app)?
        .delete_conversation(&conversation_id)?;
    emit_artifact_conversation_delete(&app, conversation_id, result.deleted_count);
    Ok(result)
}

fn artifacts_root(app: &AppHandle) -> ArtifactResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?
        .join("artifacts"))
}

fn ensure_conversation_exists(app: &AppHandle, conversation_id: &str) -> ArtifactResult<String> {
    let conversation_id = validate_conversation_id(conversation_id)?;
    if is_app_artifact_conversation(&conversation_id) {
        return Ok(conversation_id);
    }

    let history = pi_sessions_history(app.clone()).map_err(|error| {
        ArtifactError::store_unavailable(format!(
            "Pi session history could not be loaded: {}",
            error.message
        ))
    })?;
    ensure_history_contains_conversation(&history, &conversation_id)
}

fn ensure_history_contains_conversation(
    history: &PiSessionsList,
    conversation_id: &str,
) -> ArtifactResult<String> {
    let conversation_id = validate_conversation_id(conversation_id)?;
    if is_app_artifact_conversation(&conversation_id) {
        return Ok(conversation_id);
    }
    if history
        .sessions
        .iter()
        .any(|session| session.id == conversation_id)
    {
        Ok(conversation_id)
    } else {
        Err(ArtifactError::unauthorized(
            "artifact conversation does not reference a known Pi session",
        ))
    }
}

fn is_app_artifact_conversation(conversation_id: &str) -> bool {
    APP_ARTIFACT_CONVERSATION_IDS.contains(&conversation_id)
}

fn artifact_update_payload(
    artifact: ArtifactSummary,
    reason: ArtifactUpdateReason,
) -> ArtifactUpdateEvent {
    ArtifactUpdateEvent {
        event_type: ARTIFACT_UPDATE_EVENT_NAME.to_string(),
        conversation_id: artifact.conversation_id.clone(),
        artifact,
        reason,
    }
}

pub fn emit_artifact_update(
    app: &AppHandle,
    artifact: ArtifactSummary,
    reason: ArtifactUpdateReason,
) {
    let payload = artifact_update_payload(artifact, reason);
    if let Err(error) = app.emit(ARTIFACT_UPDATE_EVENT_NAME, payload) {
        log::warn!("failed to emit artifact update event: {error}");
    }
}

fn emit_artifact_delete(app: &AppHandle, conversation_id: String, slug: String) {
    let payload = ArtifactDeleteEvent {
        event_type: ARTIFACT_DELETE_EVENT_NAME.to_string(),
        conversation_id,
        slug,
    };
    if let Err(error) = app.emit(ARTIFACT_DELETE_EVENT_NAME, payload) {
        log::warn!("failed to emit artifact delete event: {error}");
    }
}

pub(crate) fn emit_artifact_conversation_delete(
    app: &AppHandle,
    conversation_id: String,
    deleted_count: usize,
) {
    let payload = ArtifactConversationDeleteEvent {
        event_type: ARTIFACT_CONVERSATION_DELETE_EVENT_NAME.to_string(),
        conversation_id,
        deleted_count,
    };
    if let Err(error) = app.emit(ARTIFACT_CONVERSATION_DELETE_EVENT_NAME, payload) {
        log::warn!("failed to emit artifact conversation delete event: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::artifacts::store::ArtifactSummary;
    use crate::modules::pi::{PiSession, PiSessionsList};

    fn session(id: &str) -> PiSession {
        PiSession {
            id: id.to_string(),
            title: "Test".to_string(),
            cwd: None,
            status: "idle".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            last_prompt: None,
            thinking_level: None,
            sdk_session_file: None,
        }
    }

    #[test]
    fn ui_artifact_commands_require_known_pi_session_ids() {
        let history = PiSessionsList {
            sessions: vec![session("pi_known")],
            events: Vec::new(),
        };

        assert!(ensure_history_contains_conversation(&history, "pi_known").is_ok());
        assert_eq!(
            ensure_history_contains_conversation(&history, "pi_missing")
                .unwrap_err()
                .code,
            "ARTIFACT_UNAUTHORIZED"
        );
    }

    #[test]
    fn ui_artifact_commands_allow_model_compare_system_conversation() {
        let history = PiSessionsList {
            sessions: Vec::new(),
            events: Vec::new(),
        };

        assert_eq!(
            ensure_history_contains_conversation(&history, MODEL_COMPARE_ARTIFACT_CONVERSATION_ID)
                .unwrap(),
            MODEL_COMPARE_ARTIFACT_CONVERSATION_ID
        );
    }

    #[test]
    fn artifact_update_event_payload_never_contains_content() {
        let summary = ArtifactSummary {
            conversation_id: "pi_known".to_string(),
            slug: "hero".to_string(),
            title: "Hero".to_string(),
            kind: ArtifactKind::Html,
            version: 2,
            content_hash: "a".repeat(64),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:01.000Z".to_string(),
            content_bytes: 100_000,
        };

        let payload = artifact_update_payload(summary, ArtifactUpdateReason::Edit);
        let value = serde_json::to_value(payload).unwrap();

        assert_eq!(value["type"], "artifact:update");
        assert_eq!(value["reason"], "edit");
        assert!(value.get("content").is_none());
        assert!(value["artifact"].get("content").is_none());
        assert_eq!(value["artifact"]["contentBytes"], 100_000);
    }
}
