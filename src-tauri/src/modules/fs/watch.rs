use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{event::EventKind, recommended_watcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::Emitter;

use super::to_canon;

const FS_CHANGED_EVENT: &str = "fs://changed";

#[derive(Default)]
pub struct FsWatchState {
    inner: Mutex<FsWatchInner>,
}

#[derive(Default)]
struct FsWatchInner {
    watcher: Option<RecommendedWatcher>,
    root: Option<String>,
    canonical_root: Option<PathBuf>,
    watched_paths: HashSet<String>,
}

#[derive(Clone, Serialize)]
struct FsChangedPayload {
    root: String,
    paths: Vec<String>,
}

fn normalize_input_path(path: &str) -> String {
    let normalized = to_canon(PathBuf::from(path));
    if normalized == "/" {
        normalized
    } else {
        normalized.trim_end_matches('/').to_string()
    }
}

fn canonical_watch_path(path: &str) -> Result<PathBuf, String> {
    Path::new(path).canonicalize().map_err(|e| e.to_string())
}

fn should_emit(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_))
}

fn remap_event_path(event_path: PathBuf, canonical_root: &Path, requested_root: &str) -> String {
    match event_path.strip_prefix(canonical_root) {
        Ok(relative) => to_canon(PathBuf::from(requested_root).join(relative)),
        Err(_) => to_canon(event_path),
    }
}

fn should_stop_active_root(active_root: Option<&str>, requested_root: &str) -> bool {
    matches!(active_root, Some(root) if root == requested_root)
}

fn is_inside_active_root(path: &Path, active_root: Option<&Path>) -> bool {
    active_root.is_some_and(|root| path == root || path.starts_with(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_only_matches_active_root() {
        assert!(should_stop_active_root(Some("/workspace"), "/workspace"));
        assert!(!should_stop_active_root(Some("/workspace"), "/other"));
        assert!(!should_stop_active_root(None, "/workspace"));
    }
}

/// Start the filesystem watcher for the workspace root.
///
/// The root itself is watched non-recursively. Expanded directories are added
/// with `fs_watch_add`, keeping watch counts bounded on large home folders.
#[tauri::command]
pub fn fs_watch_start(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<FsWatchState>,
) -> Result<(), String> {
    let root = normalize_input_path(&path);
    let watch_path = canonical_watch_path(&path)?;
    log::info!("fs_watch_start: path={path}, root={root}, watch_path={watch_path:?}");
    let event_root = root.clone();
    let event_canonical_root = watch_path.clone();

    let mut watcher =
        recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                log::debug!(
                    "watcher event: kind={:?}, paths={:?}",
                    event.kind,
                    event.paths
                );
                if !should_emit(&event.kind) {
                    return;
                }

                let paths = event
                    .paths
                    .into_iter()
                    .map(|path| remap_event_path(path, &event_canonical_root, &event_root))
                    .collect::<Vec<_>>();

                if paths.is_empty() {
                    return;
                }

                log::info!("emitting {FS_CHANGED_EVENT}: root={event_root}, paths={paths:?}");
                if let Err(e) = app.emit(
                    FS_CHANGED_EVENT,
                    FsChangedPayload {
                        root: event_root.clone(),
                        paths,
                    },
                ) {
                    log::warn!("failed to emit {FS_CHANGED_EVENT}: {e}");
                }
            }
            Err(e) => log::warn!("filesystem watcher error for {event_root}: {e}"),
        })
        .map_err(|e| e.to_string())?;

    // Watch only the root directory. Subdirectories are added lazily
    // via fs_watch_add when the user expands them in the explorer.
    // This avoids hitting the inotify limit on large directory trees.
    watcher
        .watch(&watch_path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    log::info!("watcher started for {root} (canonical: {watch_path:?}), watching root only");

    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.watched_paths.clear();
    inner
        .watched_paths
        .insert(watch_path.to_string_lossy().to_string());
    inner.root = Some(root);
    inner.canonical_root = Some(watch_path);
    inner.watcher = Some(watcher);
    Ok(())
}

/// Stop all filesystem watchers.
#[tauri::command]
pub fn fs_watch_stop(path: String, state: tauri::State<FsWatchState>) -> Result<(), String> {
    let requested_root = normalize_input_path(&path);
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    if !should_stop_active_root(inner.root.as_deref(), &requested_root) {
        log::debug!(
            "fs_watch_stop ignored: requested={requested_root}, active={:?}",
            inner.root
        );
        return Ok(());
    }

    log::info!("fs_watch_stop: path={path}, root={requested_root}");
    inner.watcher = None;
    inner.root = None;
    inner.canonical_root = None;
    inner.watched_paths.clear();
    Ok(())
}

/// Add a single directory to the watcher (non-recursive).
/// Used for lazy watching: only watch directories the user has expanded.
#[tauri::command]
pub fn fs_watch_add(path: String, state: tauri::State<FsWatchState>) -> Result<(), String> {
    let normalized = normalize_input_path(&path);
    let canonical = canonical_watch_path(&path)?;

    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    if !is_inside_active_root(&canonical, inner.canonical_root.as_deref()) {
        log::debug!("fs_watch_add ignored outside active root: {normalized}");
        return Ok(());
    }

    let key = canonical.to_string_lossy().to_string();
    if inner.watched_paths.contains(&key) {
        return Ok(()); // Already watching
    }

    if let Some(ref mut watcher) = inner.watcher {
        match watcher.watch(&canonical, RecursiveMode::NonRecursive) {
            Ok(()) => {
                inner.watched_paths.insert(key);
                log::info!("fs_watch_add: watching {normalized} (canonical: {canonical:?})");
            }
            Err(e) => {
                log::warn!("fs_watch_add: cannot watch {normalized}: {e}");
                return Err(e.to_string());
            }
        }
    }
    Ok(())
}

/// Remove a single directory from the watcher.
#[tauri::command]
pub fn fs_watch_remove(path: String, state: tauri::State<FsWatchState>) -> Result<(), String> {
    let normalized = normalize_input_path(&path);
    let canonical = canonical_watch_path(&path)?;

    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    let key = canonical.to_string_lossy().to_string();
    if !inner.watched_paths.contains(&key) {
        return Ok(()); // Not watching
    }

    if let Some(ref mut watcher) = inner.watcher {
        match watcher.unwatch(&canonical) {
            Ok(()) => {
                inner.watched_paths.remove(&key);
                log::info!("fs_watch_remove: stopped watching {normalized}");
            }
            Err(e) => {
                log::warn!("fs_watch_remove: cannot unwatch {normalized}: {e}");
                return Err(e.to_string());
            }
        }
    }
    Ok(())
}
