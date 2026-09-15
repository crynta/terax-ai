use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};
use serde::Serialize;
use std::io;
use std::path::Path;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum FsMoveResult {
    Moved,
    Conflict { replaceable: bool, token: String },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDeleteBatchResult {
    deleted: Vec<String>,
    failed: usize,
}

fn metadata_if_exists(path: &Path) -> io::Result<Option<std::fs::Metadata>> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn is_conflict(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
    )
}

fn resolve_authorized_root(
    root: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<std::path::PathBuf, String> {
    let resolved = resolve_path(root, workspace);
    let canonical = registry
        .canonicalize_cached(resolved)
        .map_err(|error| format!("workspace root is not accessible: {error}"))?;
    if registry.is_authorized(&canonical) {
        Ok(canonical)
    } else {
        Err(format!(
            "workspace root is not authorized: {}",
            canonical.display()
        ))
    }
}

fn authorize_mutation_entry(path: &Path, root: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    let canonical = std::fs::canonicalize(parent)
        .map_err(|error| format!("path parent is not accessible: {error}"))?;
    if canonical.starts_with(root) {
        Ok(())
    } else {
        Err(format!(
            "path is outside the authorized workspace: {}",
            path.display()
        ))
    }
}

#[cfg(unix)]
fn conflict_token(metadata: &std::fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!(
        "{}:{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.mode(),
        metadata.size(),
        metadata.mtime(),
        metadata.mtime_nsec()
    )
}

#[cfg(target_os = "windows")]
fn conflict_token(metadata: &std::fs::Metadata) -> String {
    use std::os::windows::fs::MetadataExt;
    format!(
        "{}:{}:{}:{}",
        metadata.file_attributes(),
        metadata.creation_time(),
        metadata.last_write_time(),
        metadata.file_size()
    )
}

#[cfg(not(any(unix, target_os = "windows")))]
fn conflict_token(metadata: &std::fs::Metadata) -> String {
    use std::time::UNIX_EPOCH;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos());
    format!("{}:{modified}", metadata.len())
}

fn move_conflict(metadata: &std::fs::Metadata, replaceable: bool) -> FsMoveResult {
    FsMoveResult::Conflict {
        replaceable,
        token: conflict_token(metadata),
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a NUL byte"))
}

#[cfg(target_os = "macos")]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let from = c_path(from)?;
    let to = c_path(to)?;
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let from = c_path(from)?;
    let to = c_path(to)?;
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "windows")]
fn move_file_windows(from: &Path, to: &Path, replace: bool) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let flags = MOVEFILE_WRITE_THROUGH
        | if replace {
            MOVEFILE_REPLACE_EXISTING
        } else {
            0
        };
    let result = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "windows")]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    move_file_windows(from, to, false)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    if metadata_if_exists(to)?.is_some() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "destination already exists",
        ));
    }
    std::fs::rename(from, to)
}

#[cfg(unix)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::rename(from, to)
}

#[cfg(target_os = "windows")]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    move_file_windows(from, to, true)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::rename(from, to)
}

fn remove_path(path: &Path) -> io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(from: String, to: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Moves a path without clobbering unless replacement was explicitly approved.
#[tauri::command]
pub fn fs_move(
    from: String,
    to: String,
    root: String,
    expected_conflict: Option<String>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<FsMoveResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root = resolve_authorized_root(&root, &workspace, &registry)?;
    fs_move_impl(&from, &to, &root, expected_conflict.as_deref(), &workspace)
}

fn fs_move_impl(
    from: &str,
    to: &str,
    root: &Path,
    expected_conflict: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<FsMoveResult, String> {
    let from_p = resolve_path(from, workspace);
    let to_p = resolve_path(to, workspace);
    authorize_mutation_entry(&from_p, root)?;
    authorize_mutation_entry(&to_p, root)?;
    if from_p == to_p {
        return Ok(FsMoveResult::Moved);
    }
    let from_meta = metadata_if_exists(&from_p)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("not found: {}", from_p.display()))?;
    let to_meta = metadata_if_exists(&to_p).map_err(|error| error.to_string())?;

    if let Some(to_meta) = to_meta {
        let replaceable = !from_meta.is_dir() && !to_meta.is_dir();
        let token = conflict_token(&to_meta);
        if !replaceable || expected_conflict != Some(token.as_str()) {
            return Ok(FsMoveResult::Conflict { replaceable, token });
        }
        replace_file(&from_p, &to_p).map_err(|error| {
            log::warn!(
                "fs_move replace({} -> {}) failed: {error}",
                from_p.display(),
                to_p.display()
            );
            error.to_string()
        })?;
        return Ok(FsMoveResult::Moved);
    }

    match rename_no_replace(&from_p, &to_p) {
        Ok(()) => Ok(FsMoveResult::Moved),
        Err(error) if is_conflict(&error) => {
            let to_meta = metadata_if_exists(&to_p)
                .map_err(|metadata_error| metadata_error.to_string())?
                .ok_or_else(|| "destination changed while moving".to_string())?;
            let replaceable = !from_meta.is_dir() && !to_meta.is_dir();
            Ok(move_conflict(&to_meta, replaceable))
        }
        Err(error) => {
            log::warn!(
                "fs_move({} -> {}) failed: {error}",
                from_p.display(),
                to_p.display()
            );
            Err(error.to_string())
        }
    }
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    remove_path(&p).map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[tauri::command]
pub fn fs_delete_batch(
    paths: Vec<String>,
    root: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> FsDeleteBatchResult {
    let workspace = WorkspaceEnv::from_option(workspace);
    let Ok(root) = resolve_authorized_root(&root, &workspace, &registry) else {
        return FsDeleteBatchResult {
            deleted: Vec::new(),
            failed: paths.len(),
        };
    };
    fs_delete_batch_impl(paths, &root, &workspace)
}

fn fs_delete_batch_impl(
    paths: Vec<String>,
    root: &Path,
    workspace: &WorkspaceEnv,
) -> FsDeleteBatchResult {
    let mut deleted = Vec::with_capacity(paths.len());
    let mut failed = 0;
    for path in paths {
        let resolved = resolve_path(&path, workspace);
        let result = authorize_mutation_entry(&resolved, root)
            .and_then(|()| remove_path(&resolved).map_err(|error| error.to_string()));
        match result {
            Ok(()) => deleted.push(path),
            Err(error) => {
                failed += 1;
                log::warn!("fs_delete_batch({}) failed: {error}", resolved.display());
            }
        }
    }
    FsDeleteBatchResult { deleted, failed }
}

fn copy_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
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
    sources: Vec<String>,
    dest_dir: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    fn move_path(
        root: &Path,
        from: &Path,
        to: &Path,
        expected_conflict: Option<&str>,
    ) -> Result<FsMoveResult, String> {
        let root = std::fs::canonicalize(root).unwrap();
        fs_move_impl(
            &s(from.to_path_buf()),
            &s(to.to_path_buf()),
            &root,
            expected_conflict,
            &WorkspaceEnv::Local,
        )
    }

    fn conflict(result: FsMoveResult) -> (bool, String) {
        match result {
            FsMoveResult::Conflict { replaceable, token } => (replaceable, token),
            FsMoveResult::Moved => panic!("expected conflict"),
        }
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        fs_create_file(s(f.clone()), None).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = fs_create_file(s(f.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        fs_create_dir(s(nested.clone()), None).expect("create dir");
        assert!(nested.is_dir());
        let err = fs_create_dir(s(nested), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        fs_rename(s(from.clone()), s(to.clone()), None).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err = fs_rename(s(from), s(dir.path().join("c.txt")), None).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err = fs_rename(s(to.clone()), s(occupied.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn move_reports_conflict_without_changing_either_file() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from.txt");
        let to = dir.path().join("to.txt");
        std::fs::write(&from, b"from").unwrap();
        std::fs::write(&to, b"to").unwrap();

        let result = move_path(dir.path(), &from, &to, None).unwrap();

        assert!(conflict(result).0);
        assert_eq!(std::fs::read(from).unwrap(), b"from");
        assert_eq!(std::fs::read(to).unwrap(), b"to");
    }

    #[cfg(unix)]
    #[test]
    fn move_treats_a_broken_destination_symlink_as_a_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from.txt");
        let to = dir.path().join("to.txt");
        std::fs::write(&from, b"from").unwrap();
        std::os::unix::fs::symlink(dir.path().join("missing"), &to).unwrap();

        let result = move_path(dir.path(), &from, &to, None).unwrap();

        assert!(conflict(result).0);
        assert_eq!(std::fs::read(from).unwrap(), b"from");
        assert!(std::fs::symlink_metadata(to)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn move_result_serializes_the_frontend_contract() {
        assert_eq!(
            serde_json::to_value(FsMoveResult::Conflict {
                replaceable: false,
                token: "opaque".into()
            })
            .unwrap(),
            serde_json::json!({
                "status": "conflict",
                "replaceable": false,
                "token": "opaque"
            })
        );
        assert_eq!(
            serde_json::to_value(FsMoveResult::Moved).unwrap(),
            serde_json::json!({ "status": "moved" })
        );
    }

    #[test]
    fn move_replaces_a_file_after_explicit_approval() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from.txt");
        let to = dir.path().join("to.txt");
        std::fs::write(&from, b"new").unwrap();
        std::fs::write(&to, b"old").unwrap();

        let (_, token) = conflict(move_path(dir.path(), &from, &to, None).unwrap());
        let result = move_path(dir.path(), &from, &to, Some(&token)).unwrap();

        assert_eq!(result, FsMoveResult::Moved);
        assert!(!from.exists());
        assert_eq!(std::fs::read(to).unwrap(), b"new");
    }

    #[test]
    fn move_does_not_replace_a_conflict_that_changed_after_approval() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from.txt");
        let to = dir.path().join("to.txt");
        std::fs::write(&from, b"new").unwrap();
        std::fs::write(&to, b"old").unwrap();
        let (_, token) = conflict(move_path(dir.path(), &from, &to, None).unwrap());
        std::fs::write(&to, b"changed after prompt").unwrap();

        let result = move_path(dir.path(), &from, &to, Some(&token)).unwrap();

        assert!(conflict(result).0);
        assert_eq!(std::fs::read(from).unwrap(), b"new");
        assert_eq!(std::fs::read(to).unwrap(), b"changed after prompt");
    }

    #[test]
    fn move_rejects_paths_outside_the_authorized_workspace() {
        let allowed = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let from = outside.path().join("from.txt");
        let to = allowed.path().join("to.txt");
        std::fs::write(&from, b"keep").unwrap();
        let root = std::fs::canonicalize(allowed.path()).unwrap();

        let error =
            fs_move_impl(&s(from.clone()), &s(to), &root, None, &WorkspaceEnv::Local).unwrap_err();

        assert!(error.contains("outside the authorized workspace"));
        assert_eq!(std::fs::read(from).unwrap(), b"keep");
    }

    #[test]
    fn move_refuses_to_replace_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from");
        let to = dir.path().join("to");
        std::fs::create_dir(&from).unwrap();
        std::fs::create_dir(&to).unwrap();
        std::fs::write(from.join("new.txt"), b"new").unwrap();
        std::fs::write(to.join("old.txt"), b"old").unwrap();

        let result = move_path(dir.path(), &from, &to, None).unwrap();

        assert!(!conflict(result).0);
        assert_eq!(std::fs::read(from.join("new.txt")).unwrap(), b"new");
        assert_eq!(std::fs::read(to.join("old.txt")).unwrap(), b"old");
    }

    #[test]
    fn copy_brings_file_and_dir_in_and_refuses_clobber() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"payload").unwrap();
        std::fs::create_dir_all(src.path().join("d/inner")).unwrap();
        std::fs::write(src.path().join("d/inner/y.txt"), b"y").unwrap();

        fs_copy(
            vec![s(src.path().join("a.txt")), s(src.path().join("d"))],
            s(dest.path().to_path_buf()),
            None,
        )
        .expect("copy");

        assert_eq!(
            std::fs::read(dest.path().join("a.txt")).unwrap(),
            b"payload"
        );
        assert_eq!(
            std::fs::read(dest.path().join("d/inner/y.txt")).unwrap(),
            b"y"
        );
        // copy, not move: the source survives.
        assert!(src.path().join("a.txt").exists());

        let err = fs_copy(
            vec![s(src.path().join("a.txt"))],
            s(dest.path().to_path_buf()),
            None,
        )
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        fs_delete(s(f.clone()), None).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        fs_delete(s(sub.clone()), None).expect("delete dir");
        assert!(!sub.exists());

        let err = fs_delete(s(dir.path().join("missing")), None).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn batch_delete_reports_each_success_and_failure() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.txt");
        let second = dir.path().join("second.txt");
        let missing = dir.path().join("missing.txt");
        std::fs::write(&first, b"first").unwrap();
        std::fs::write(&second, b"second").unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let paths = vec![s(first.clone()), s(missing), s(second.clone())];

        let result = fs_delete_batch_impl(paths.clone(), &root, &WorkspaceEnv::Local);

        assert_eq!(result.deleted, vec![paths[0].clone(), paths[2].clone()]);
        assert_eq!(result.failed, 1);
        assert!(!first.exists());
        assert!(!second.exists());
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

        fs_delete(s(link.clone()), None).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }
}
