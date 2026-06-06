use serde::Deserialize;
use serde_json::{json, Value};

use crate::modules::artifacts::{
    ArtifactCreateInput, ArtifactKind, ArtifactStore, ArtifactSummary, ArtifactTextEdit,
    ArtifactUpdateReason,
};

use super::{NativeToolContext, NativeToolRequest, NativeToolResult, ToolInput, MAX_OUTPUT_BYTES};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateArtifactToolInput {
    slug: String,
    kind: ArtifactKind,
    content: String,
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditArtifactToolInput {
    id: String,
    edits: Vec<ArtifactTextEdit>,
    base_version: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadArtifactToolInput {
    id: String,
    version: Option<u32>,
}

pub(super) fn execute_create_artifact(
    request: &NativeToolRequest,
    input: ToolInput<'_>,
    context: &NativeToolContext,
) -> Result<NativeToolResult, String> {
    reject_model_conversation_id(input.value)?;
    let input: CreateArtifactToolInput = serde_json::from_value(input.value.clone())
        .map_err(|error| format!("invalid create_artifact input: {error}"))?;
    let store = artifact_store(context)?;
    let artifact = store
        .create(
            &request.session_id,
            ArtifactCreateInput {
                slug: input.slug,
                title: input.title,
                kind: input.kind,
                content: input.content,
            },
        )
        .map_err(format_artifact_error)?;
    emit_artifact_update(context, &artifact.summary, ArtifactUpdateReason::Create);
    Ok(NativeToolResult::text(
        format!(
            "Created artifact {} ({} v{}, {} bytes).",
            artifact.summary.slug,
            artifact_kind_label(&artifact.summary.kind),
            artifact.summary.version,
            artifact.summary.content_bytes
        ),
        artifact_details(&artifact.summary),
    ))
}

pub(super) fn execute_edit_artifact(
    request: &NativeToolRequest,
    input: ToolInput<'_>,
    context: &NativeToolContext,
) -> Result<NativeToolResult, String> {
    reject_model_conversation_id(input.value)?;
    let input: EditArtifactToolInput = serde_json::from_value(input.value.clone())
        .map_err(|error| format!("invalid edit_artifact input: {error}"))?;
    let store = artifact_store(context)?;
    let artifact = store
        .edit(
            &request.session_id,
            &input.id,
            &input.edits,
            input.base_version,
        )
        .map_err(format_artifact_error)?;
    emit_artifact_update(context, &artifact.summary, ArtifactUpdateReason::Edit);
    Ok(NativeToolResult::text(
        format!(
            "Edited artifact {} (v{}, {} bytes).",
            artifact.summary.slug, artifact.summary.version, artifact.summary.content_bytes
        ),
        artifact_details(&artifact.summary),
    ))
}

pub(super) fn execute_read_artifact(
    request: &NativeToolRequest,
    input: ToolInput<'_>,
    context: &NativeToolContext,
) -> Result<NativeToolResult, String> {
    reject_model_conversation_id(input.value)?;
    let input: ReadArtifactToolInput = serde_json::from_value(input.value.clone())
        .map_err(|error| format!("invalid read_artifact input: {error}"))?;
    let store = artifact_store(context)?;
    let artifact = store
        .get(&request.session_id, &input.id, input.version)
        .map_err(format_artifact_error)?;
    if artifact.content.len() > MAX_OUTPUT_BYTES {
        return Err(format!(
            "ARTIFACT_TOO_LARGE: artifact content is {} bytes, max tool result is {} bytes",
            artifact.content.len(),
            MAX_OUTPUT_BYTES
        ));
    }
    Ok(NativeToolResult::text(
        artifact.content,
        artifact_details(&artifact.summary),
    ))
}

pub(super) fn execute_list_artifacts(
    request: &NativeToolRequest,
    input: ToolInput<'_>,
    context: &NativeToolContext,
) -> Result<NativeToolResult, String> {
    reject_model_conversation_id(input.value)?;
    let store = artifact_store(context)?;
    let artifacts = store
        .list(&request.session_id)
        .map_err(format_artifact_error)?;
    let text = if artifacts.is_empty() {
        "No artifacts for this conversation.".to_string()
    } else {
        artifacts
            .iter()
            .map(|artifact| {
                format!(
                    "{} | {} | v{} | {} bytes | {}",
                    artifact.slug,
                    artifact_kind_label(&artifact.kind),
                    artifact.version,
                    artifact.content_bytes,
                    artifact.title
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    Ok(NativeToolResult::text(
        text,
        json!({
            "artifacts": artifacts,
            "count": artifacts.len(),
            "mediatedBy": "rust"
        }),
    ))
}

fn reject_model_conversation_id(input: &Value) -> Result<(), String> {
    if input.get("conversationId").is_some() || input.get("conversation_id").is_some() {
        return Err(
            "artifact tools derive conversationId from the verified Pi session; remove conversationId from input"
                .to_string(),
        );
    }
    Ok(())
}

fn artifact_store(context: &NativeToolContext) -> Result<ArtifactStore, String> {
    context
        .artifact_store
        .clone()
        .ok_or_else(|| "artifact store is unavailable for this Pi session".to_string())
}

pub(super) fn emit_artifact_update(
    context: &NativeToolContext,
    artifact: &ArtifactSummary,
    reason: ArtifactUpdateReason,
) {
    if let Some(sink) = context.artifact_update_sink.as_ref() {
        sink(artifact.clone(), reason);
    }
}

fn artifact_details(summary: &ArtifactSummary) -> Value {
    json!({
        "artifact": summary,
        "mediatedBy": "rust"
    })
}

pub(super) fn artifact_kind_label(kind: &ArtifactKind) -> &'static str {
    match kind {
        ArtifactKind::Html => "html",
        ArtifactKind::React => "react",
        ArtifactKind::Markdown => "markdown",
        ArtifactKind::Text => "text",
        ArtifactKind::Json => "json",
        ArtifactKind::Svg => "svg",
    }
}

pub(super) fn format_artifact_error(error: crate::modules::artifacts::ArtifactError) -> String {
    format!("{}: {}", error.code, error.message)
}
