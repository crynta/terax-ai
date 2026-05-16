use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::modules::workspace::{resolve_path, SshConnection, WorkspaceEnv};

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Milliseconds since UNIX epoch; 0 if unavailable.
    pub mtime: u64,
}

/// Lists immediate children of `path`. Dirs first, then files, each sorted
/// case-insensitively. Dot-prefixed entries (files and dirs) are hidden unless
/// `show_hidden` is set.
#[tauri::command]
pub fn fs_read_dir(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);

    // SSH workspace → delegate to remote listing
    if let WorkspaceEnv::Ssh {
        host,
        user,
        port,
        key_path,
        password,
    } = &workspace
    {
        let conn = SshConnection {
            host: host.clone(),
            user: user.clone(),
            port: *port,
            key_path: key_path.clone(),
            password: password.clone(),
            label: None,
        };
        return super::ssh::ssh_read_dir(&conn, &path, show_hidden);
    }

    if let WorkspaceEnv::Wsl { distro } = &workspace {
        return super::wsl::wsl_read_dir(distro, &path, show_hidden);
    }

    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("fs_read_dir({}) failed: {e}", root.display());
        e.to_string()
    })?;

    let mut entries: Vec<DirEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;

            // `metadata()` follows symlinks → it returns the target's stat in
            // one syscall (file_type + size + mtime all derived from it). We
            // fall back to `symlink_metadata` for broken symlinks so we don't
            // silently drop them from the listing.
            let (meta, was_symlink) = match std::fs::metadata(entry.path()) {
                Ok(m) => (Some(m), false),
                Err(_) => (entry.metadata().ok(), true),
            };
            let meta = meta?;

            let kind = if was_symlink {
                EntryKind::Symlink
            } else if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            };

            if name.starts_with('.') && !show_hidden {
                return None;
            }

            let size = meta.len();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            Some(DirEntry {
                name,
                kind,
                size,
                mtime,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        let rank = |k: &EntryKind| match k {
            EntryKind::Dir => 0,
            EntryKind::Symlink => 1,
            EntryKind::File => 2,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Lists immediate subdirectories of `path`. Kept for the CwdBreadcrumb.
///
/// Symlinks to directories are included (matches shell `cd` semantics).
/// Hidden entries are filtered by dot-prefix only.
#[tauri::command]
pub fn list_subdirs(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);

    // SSH workspace → delegate to remote listing
    if let WorkspaceEnv::Ssh {
        host,
        user,
        port,
        key_path,
        password,
    } = &workspace
    {
        let conn = SshConnection {
            host: host.clone(),
            user: user.clone(),
            port: *port,
            key_path: key_path.clone(),
            password: password.clone(),
            label: None,
        };
        return super::ssh::ssh_list_subdirs(&conn, &path, show_hidden);
    }

    if let WorkspaceEnv::Wsl { distro } = &workspace {
        return Ok(super::wsl::wsl_read_dir(distro, &path, show_hidden)?
            .into_iter()
            .filter(|e| matches!(e.kind, super::tree::EntryKind::Dir))
            .map(|e| e.name)
            .collect());
    }

    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("list_subdirs({}) read_dir failed: {e}", root.display());
        e.to_string()
    })?;

    let mut dirs: Vec<String> = read
        .filter_map(Result::ok)
        .filter(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => true,
            Ok(t) if t.is_symlink() => std::fs::metadata(entry.path())
                .map(|m| m.is_dir())
                .unwrap_or(false),
            _ => false,
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| show_hidden || !name.starts_with('.'))
        .collect();

    dirs.sort_by_key(|a| a.to_lowercase());
    Ok(dirs)
}
