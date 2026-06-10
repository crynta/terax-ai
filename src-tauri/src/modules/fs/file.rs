use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::capabilities::{
    AppCapabilityState, WorkflowCapabilityState, WorkflowPolicyContext,
};
use crate::modules::fs::safety::ensure_not_sensitive_path;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

pub fn fs_read_file_inner(path: String, workspace: WorkspaceEnv) -> Result<ReadResult, String> {
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

#[tauri::command]
pub fn fs_read_file(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<ReadResult, String> {
    app_audit.execute_app_capability("app.file_read", || {
        fs_read_file_inner(path, WorkspaceEnv::from_option(workspace))
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFileReadRequest {
    pub path: String,
    #[serde(default)]
    pub workspace: WorkspaceEnv,
    pub approved: bool,
    pub document_id: String,
    pub node_id: String,
}

impl WorkflowFileReadRequest {
    fn policy_context(&self) -> WorkflowPolicyContext {
        WorkflowPolicyContext {
            approved: self.approved,
            document_id: self.document_id.clone(),
            node_id: self.node_id.clone(),
        }
    }
}

pub fn workflow_file_read_inner(
    state: &WorkflowCapabilityState,
    request: WorkflowFileReadRequest,
) -> Result<ReadResult, String> {
    let context = request.policy_context();
    state.execute_workflow_capability(&context, "workflow.file_read", || {
        ensure_not_sensitive_path(&request.path, &request.workspace)?;
        fs_read_file_inner(request.path, request.workspace)
    })
}

#[tauri::command]
pub fn workflow_file_read(
    state: tauri::State<WorkflowCapabilityState>,
    request: WorkflowFileReadRequest,
) -> Result<ReadResult, String> {
    workflow_file_read_inner(&state, request)
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

fn write_base64_atomic(target: &Path, content_base64: &str) -> Result<(), String> {
    let bytes = STANDARD
        .decode(content_base64)
        .map_err(|e| format!("invalid base64 content: {e}"))?;
    write_atomic(target, &bytes).map_err(|e| e.to_string())
}

pub fn fs_write_file_inner(
    path: String,
    content: String,
    workspace: WorkspaceEnv,
) -> Result<(), String> {
    let target = resolve_path(&path, &workspace);
    let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    if let Some(perms) = original_permissions {
        if let Err(e) = fs::set_permissions(&target, perms) {
            log::debug!(
                "fs_write_file: failed to restore permissions on {}: {e}",
                target.display()
            );
        }
    }

    Ok(())
}

fn emit_file_written(app: &tauri::AppHandle, path: String, source: Option<String>) {
    if let Err(e) = app.emit("fs:file-written", FileWrittenEvent { path, source }) {
        log::debug!("fs:file-written emit failed: {e}");
    }
}

#[tauri::command]
pub fn fs_write_file(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        fs_write_file_inner(path.clone(), content, WorkspaceEnv::from_option(workspace))?;
        emit_file_written(&app, path, source);
        Ok(())
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFileWriteRequest {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub workspace: WorkspaceEnv,
    #[serde(default)]
    pub source: Option<String>,
    pub approved: bool,
    pub document_id: String,
    pub node_id: String,
}

impl WorkflowFileWriteRequest {
    fn policy_context(&self) -> WorkflowPolicyContext {
        WorkflowPolicyContext {
            approved: self.approved,
            document_id: self.document_id.clone(),
            node_id: self.node_id.clone(),
        }
    }
}

pub fn workflow_file_write_inner(
    state: &WorkflowCapabilityState,
    request: WorkflowFileWriteRequest,
) -> Result<(), String> {
    let context = request.policy_context();
    state.execute_workflow_capability(&context, "workflow.file_write", || {
        ensure_not_sensitive_path(&request.path, &request.workspace)?;
        fs_write_file_inner(request.path, request.content, request.workspace)
    })
}

#[tauri::command]
pub fn workflow_file_write(
    state: tauri::State<WorkflowCapabilityState>,
    request: WorkflowFileWriteRequest,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = request.path.clone();
    let source = request.source.clone();
    workflow_file_write_inner(&state, request)?;
    emit_file_written(&app, path, source);
    Ok(())
}

#[tauri::command]
pub fn fs_write_base64_file(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    content_base64: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
        write_base64_atomic(&target, &content_base64).map_err(|e| {
            log::warn!("fs_write_base64_file({}) failed: {e}", target.display());
            e
        })?;

        if let Some(perms) = original_permissions {
            if let Err(e) = fs::set_permissions(&target, perms) {
                log::debug!(
                    "fs_write_base64_file: failed to restore permissions on {}: {e}",
                    target.display()
                );
            }
        }
        emit_file_written(&app, path, source);

        Ok(())
    })
}

#[tauri::command]
pub fn fs_canonicalize(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<String, String> {
    app_audit.execute_app_capability("app.file_read", || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let p = resolve_path(&path, &workspace);
        let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
        Ok(super::to_canon(&canon))
    })
}

#[tauri::command]
pub fn fs_stat(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<FileStat, String> {
    app_audit.execute_app_capability("app.file_read", || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let p = resolve_path(&path, &workspace);
        let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
        let kind = if meta.is_dir() {
            StatKind::Dir
        } else if meta.file_type().is_symlink() {
            StatKind::Symlink
        } else {
            StatKind::File
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(FileStat {
            size: meta.len(),
            mtime,
            kind,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match fs_read_file_inner(f.to_string_lossy().into_owned(), WorkspaceEnv::Local).unwrap() {
            ReadResult::Text { content, size } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            fs_read_file_inner(f.to_string_lossy().into_owned(), WorkspaceEnv::Local).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            fs_read_file_inner(f.to_string_lossy().into_owned(), WorkspaceEnv::Local).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn writes_base64_binary_content() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("image.bin");
        write_base64_atomic(&target, "UE5HAAE=").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"PNG\0\x01");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terax.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
