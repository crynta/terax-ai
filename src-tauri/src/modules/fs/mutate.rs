use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub async fn fs_create_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_create_file(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        if p.exists() {
            return Err(format!("already exists: {}", p.display()));
        }
        std::fs::write(&p, "").map_err(|e| {
            log::debug!("fs_create_file({}) failed: {e}", p.display());
            e.to_string()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub async fn fs_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_create_dir(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
        if p.exists() {
            return Err(format!("already exists: {}", p.display()));
        }
        std::fs::create_dir_all(&p).map_err(|e| {
            log::debug!("fs_create_dir({}) failed: {e}", p.display());
            e.to_string()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub async fn fs_rename(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_rename(&conn, &from, &to).await;
    }
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub async fn fs_delete(
    path: String,
    workspace: Option<WorkspaceEnv>,
    ssh_state: tauri::State<'_, crate::modules::ssh::SshState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let conn = ssh_state.get_or_err(profile_id)?;
        return crate::modules::ssh::sftp::sftp_delete(&conn, &path).await;
    }
    let p = resolve_path(&path, &workspace);
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}
