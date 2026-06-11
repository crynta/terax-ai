use std::collections::HashSet;
use std::path::Path;
use std::time::UNIX_EPOCH;

use ignore::WalkBuilder;
use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

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
    /// True when git would ignore this entry (`.gitignore`, global excludes, etc.).
    pub gitignored: bool,
}

// Names of immediate children that git does not ignore. Outside a git repo every
// name is treated as visible so nothing is dimmed.
fn git_non_ignored_names(parent: &Path, show_hidden: bool) -> HashSet<String> {
    let walker = WalkBuilder::new(parent)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(false)
        .parents(true)
        .max_depth(Some(1))
        .follow_links(false)
        .build();

    walker
        .flatten()
        .filter_map(|dent| dent.file_name().to_str().map(str::to_string))
        .collect()
}

// find the git root of the repository
fn find_git_root(mut path: &Path) -> Option<std::path::PathBuf> {
    loop {
        if path.join(".git").exists() {
            return Some(path.to_path_buf());
        }
        path = path.parent()?;
    }
}

// True when `dir` or any ancestor below the git root is gitignored.
// dir is the parent directory of the file or directory that is being checked
fn is_under_gitignored_chain(dir: &Path, show_hidden: bool) -> bool {
    let Some(git_root) = find_git_root(dir) else {
        return false;
    };
    let mut current = dir;
    while current.starts_with(&git_root) && current != git_root {
        let Some(parent) = current.parent() else {
            break;
        };
        let Some(name) = current.file_name().and_then(|n| n.to_str()) else {
            break;
        };
        if !git_non_ignored_names(parent, show_hidden).contains(name) {
            return true;
        }
        current = parent;
    }
    false
}

/// Lists immediate children of `path`. Dirs first, then files, each sorted
/// case-insensitively. Dot-prefixed entries (files and dirs) are hidden unless
/// `show_hidden` is set.
#[tauri::command]
pub fn fs_read_dir(
    path: String,
    show_hidden: bool,
    git_decorations: Option<bool>,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("fs_read_dir({}) failed: {e}", root.display());
        e.to_string()
    })?;

    let git_decorations = git_decorations.unwrap_or(true);
    let git_visible = if git_decorations {
        git_non_ignored_names(&root, show_hidden)
    } else {
        HashSet::new()
    };
    let parent_gitignored =
        git_decorations && is_under_gitignored_chain(&root, show_hidden);

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
                gitignored: git_decorations
                    && (parent_gitignored || !git_visible.contains(&name)),
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
