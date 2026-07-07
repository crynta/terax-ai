use std::fs::OpenOptions;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;
use tauri::Emitter;

use crate::modules::capabilities::{
    AppCapabilityState, WorkflowCapabilityState, WorkflowPolicyContext,
};
use crate::modules::fs::safety::ensure_not_sensitive_path;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Creates a new empty file. Uses `O_EXCL` semantics (via `create_new`)
/// so the operation is atomic — fails if the file already exists, closing
/// the TOCTOU window between the existence check and the write.
pub fn fs_create_file_inner(path: String, workspace: WorkspaceEnv) -> Result<(), String> {
    let p = resolve_path(&path, &workspace);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&p)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                format!("already exists: {}", p.display())
            } else {
                log::debug!("fs_create_file({}) failed: {e}", p.display());
                e.to_string()
            }
        })?;
    Ok(())
}

#[tauri::command]
pub fn fs_create_file(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        fs_create_file_inner(path, WorkspaceEnv::from_option(workspace))
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
pub fn fs_create_dir_inner(path: String, workspace: WorkspaceEnv) -> Result<(), String> {
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[tauri::command]
pub fn fs_create_dir(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        fs_create_dir_inner(path, WorkspaceEnv::from_option(workspace))
    })
}

/// Copies a file, overwriting the destination after the caller confirms via UI.
pub fn fs_copy_file_inner(from: String, to: String, workspace: WorkspaceEnv) -> Result<(), String> {
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.is_file() {
        return Err(format!("not a file: {}", from_p.display()));
    }
    std::fs::copy(&from_p, &to_p).map_err(|e| {
        log::warn!(
            "fs_copy_file({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub fn fs_copy_file(
    app_audit: tauri::State<AppCapabilityState>,
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        fs_copy_file_inner(from, to.clone(), WorkspaceEnv::from_option(workspace))?;
        if let Err(e) = app.emit("fs:file-written", FileWrittenEvent { path: to, source }) {
            log::debug!("fs:file-written emit failed: {e}");
        }
        Ok(())
    })
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Copies external files/dirs into a destination directory, recursively for
/// dirs. Sources are absolute OS paths (from a drag-drop); only the destination
/// is workspace-resolved. Refuses to overwrite existing entries.
#[tauri::command]
pub fn fs_copy(
    app_audit: tauri::State<AppCapabilityState>,
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let dest = resolve_path(&dest_dir, &workspace);
        for source in &sources {
            let src = std::path::PathBuf::from(source);
            let name = src
                .file_name()
                .ok_or_else(|| format!("invalid source: {source}"))?;
            let target = dest.join(name);
            if target.exists() {
                return Err(format!("already exists: {}", target.display()));
            }
            copy_recursive(&src, &target).map_err(|e| {
                log::warn!(
                    "fs_copy({} -> {}) failed: {e}",
                    src.display(),
                    target.display()
                );
                e.to_string()
            })?;
        }
        Ok(())
    })
}

/// Opens a file or directory using the operating system default app.
pub fn fs_open_file_inner(path: String, workspace: WorkspaceEnv) -> Result<(), String> {
    let p = resolve_path(&path, &workspace);
    if !p.exists() {
        return Err(format!("not found: {}", p.display()));
    }
    open_path_with_system(&p).map_err(|e| {
        log::warn!("fs_open_file({}) failed: {e}", p.display());
        e
    })
}

#[tauri::command]
pub fn fs_open_file(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_read", || {
        fs_open_file_inner(path, WorkspaceEnv::from_option(workspace))
    })
}

#[cfg(target_os = "macos")]
fn open_path_with_system(path: &Path) -> Result<(), String> {
    let status = Command::new("open")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open exited with status {status}"))
    }
}

#[cfg(target_os = "windows")]
fn open_path_with_system(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path_with_system(path: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
///
/// Uses hard_link + remove_file instead of rename to avoid TOCTOU: `link()`
/// fails with `EEXIST` if the target already exists, so the check is atomic
/// even if another process creates the target between our existence check and
/// the operation.
pub fn fs_rename_inner(from: String, to: String, workspace: WorkspaceEnv) -> Result<(), String> {
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::hard_link(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename link({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })?;
    std::fs::remove_file(&from_p).map_err(|e| {
        log::debug!("fs_rename cleanup({}) failed: {e}", from_p.display());
        let _ = std::fs::remove_file(&to_p);
        e.to_string()
    })
}

#[tauri::command]
pub fn fs_rename(
    app_audit: tauri::State<AppCapabilityState>,
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        fs_rename_inner(from, to, WorkspaceEnv::from_option(workspace))
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
pub fn fs_delete_inner(path: String, workspace: WorkspaceEnv) -> Result<(), String> {
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[tauri::command]
pub fn fs_delete(
    app_audit: tauri::State<AppCapabilityState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    app_audit.execute_app_capability("app.file_write", || {
        fs_delete_inner(path, WorkspaceEnv::from_option(workspace))
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFileDeleteRequest {
    pub path: String,
    #[serde(default)]
    pub workspace: WorkspaceEnv,
    pub approved: bool,
    pub document_id: String,
    pub node_id: String,
}

impl WorkflowFileDeleteRequest {
    fn policy_context(&self) -> WorkflowPolicyContext {
        WorkflowPolicyContext {
            approved: self.approved,
            document_id: self.document_id.clone(),
            node_id: self.node_id.clone(),
        }
    }
}

pub fn workflow_file_delete_inner(
    state: &WorkflowCapabilityState,
    request: WorkflowFileDeleteRequest,
) -> Result<(), String> {
    let context = request.policy_context();
    state.execute_workflow_capability(&context, "workflow.file_delete", || {
        ensure_not_sensitive_path(&request.path, &request.workspace)?;
        fs_delete_inner(request.path, request.workspace)
    })
}

#[tauri::command]
pub fn workflow_file_delete(
    state: tauri::State<WorkflowCapabilityState>,
    request: WorkflowFileDeleteRequest,
) -> Result<(), String> {
    workflow_file_delete_inner(&state, request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        fs_create_file_inner(s(f.clone()), WorkspaceEnv::Local).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = fs_create_file_inner(s(f.clone()), WorkspaceEnv::Local).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        fs_create_dir_inner(s(nested.clone()), WorkspaceEnv::Local).expect("create dir");
        assert!(nested.is_dir());
        let err = fs_create_dir_inner(s(nested), WorkspaceEnv::Local).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        fs_rename_inner(s(from.clone()), s(to.clone()), WorkspaceEnv::Local).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err =
            fs_rename_inner(s(from), s(dir.path().join("c.txt")), WorkspaceEnv::Local).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err =
            fs_rename_inner(s(to.clone()), s(occupied.clone()), WorkspaceEnv::Local).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        fs_delete_inner(s(f.clone()), WorkspaceEnv::Local).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        fs_delete_inner(s(sub.clone()), WorkspaceEnv::Local).expect("delete dir");
        assert!(!sub.exists());

        let err = fs_delete_inner(s(dir.path().join("missing")), WorkspaceEnv::Local).unwrap_err();
        assert!(!err.is_empty());
    }

    // Deleting a symlink that points at a directory must remove only the link,
    // never recurse through it and wipe the target's contents.
    #[cfg(unix)]
    #[test]
    fn delete_does_not_follow_symlink_into_target() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"keep").unwrap();

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        fs_delete_inner(s(link.clone()), WorkspaceEnv::Local).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }
}
