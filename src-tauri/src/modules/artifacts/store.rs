use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::edits::{apply_exact_edits, ArtifactTextEdit};
use super::types::{
    conversation_key, normalize_slug, validate_conversation_id, ArtifactError, ArtifactResult,
};

pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
pub const MAX_ARTIFACT_CONTENT_BYTES: usize = 1_048_576;
pub const MAX_ARTIFACTS_PER_CONVERSATION: usize = 100;
pub const MAX_ARTIFACT_TITLE_CHARS: usize = 120;

mod models;
mod support;

pub use models::{
    Artifact, ArtifactBulkItemResult, ArtifactBulkResult, ArtifactBulkTarget,
    ArtifactConversationArtifacts, ArtifactCreateInput, ArtifactDeleteResult, ArtifactExportResult,
    ArtifactStore, ArtifactSummary, ArtifactVersionSummary, DeletedArtifactSummary,
};

use models::{
    ArtifactIndex, ArtifactIndexConversation, ArtifactStoreInner, ConversationManifest,
    DeletedArtifactRecord, ManifestArtifact,
};
use support::{
    export_artifact_to, export_filename, normalized_title, now_iso_timestamp, sha256_hex,
    unix_epoch_millis, validate_content_size, validate_title, validate_undo_token, write_atomic,
    write_json_atomic,
};

impl ArtifactStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            inner: Arc::new(ArtifactStoreInner {
                root: root.into(),
                lock: Mutex::new(()),
            }),
        }
    }

    pub fn root(&self) -> &Path {
        &self.inner.root
    }

    pub fn list(&self, conversation_id: &str) -> ArtifactResult<Vec<ArtifactSummary>> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let manifest = self.load_manifest_locked(&conversation_id)?;
        Ok(manifest
            .artifacts
            .values()
            .map(|artifact| artifact.summary(&manifest.conversation_id))
            .collect())
    }

    pub fn list_all(&self) -> ArtifactResult<Vec<ArtifactConversationArtifacts>> {
        let _guard = self.write_lock()?;
        let mut conversations = Vec::new();
        match fs::read_dir(self.conversations_dir()) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let path = entry.path().join("manifest.json");
                    if !path.exists() {
                        continue;
                    }
                    let contents = fs::read_to_string(&path)
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let manifest = serde_json::from_str::<ConversationManifest>(&contents)
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    if manifest.schema_version != ARTIFACT_SCHEMA_VERSION {
                        return Err(ArtifactError::store_unavailable(
                            "artifact manifest schema version is not supported",
                        ));
                    }
                    let artifacts: Vec<ArtifactSummary> = manifest
                        .artifacts
                        .values()
                        .map(|artifact| artifact.summary(&manifest.conversation_id))
                        .collect();
                    if artifacts.is_empty() {
                        continue;
                    }
                    let updated_at = artifacts
                        .iter()
                        .map(|artifact| artifact.updated_at.clone())
                        .max();
                    conversations.push(ArtifactConversationArtifacts {
                        conversation_id: manifest.conversation_id,
                        artifact_count: artifacts.len(),
                        updated_at,
                        artifacts,
                    });
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        conversations.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.conversation_id.cmp(&right.conversation_id))
        });
        Ok(conversations)
    }

    pub fn get(
        &self,
        conversation_id: &str,
        slug: &str,
        version: Option<u32>,
    ) -> ArtifactResult<Artifact> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        let manifest = self.load_manifest_locked(&conversation_id)?;
        let artifact = manifest
            .artifacts
            .get(&slug)
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        let version = version.unwrap_or(artifact.current_version);
        let summary = artifact.summary_for_version(&manifest.conversation_id, version)?;
        let content = self.read_version_content_locked(&key, &slug, version)?;
        Ok(Artifact { summary, content })
    }

    pub fn create(
        &self,
        conversation_id: &str,
        input: ArtifactCreateInput,
    ) -> ArtifactResult<Artifact> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(&input.slug)?;
        validate_content_size(&input.content)?;
        let mut manifest = self.load_manifest_locked(&conversation_id)?;
        if manifest.artifacts.contains_key(&slug) {
            return Err(ArtifactError::conflict("artifact slug already exists"));
        }
        if manifest.artifacts.len() >= MAX_ARTIFACTS_PER_CONVERSATION {
            return Err(ArtifactError::too_large(
                "artifact conversation has reached the artifact limit",
            ));
        }

        let timestamp = now_iso_timestamp();
        let content_hash = sha256_hex(&input.content);
        let content_bytes = input.content.len();
        let version = 1;
        self.write_version_content_locked(&key, &slug, version, &input.content)?;

        let title = normalized_title(input.title.as_deref(), &slug);
        let version_summary = ArtifactVersionSummary {
            version,
            content_hash: content_hash.clone(),
            content_bytes,
            created_at: timestamp.clone(),
        };
        let artifact = ManifestArtifact {
            slug: slug.clone(),
            title,
            kind: input.kind,
            current_version: version,
            content_hash,
            content_bytes,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            versions: vec![version_summary],
        };
        manifest.artifacts.insert(slug.clone(), artifact);
        self.save_manifest_locked(&key, &manifest)?;
        self.rebuild_index_locked()?;
        self.get_from_manifest_locked(&manifest, &key, &slug, None)
    }

    pub fn update(
        &self,
        conversation_id: &str,
        slug: &str,
        content: &str,
        base_version: Option<u32>,
    ) -> ArtifactResult<Artifact> {
        let _guard = self.write_lock()?;
        self.update_locked(conversation_id, slug, content, base_version)
    }

    pub fn rename_title(
        &self,
        conversation_id: &str,
        slug: &str,
        title: &str,
    ) -> ArtifactResult<Artifact> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        let title = validate_title(title)?;
        let mut manifest = self.load_manifest_locked(&conversation_id)?;
        let artifact = manifest
            .artifacts
            .get_mut(&slug)
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        artifact.title = title;
        artifact.updated_at = now_iso_timestamp();
        self.save_manifest_locked(&key, &manifest)?;
        self.rebuild_index_locked()?;
        self.get_from_manifest_locked(&manifest, &key, &slug, None)
    }

    pub fn edit(
        &self,
        conversation_id: &str,
        slug: &str,
        edits: &[ArtifactTextEdit],
        base_version: Option<u32>,
    ) -> ArtifactResult<Artifact> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        let manifest = self.load_manifest_locked(&conversation_id)?;
        let artifact = manifest
            .artifacts
            .get(&slug)
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        if let Some(base_version) = base_version {
            if base_version != artifact.current_version {
                return Err(ArtifactError::conflict(
                    "artifact base version is no longer current",
                ));
            }
        }
        let current = self.read_version_content_locked(&key, &slug, artifact.current_version)?;
        let next = apply_exact_edits(&current, edits)?;
        self.update_locked(&conversation_id, &slug, &next, None)
    }

    pub fn versions(
        &self,
        conversation_id: &str,
        slug: &str,
    ) -> ArtifactResult<Vec<ArtifactVersionSummary>> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let slug = normalize_slug(slug)?;
        let manifest = self.load_manifest_locked(&conversation_id)?;
        let artifact = manifest
            .artifacts
            .get(&slug)
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        Ok(artifact.versions.clone())
    }

    pub fn export_to(
        &self,
        conversation_id: &str,
        slug: &str,
        version: Option<u32>,
        destination: &Path,
    ) -> ArtifactResult<ArtifactExportResult> {
        let artifact = self.get(conversation_id, slug, version)?;
        export_artifact_to(artifact, destination)
    }

    pub fn list_deleted(&self) -> ArtifactResult<Vec<DeletedArtifactSummary>> {
        let _guard = self.write_lock()?;
        let mut deleted = Vec::new();
        match fs::read_dir(self.trash_dir()) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let Some(token) = entry.file_name().to_str().map(str::to_string) else {
                        continue;
                    };
                    let Ok(record) = self.load_deleted_record_locked(&token) else {
                        continue;
                    };
                    deleted.push(record.summary());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        deleted.sort_by(|left, right| {
            right
                .deleted_at
                .cmp(&left.deleted_at)
                .then_with(|| left.title.cmp(&right.title))
        });
        Ok(deleted)
    }

    pub fn delete_many(
        &self,
        targets: &[ArtifactBulkTarget],
    ) -> ArtifactResult<ArtifactBulkResult> {
        let _guard = self.write_lock()?;
        let mut index_dirty = false;
        let items = targets
            .iter()
            .map(
                |target| match self.delete_locked(&target.conversation_id, &target.slug) {
                    Ok(result) => {
                        index_dirty = true;
                        let mut item = ArtifactBulkItemResult::success_for_target(target);
                        item.undo_token = result.undo_token;
                        item
                    }
                    Err(error) => ArtifactBulkItemResult::failure_for_target(target, error),
                },
            )
            .collect();
        if index_dirty {
            self.rebuild_index_locked()?;
        }
        Ok(ArtifactBulkResult::from_items(items))
    }

    pub fn delete(
        &self,
        conversation_id: &str,
        slug: &str,
    ) -> ArtifactResult<ArtifactDeleteResult> {
        let _guard = self.write_lock()?;
        let result = self.delete_locked(conversation_id, slug)?;
        self.rebuild_index_locked()?;
        Ok(result)
    }

    fn delete_locked(
        &self,
        conversation_id: &str,
        slug: &str,
    ) -> ArtifactResult<ArtifactDeleteResult> {
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        let mut manifest = self.load_manifest_locked(&conversation_id)?;
        let artifact = manifest
            .artifacts
            .get(&slug)
            .cloned()
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        let undo_token = self.next_delete_token_locked(&conversation_id, &slug)?;
        let trash_dir = self.deleted_artifact_dir(&undo_token);
        let record = DeletedArtifactRecord {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            undo_token: undo_token.clone(),
            conversation_id,
            conversation_key: key.clone(),
            slug: slug.clone(),
            deleted_at: now_iso_timestamp(),
            artifact,
        };
        write_json_atomic(&trash_dir.join("record.json"), &record)?;
        if let Err(error) = fs::rename(self.artifact_dir(&key, &slug), trash_dir.join("artifact")) {
            if let Err(cleanup_err) = fs::remove_dir_all(&trash_dir) {
                log::debug!("artifact delete rollback cleanup failed: {cleanup_err}");
            }
            return Err(ArtifactError::store_unavailable(error.to_string()));
        }
        manifest.artifacts.remove(&slug);
        self.save_manifest_locked(&key, &manifest)?;
        Ok(ArtifactDeleteResult {
            deleted: true,
            deleted_count: 1,
            undo_token: Some(undo_token),
        })
    }

    pub fn restore_deleted(
        &self,
        conversation_id: &str,
        slug: &str,
        undo_token: Option<&str>,
    ) -> ArtifactResult<Artifact> {
        let _guard = self.write_lock()?;
        let artifact = self.restore_deleted_locked(conversation_id, slug, undo_token)?;
        self.rebuild_index_locked()?;
        Ok(artifact)
    }

    fn restore_deleted_locked(
        &self,
        conversation_id: &str,
        slug: &str,
        undo_token: Option<&str>,
    ) -> ArtifactResult<Artifact> {
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        let undo_token = match undo_token {
            Some(token) => validate_undo_token(token)?,
            None => self
                .latest_delete_token_locked(&conversation_id, &slug)?
                .ok_or_else(|| ArtifactError::not_found("deleted artifact was not found"))?,
        };
        let trash_dir = self.deleted_artifact_dir(&undo_token);
        let record = self.load_deleted_record_locked(&undo_token)?;
        if record.conversation_id != conversation_id
            || record.slug != slug
            || record.conversation_key != key
        {
            return Err(ArtifactError::not_found("deleted artifact was not found"));
        }
        let mut manifest = self.load_manifest_locked(&conversation_id)?;
        if manifest.artifacts.contains_key(&slug) {
            return Err(ArtifactError::conflict(
                "artifact slug already exists; cannot restore deleted artifact",
            ));
        }
        let destination = self.artifact_dir(&key, &slug);
        if destination.exists() {
            return Err(ArtifactError::conflict(
                "artifact content directory already exists; cannot restore deleted artifact",
            ));
        }
        fs::create_dir_all(self.conversation_dir(&key))
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
        fs::rename(trash_dir.join("artifact"), &destination)
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
        manifest.artifacts.insert(slug.clone(), record.artifact);
        self.save_manifest_locked(&key, &manifest)?;
        match fs::remove_dir_all(&trash_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                log::warn!("failed to clean restored artifact trash directory: {error}");
            }
        }
        self.get_from_manifest_locked(&manifest, &key, &slug, None)
    }

    pub fn restore_deleted_many(
        &self,
        targets: &[ArtifactBulkTarget],
    ) -> ArtifactResult<ArtifactBulkResult> {
        let _guard = self.write_lock()?;
        let mut index_dirty = false;
        let items = targets
            .iter()
            .map(|target| {
                match self.restore_deleted_locked(
                    &target.conversation_id,
                    &target.slug,
                    target.undo_token.as_deref(),
                ) {
                    Ok(_artifact) => {
                        index_dirty = true;
                        ArtifactBulkItemResult::success_for_target(target)
                    }
                    Err(error) => ArtifactBulkItemResult::failure_for_target(target, error),
                }
            })
            .collect();
        if index_dirty {
            self.rebuild_index_locked()?;
        }
        Ok(ArtifactBulkResult::from_items(items))
    }

    pub fn purge_deleted(
        &self,
        conversation_id: &str,
        slug: &str,
        undo_token: &str,
    ) -> ArtifactResult<ArtifactDeleteResult> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let slug = normalize_slug(slug)?;
        let undo_token = validate_undo_token(undo_token)?;
        let record = self.load_deleted_record_locked(&undo_token)?;
        if record.conversation_id != conversation_id || record.slug != slug {
            return Err(ArtifactError::not_found("deleted artifact was not found"));
        }
        let trash_dir = self.deleted_artifact_dir(&undo_token);
        match fs::remove_dir_all(&trash_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ArtifactError::not_found("deleted artifact was not found"));
            }
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        Ok(ArtifactDeleteResult {
            deleted: true,
            deleted_count: 1,
            undo_token: None,
        })
    }

    pub fn export_many(
        &self,
        targets: &[ArtifactBulkTarget],
        destination_dir: &Path,
    ) -> ArtifactResult<ArtifactBulkResult> {
        fs::create_dir_all(destination_dir)
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
        let items = targets
            .iter()
            .map(|target| {
                let export_result = self
                    .get(&target.conversation_id, &target.slug, target.version)
                    .and_then(|artifact| {
                        let destination = destination_dir.join(export_filename(&artifact.summary)?);
                        export_artifact_to(artifact, &destination)
                    });
                match export_result {
                    Ok(result) => {
                        let mut item = ArtifactBulkItemResult::success_for_target(target);
                        item.path = Some(result.path);
                        item.content_hash = Some(result.content_hash);
                        item.content_bytes = Some(result.content_bytes);
                        item
                    }
                    Err(error) => ArtifactBulkItemResult::failure_for_target(target, error),
                }
            })
            .collect();
        Ok(ArtifactBulkResult::from_items(items))
    }

    pub fn delete_conversation(
        &self,
        conversation_id: &str,
    ) -> ArtifactResult<ArtifactDeleteResult> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let manifest = self.load_manifest_locked(&conversation_id)?;
        let deleted_count = manifest.artifacts.len();
        let dir = self.conversation_dir(&key);
        match fs::remove_dir_all(&dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        self.rebuild_index_locked()?;
        Ok(ArtifactDeleteResult {
            deleted: deleted_count > 0,
            deleted_count,
            undo_token: None,
        })
    }

    fn update_locked(
        &self,
        conversation_id: &str,
        slug: &str,
        content: &str,
        base_version: Option<u32>,
    ) -> ArtifactResult<Artifact> {
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        validate_content_size(content)?;
        let mut manifest = self.load_manifest_locked(&conversation_id)?;
        let artifact = manifest
            .artifacts
            .get_mut(&slug)
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        if let Some(base_version) = base_version {
            if base_version != artifact.current_version {
                return Err(ArtifactError::conflict(
                    "artifact base version is no longer current",
                ));
            }
        }
        let version = artifact.current_version + 1;
        self.write_version_content_locked(&key, &slug, version, content)?;
        let timestamp = now_iso_timestamp();
        let content_hash = sha256_hex(content);
        let content_bytes = content.len();
        artifact.current_version = version;
        artifact.content_hash = content_hash.clone();
        artifact.content_bytes = content_bytes;
        artifact.updated_at = timestamp.clone();
        artifact.versions.push(ArtifactVersionSummary {
            version,
            content_hash,
            content_bytes,
            created_at: timestamp,
        });
        self.save_manifest_locked(&key, &manifest)?;
        self.rebuild_index_locked()?;
        self.get_from_manifest_locked(&manifest, &key, &slug, None)
    }

    fn get_from_manifest_locked(
        &self,
        manifest: &ConversationManifest,
        key: &str,
        slug: &str,
        version: Option<u32>,
    ) -> ArtifactResult<Artifact> {
        let artifact = manifest
            .artifacts
            .get(slug)
            .ok_or_else(|| ArtifactError::not_found("artifact was not found"))?;
        let version = version.unwrap_or(artifact.current_version);
        let summary = artifact.summary_for_version(&manifest.conversation_id, version)?;
        let content = self.read_version_content_locked(key, slug, version)?;
        Ok(Artifact { summary, content })
    }

    fn write_lock(&self) -> ArtifactResult<std::sync::MutexGuard<'_, ()>> {
        self.inner
            .lock
            .lock()
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))
    }

    fn load_manifest_locked(&self, conversation_id: &str) -> ArtifactResult<ConversationManifest> {
        let key = conversation_key(conversation_id)?;
        let path = self.manifest_path(&key);
        match fs::read_to_string(&path) {
            Ok(contents) => {
                let manifest = serde_json::from_str::<ConversationManifest>(&contents)
                    .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                if manifest.schema_version != ARTIFACT_SCHEMA_VERSION {
                    return Err(ArtifactError::store_unavailable(
                        "artifact manifest schema version is not supported",
                    ));
                }
                if manifest.conversation_id != conversation_id {
                    return Err(ArtifactError::store_unavailable(
                        "artifact manifest conversation id mismatch",
                    ));
                }
                Ok(manifest)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ConversationManifest {
                    schema_version: ARTIFACT_SCHEMA_VERSION,
                    conversation_id: conversation_id.to_string(),
                    artifacts: BTreeMap::new(),
                })
            }
            Err(error) => Err(ArtifactError::store_unavailable(error.to_string())),
        }
    }

    fn save_manifest_locked(
        &self,
        key: &str,
        manifest: &ConversationManifest,
    ) -> ArtifactResult<()> {
        let path = self.manifest_path(key);
        write_json_atomic(&path, manifest)
    }

    fn rebuild_index_locked(&self) -> ArtifactResult<()> {
        let conversations_dir = self.conversations_dir();
        let mut conversations = Vec::new();
        match fs::read_dir(&conversations_dir) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let path = entry.path().join("manifest.json");
                    if !path.exists() {
                        continue;
                    }
                    let contents = fs::read_to_string(&path)
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let manifest = serde_json::from_str::<ConversationManifest>(&contents)
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
                        continue;
                    };
                    let updated_at = manifest
                        .artifacts
                        .values()
                        .map(|artifact| artifact.updated_at.clone())
                        .max();
                    conversations.push(ArtifactIndexConversation {
                        conversation_id: manifest.conversation_id,
                        conversation_key: file_name,
                        artifact_count: manifest.artifacts.len(),
                        updated_at,
                    });
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        conversations.sort_by(|left, right| left.conversation_key.cmp(&right.conversation_key));
        let index = ArtifactIndex {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            conversations,
        };
        write_json_atomic(&self.inner.root.join("index.json"), &index)
    }

    fn read_version_content_locked(
        &self,
        key: &str,
        slug: &str,
        version: u32,
    ) -> ArtifactResult<String> {
        fs::read_to_string(self.version_path(key, slug, version))
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))
    }

    fn write_version_content_locked(
        &self,
        key: &str,
        slug: &str,
        version: u32,
        content: &str,
    ) -> ArtifactResult<()> {
        let path = self.version_path(key, slug, version);
        if path.exists() {
            return Err(ArtifactError::conflict("artifact version already exists"));
        }
        write_atomic(&path, content.as_bytes())
    }

    fn conversations_dir(&self) -> PathBuf {
        self.inner.root.join("conversations")
    }

    fn conversation_dir(&self, key: &str) -> PathBuf {
        self.conversations_dir().join(key)
    }

    fn manifest_path(&self, key: &str) -> PathBuf {
        self.conversation_dir(key).join("manifest.json")
    }

    fn artifact_dir(&self, key: &str, slug: &str) -> PathBuf {
        self.conversation_dir(key).join(slug)
    }

    fn version_path(&self, key: &str, slug: &str, version: u32) -> PathBuf {
        self.artifact_dir(key, slug)
            .join(format!("v{version:04}.txt"))
    }

    fn trash_dir(&self) -> PathBuf {
        self.inner.root.join("trash")
    }

    fn deleted_artifact_dir(&self, undo_token: &str) -> PathBuf {
        self.trash_dir().join(undo_token)
    }

    fn deleted_record_path(&self, undo_token: &str) -> PathBuf {
        self.deleted_artifact_dir(undo_token).join("record.json")
    }

    fn load_deleted_record_locked(
        &self,
        undo_token: &str,
    ) -> ArtifactResult<DeletedArtifactRecord> {
        let undo_token = validate_undo_token(undo_token)?;
        let contents =
            fs::read_to_string(self.deleted_record_path(&undo_token)).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    ArtifactError::not_found("deleted artifact was not found")
                } else {
                    ArtifactError::store_unavailable(error.to_string())
                }
            })?;
        let record = serde_json::from_str::<DeletedArtifactRecord>(&contents)
            .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
        if record.schema_version != ARTIFACT_SCHEMA_VERSION {
            return Err(ArtifactError::store_unavailable(
                "deleted artifact record schema version is not supported",
            ));
        }
        Ok(record)
    }

    fn latest_delete_token_locked(
        &self,
        conversation_id: &str,
        slug: &str,
    ) -> ArtifactResult<Option<String>> {
        let mut latest: Option<DeletedArtifactRecord> = None;
        match fs::read_dir(self.trash_dir()) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry
                        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
                    let Some(token) = entry.file_name().to_str().map(str::to_string) else {
                        continue;
                    };
                    let Ok(record) = self.load_deleted_record_locked(&token) else {
                        continue;
                    };
                    if record.conversation_id != conversation_id || record.slug != slug {
                        continue;
                    }
                    if latest
                        .as_ref()
                        .is_none_or(|current| record.deleted_at > current.deleted_at)
                    {
                        latest = Some(record);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        Ok(latest.map(|record| record.undo_token))
    }

    fn next_delete_token_locked(
        &self,
        conversation_id: &str,
        slug: &str,
    ) -> ArtifactResult<String> {
        let digest = sha256_hex(&format!("{conversation_id}:{slug}"));
        let base = format!("d_{}_{}", unix_epoch_millis(), &digest[..12]);
        for suffix in 0..1000 {
            let token = if suffix == 0 {
                base.clone()
            } else {
                format!("{base}_{suffix}")
            };
            if !self.deleted_artifact_dir(&token).exists() {
                return Ok(token);
            }
        }
        Err(ArtifactError::store_unavailable(
            "could not allocate deleted artifact undo token",
        ))
    }
}

#[cfg(test)]
mod tests;
