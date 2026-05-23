use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    fs_create_file_impl(&path, workspace, &registry)
}

pub fn fs_create_file_impl(
    path: &str,
    workspace: Option<WorkspaceEnv>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(path, &workspace);
    super::authorize_create_target(registry, &p)?;
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            log::debug!("fs_create_file({}) parent create failed: {e}", p.display());
            e.to_string()
        })?;
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
pub fn fs_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    fs_create_dir_impl(&path, workspace, &registry)
}

pub fn fs_create_dir_impl(
    path: &str,
    workspace: Option<WorkspaceEnv>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(path, &workspace);
    super::authorize_create_target(registry, &p)?;
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
pub fn fs_rename(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    fs_rename_impl(&from, &to, workspace, &registry)
}

pub fn fs_rename_impl(
    from: &str,
    to: &str,
    workspace: Option<WorkspaceEnv>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(from, &workspace);
    let to_p = resolve_path(to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    super::authorize_entry_path(registry, &from_p)?;
    super::authorize_create_target(registry, &to_p)?;
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    fs_delete_impl(&path, workspace, &registry)
}

pub fn fs_delete_impl(
    path: &str,
    workspace: Option<WorkspaceEnv>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;
    super::authorize_entry_path(registry, &p)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    fn registry_for(path: &std::path::Path) -> WorkspaceRegistry {
        let registry = WorkspaceRegistry::default();
        registry.authorize(path).expect("authorize workspace");
        registry
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry_for(dir.path());
        let f = dir.path().join("new.txt");
        fs_create_file_impl(&s(f.clone()), None, &registry).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = fs_create_file_impl(&s(f.clone()), None, &registry).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry_for(dir.path());
        let nested = dir.path().join("a/b/c");
        fs_create_dir_impl(&s(nested.clone()), None, &registry).expect("create dir");
        assert!(nested.is_dir());
        let err = fs_create_dir_impl(&s(nested), None, &registry).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry_for(dir.path());
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        fs_rename_impl(&s(from.clone()), &s(to.clone()), None, &registry).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err =
            fs_rename_impl(&s(from), &s(dir.path().join("c.txt")), None, &registry).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err =
            fs_rename_impl(&s(to.clone()), &s(occupied.clone()), None, &registry).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry_for(dir.path());
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        fs_delete_impl(&s(f.clone()), None, &registry).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        fs_delete_impl(&s(sub.clone()), None, &registry).expect("delete dir");
        assert!(!sub.exists());

        let err = fs_delete_impl(&s(dir.path().join("missing")), None, &registry).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn create_and_rename_reject_unauthorized_destinations() {
        let allowed = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let registry = registry_for(allowed.path());

        let err =
            fs_create_file_impl(&s(outside.path().join("new.txt")), None, &registry).unwrap_err();
        assert!(err.contains("outside authorized workspace"), "got: {err}");

        let err =
            fs_create_dir_impl(&s(outside.path().join("nested")), None, &registry).unwrap_err();
        assert!(err.contains("outside authorized workspace"), "got: {err}");

        let source = allowed.path().join("source.txt");
        std::fs::write(&source, b"payload").unwrap();
        let err = fs_rename_impl(
            &s(source),
            &s(outside.path().join("dest.txt")),
            None,
            &registry,
        )
        .unwrap_err();
        assert!(err.contains("outside authorized workspace"), "got: {err}");
    }

    #[test]
    fn create_and_rename_allow_nested_authorized_paths() {
        let allowed = tempfile::tempdir().unwrap();
        let registry = registry_for(allowed.path());
        let nested_file = allowed.path().join("a/b/c.txt");
        fs_create_file_impl(&s(nested_file.clone()), None, &registry).expect("create nested file");
        assert!(nested_file.exists());

        let from = allowed.path().join("from.txt");
        let to = allowed.path().join("deep/to.txt");
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::write(&from, b"payload").unwrap();
        fs_rename_impl(&s(from), &s(to.clone()), None, &registry).expect("rename nested");
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");
    }

    #[test]
    fn delete_rejects_unauthorized_path() {
        let allowed = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let registry = registry_for(allowed.path());
        let victim = outside.path().join("victim.txt");
        std::fs::write(&victim, b"keep").unwrap();

        let err = fs_delete_impl(&s(victim.clone()), None, &registry).unwrap_err();
        assert!(err.contains("outside authorized workspace"), "got: {err}");
        assert_eq!(std::fs::read(&victim).unwrap(), b"keep");
    }

    // Deleting a symlink that points at a directory must remove only the link,
    // never recurse through it and wipe the target's contents.
    #[cfg(unix)]
    #[test]
    fn delete_does_not_follow_symlink_into_target() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry_for(dir.path());
        let outside = tempfile::tempdir().unwrap();
        let real = outside.path().join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"keep").unwrap();

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        fs_delete_impl(&s(link.clone()), None, &registry).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }
}
