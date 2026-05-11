use std::path::PathBuf;

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(path: String) -> Result<(), String> {
    if let Some(remote) = super::remote::parse_remote_path(&path) {
        return super::remote::create_file(&remote?);
    }

    let p = PathBuf::from(&path);
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
pub fn fs_create_dir(path: String) -> Result<(), String> {
    if let Some(remote) = super::remote::parse_remote_path(&path) {
        return super::remote::create_dir(&remote?);
    }

    let p = PathBuf::from(&path);
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
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    match (
        super::remote::parse_remote_path(&from),
        super::remote::parse_remote_path(&to),
    ) {
        (Some(from_remote), Some(to_remote)) => {
            return super::remote::rename(&from_remote?, &to_remote?);
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err("rename between local and remote paths is not supported".to_string());
        }
        (None, None) => {}
    }

    let from_p = PathBuf::from(&from);
    let to_p = PathBuf::from(&to);
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

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    if let Some(remote) = super::remote::parse_remote_path(&path) {
        return super::remote::delete(&remote?);
    }

    let p = PathBuf::from(&path);
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
