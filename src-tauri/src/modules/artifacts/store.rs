use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::edits::{apply_exact_edits, ArtifactTextEdit};
use super::react::{compile_react_artifact, ReactCompileInput};
use super::types::{
    conversation_key, normalize_slug, validate_conversation_id, ArtifactError, ArtifactKind,
    ArtifactResult,
};

pub const ARTIFACT_SCHEMA_VERSION: u32 = 1;
pub const MAX_ARTIFACT_CONTENT_BYTES: usize = 1_048_576;
pub const MAX_ARTIFACTS_PER_CONVERSATION: usize = 100;

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
    inner: Arc<ArtifactStoreInner>,
}

struct ArtifactStoreInner {
    root: PathBuf,
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationManifest {
    schema_version: u32,
    conversation_id: String,
    artifacts: BTreeMap<String, ManifestArtifact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestArtifact {
    slug: String,
    title: String,
    kind: ArtifactKind,
    current_version: u32,
    content_hash: String,
    content_bytes: usize,
    created_at: String,
    updated_at: String,
    versions: Vec<ArtifactVersionSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactIndex {
    schema_version: u32,
    conversations: Vec<ArtifactIndexConversation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactIndexConversation {
    conversation_id: String,
    conversation_key: String,
    artifact_count: usize,
    updated_at: Option<String>,
}

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
        validate_export_destination(&artifact.summary.kind, destination)?;
        let export_content = export_content_for_artifact(&artifact)?;
        write_atomic(destination, export_content.as_bytes())?;
        Ok(ArtifactExportResult {
            conversation_id: artifact.summary.conversation_id,
            slug: artifact.summary.slug,
            version: artifact.summary.version,
            path: destination.to_path_buf(),
            content_hash: sha256_hex(&export_content),
            content_bytes: export_content.len(),
        })
    }

    pub fn delete(
        &self,
        conversation_id: &str,
        slug: &str,
    ) -> ArtifactResult<ArtifactDeleteResult> {
        let _guard = self.write_lock()?;
        let conversation_id = validate_conversation_id(conversation_id)?;
        let key = conversation_key(&conversation_id)?;
        let slug = normalize_slug(slug)?;
        let mut manifest = self.load_manifest_locked(&conversation_id)?;
        if manifest.artifacts.remove(&slug).is_none() {
            return Err(ArtifactError::not_found("artifact was not found"));
        }
        let artifact_dir = self.artifact_dir(&key, &slug);
        match fs::remove_dir_all(&artifact_dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ArtifactError::store_unavailable(error.to_string())),
        }
        self.save_manifest_locked(&key, &manifest)?;
        self.rebuild_index_locked()?;
        Ok(ArtifactDeleteResult {
            deleted: true,
            deleted_count: 1,
        })
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
}

impl ManifestArtifact {
    fn summary(&self, conversation_id: &str) -> ArtifactSummary {
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

    fn summary_for_version(
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

fn normalized_title(title: Option<&str>, slug: &str) -> String {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| slug.to_string())
}

fn validate_content_size(content: &str) -> ArtifactResult<()> {
    if content.len() > MAX_ARTIFACT_CONTENT_BYTES {
        return Err(ArtifactError::too_large(format!(
            "artifact content must be at most {MAX_ARTIFACT_CONTENT_BYTES} bytes"
        )));
    }
    Ok(())
}

fn export_content_for_artifact(artifact: &Artifact) -> ArtifactResult<String> {
    match artifact.summary.kind {
        ArtifactKind::React => compile_react_artifact(ReactCompileInput {
            content: artifact.content.clone(),
        })
        .map(|result| result.document),
        _ => Ok(artifact.content.clone()),
    }
}

fn validate_export_destination(kind: &ArtifactKind, destination: &Path) -> ArtifactResult<()> {
    if destination.as_os_str().is_empty() || destination.file_name().is_none() {
        return Err(ArtifactError::export_denied(
            "artifact export destination must include a file name",
        ));
    }
    if destination.is_dir() {
        return Err(ArtifactError::export_denied(
            "artifact export destination must be a file path",
        ));
    }
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| {
            ArtifactError::export_denied("artifact export destination must have a file extension")
        })?;
    let allowed = match kind {
        ArtifactKind::Html => matches!(extension.as_str(), "html" | "htm"),
        ArtifactKind::Markdown => matches!(extension.as_str(), "md" | "markdown"),
        ArtifactKind::Text => matches!(extension.as_str(), "txt" | "text"),
        ArtifactKind::Json => extension == "json",
        ArtifactKind::Svg => extension == "svg",
        ArtifactKind::React => matches!(extension.as_str(), "html" | "htm"),
    };
    if allowed {
        Ok(())
    } else {
        Err(ArtifactError::export_denied(
            "artifact export destination extension does not match artifact kind",
        ))
    }
}

fn sha256_hex(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    bytes_to_hex(&digest)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(hex_nibble(byte >> 4));
        output.push(hex_nibble(byte & 0x0f));
    }
    output
}

fn hex_nibble(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + (value - 10)) as char,
        _ => '0',
    }
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> ArtifactResult<()> {
    let contents = serde_json::to_vec_pretty(value)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    let mut with_newline = contents;
    with_newline.push(b'\n');
    write_atomic(path, &with_newline)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> ArtifactResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| ArtifactError::store_unavailable("artifact path has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    temp.write_all(bytes)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    temp.flush()
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    temp.persist(path)
        .map_err(|error| ArtifactError::store_unavailable(error.error.to_string()))?;
    Ok(())
}

fn now_iso_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
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

#[cfg(test)]
mod tests;
