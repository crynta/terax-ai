use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::super::types::{ArtifactError, ArtifactKind, ArtifactResult};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCreateInput {
    pub slug: String,
    pub title: Option<String>,
    pub kind: ArtifactKind,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub conversation_id: String,
    pub slug: String,
    pub title: String,
    pub kind: ArtifactKind,
    pub version: u32,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
    pub content_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactConversationArtifacts {
    pub conversation_id: String,
    pub artifact_count: usize,
    pub updated_at: Option<String>,
    pub artifacts: Vec<ArtifactSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub summary: ArtifactSummary,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactVersionSummary {
    pub version: u32,
    pub content_hash: String,
    pub content_bytes: usize,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDeleteResult {
    pub deleted: bool,
    pub deleted_count: usize,
    pub undo_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedArtifactSummary {
    pub conversation_id: String,
    pub slug: String,
    pub title: String,
    pub kind: ArtifactKind,
    pub version: u32,
    pub content_hash: String,
    pub deleted_at: String,
    pub content_bytes: usize,
    pub undo_token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactBulkTarget {
    pub conversation_id: String,
    pub slug: String,
    pub undo_token: Option<String>,
    pub version: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactBulkResult {
    pub requested_count: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub items: Vec<ArtifactBulkItemResult>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactBulkItemResult {
    pub conversation_id: String,
    pub slug: String,
    pub success: bool,
    pub undo_token: Option<String>,
    pub path: Option<PathBuf>,
    pub content_hash: Option<String>,
    pub content_bytes: Option<usize>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExportResult {
    pub conversation_id: String,
    pub slug: String,
    pub version: u32,
    pub path: PathBuf,
    pub content_hash: String,
    pub content_bytes: usize,
}

#[derive(Clone)]
pub struct ArtifactStore {
    pub(super) inner: Arc<ArtifactStoreInner>,
}

pub(super) struct ArtifactStoreInner {
    pub(super) root: PathBuf,
    pub(super) lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConversationManifest {
    pub(super) schema_version: u32,
    pub(super) conversation_id: String,
    pub(super) artifacts: BTreeMap<String, ManifestArtifact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManifestArtifact {
    pub(super) slug: String,
    pub(super) title: String,
    pub(super) kind: ArtifactKind,
    pub(super) current_version: u32,
    pub(super) content_hash: String,
    pub(super) content_bytes: usize,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) versions: Vec<ArtifactVersionSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ArtifactIndex {
    pub(super) schema_version: u32,
    pub(super) conversations: Vec<ArtifactIndexConversation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ArtifactIndexConversation {
    pub(super) conversation_id: String,
    pub(super) conversation_key: String,
    pub(super) artifact_count: usize,
    pub(super) updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeletedArtifactRecord {
    pub(super) schema_version: u32,
    pub(super) undo_token: String,
    pub(super) conversation_id: String,
    pub(super) conversation_key: String,
    pub(super) slug: String,
    pub(super) deleted_at: String,
    pub(super) artifact: ManifestArtifact,
}

impl ArtifactBulkTarget {
    pub fn active(conversation_id: impl Into<String>, slug: impl Into<String>) -> Self {
        Self {
            conversation_id: conversation_id.into(),
            slug: slug.into(),
            undo_token: None,
            version: None,
        }
    }

    pub fn deleted(
        conversation_id: impl Into<String>,
        slug: impl Into<String>,
        undo_token: impl Into<String>,
    ) -> Self {
        Self {
            conversation_id: conversation_id.into(),
            slug: slug.into(),
            undo_token: Some(undo_token.into()),
            version: None,
        }
    }
}

impl ArtifactBulkResult {
    pub(super) fn from_items(items: Vec<ArtifactBulkItemResult>) -> Self {
        let requested_count = items.len();
        let success_count = items.iter().filter(|item| item.success).count();
        Self {
            requested_count,
            success_count,
            failure_count: requested_count.saturating_sub(success_count),
            items,
        }
    }
}

impl ArtifactBulkItemResult {
    pub(super) fn success_for_target(target: &ArtifactBulkTarget) -> Self {
        Self {
            conversation_id: target.conversation_id.clone(),
            slug: target.slug.clone(),
            success: true,
            undo_token: None,
            path: None,
            content_hash: None,
            content_bytes: None,
            error_code: None,
            error_message: None,
        }
    }

    pub(super) fn failure_for_target(target: &ArtifactBulkTarget, error: ArtifactError) -> Self {
        Self {
            conversation_id: target.conversation_id.clone(),
            slug: target.slug.clone(),
            success: false,
            undo_token: None,
            path: None,
            content_hash: None,
            content_bytes: None,
            error_code: Some(error.code),
            error_message: Some(error.message),
        }
    }
}

impl DeletedArtifactRecord {
    pub(super) fn summary(&self) -> DeletedArtifactSummary {
        DeletedArtifactSummary {
            conversation_id: self.conversation_id.clone(),
            slug: self.slug.clone(),
            title: self.artifact.title.clone(),
            kind: self.artifact.kind.clone(),
            version: self.artifact.current_version,
            content_hash: self.artifact.content_hash.clone(),
            deleted_at: self.deleted_at.clone(),
            content_bytes: self.artifact.content_bytes,
            undo_token: self.undo_token.clone(),
        }
    }
}

impl ManifestArtifact {
    pub(super) fn summary(&self, conversation_id: &str) -> ArtifactSummary {
        ArtifactSummary {
            conversation_id: conversation_id.to_string(),
            slug: self.slug.clone(),
            title: self.title.clone(),
            kind: self.kind.clone(),
            version: self.current_version,
            content_hash: self.content_hash.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            content_bytes: self.content_bytes,
        }
    }

    pub(super) fn summary_for_version(
        &self,
        conversation_id: &str,
        version: u32,
    ) -> ArtifactResult<ArtifactSummary> {
        if version == self.current_version {
            return Ok(self.summary(conversation_id));
        }
        let version_summary = self
            .versions
            .iter()
            .find(|entry| entry.version == version)
            .ok_or_else(|| ArtifactError::not_found("artifact version was not found"))?;
        Ok(ArtifactSummary {
            conversation_id: conversation_id.to_string(),
            slug: self.slug.clone(),
            title: self.title.clone(),
            kind: self.kind.clone(),
            version,
            content_hash: version_summary.content_hash.clone(),
            created_at: self.created_at.clone(),
            updated_at: version_summary.created_at.clone(),
            content_bytes: version_summary.content_bytes,
        })
    }
}
