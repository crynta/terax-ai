//! Live directory change notifications for the explorer and editor tabs.
//!
//! The frontend registers the directories it shows (and the files open in
//! editors) and receives debounced `fs:changed` events carrying the watched
//! directories that changed plus any registered file whose own stamp moved.
//! Backends only report directory-level activity, so a package install or a
//! build never turns into per-file work here.

mod plan;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod portable;

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use super::blocking;
use super::index::FileIndexState;
use super::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};
use plan::{Batch, DirSet, FileStamp, Pending, WatchSet};

// Quiet-gap before a batch flushes; MAX_WINDOW caps latency under a long stream.
const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_WINDOW: Duration = Duration::from_millis(1000);
// The WSL 9P share delivers no change notifications, so its directories are re-listed on this
// interval instead. Slow enough that an idle explorer costs almost nothing over the share.
const WSL_POLL_INTERVAL: Duration = Duration::from_millis(1500);

#[cfg(target_os = "macos")]
type PlatformBackend = macos::FsEvents;
#[cfg(not(target_os = "macos"))]
type PlatformBackend = portable::Notify;

trait Backend: Send {
    /// Brings the OS watches in line with `set`. Called after every change to
    /// the set; implementations must be a no-op when nothing relevant moved.
    fn sync(&mut self, set: &WatchSet);
}

/// What a backend callback needs: the live set of watched directories to
/// filter against, a way to report a batch, and the file-list cache.
#[derive(Clone)]
struct Sink {
    tx: mpsc::Sender<Batch>,
    dirs: Arc<RwLock<Arc<DirSet>>>,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    index: FileIndexState,
}

impl Sink {
    fn send(&self, batch: Batch) {
        if !batch.is_empty() {
            let _ = self.tx.send(batch);
        }
    }

    fn dirs(&self) -> Arc<DirSet> {
        self.dirs.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Any directory-level change, watched or not, can stale a file list.
    #[cfg(target_os = "macos")]
    fn note_path(&self, path: &[u8]) {
        if let Ok(text) = std::str::from_utf8(path) {
            self.index.note_change(text);
        }
    }
}

struct Shared {
    set: Mutex<WatchSet>,
    dirs: Arc<RwLock<Arc<DirSet>>>,
}

struct Running {
    shared: Arc<Shared>,
    backend: Box<dyn Backend>,
}

#[derive(Default)]
pub struct FsWatchState {
    inner: Mutex<Option<Running>>,
}

#[derive(Clone, serde::Serialize)]
struct ChangedPayload {
    paths: Vec<String>,
}

fn start(app: &AppHandle) -> Result<Running, String> {
    let (tx, rx) = mpsc::channel::<Batch>();
    // Kept for the poller: the backends take their own clones inside the sink.
    let poll_tx = tx.clone();
    let shared = Arc::new(Shared {
        set: Mutex::new(WatchSet::default()),
        dirs: Arc::new(RwLock::new(Arc::new(DirSet::new()))),
    });
    let index = app.state::<FileIndexState>().inner().clone();
    let sink = Sink {
        tx,
        dirs: shared.dirs.clone(),
        index: index.clone(),
    };
    let backend: Box<dyn Backend> = Box::new(PlatformBackend::new(sink)?);

    let drain_shared = shared.clone();
    let app = app.clone();
    std::thread::Builder::new()
        .name("terax-fs-watch".into())
        .stack_size(256 * 1024)
        .spawn(move || drain_loop(rx, drain_shared, app, index))
        .map_err(|e| e.to_string())?;

    // Feeds the same channel as the backends, so polling reuses debounce, `resolve_changes`
    // and the `fs:changed` emit instead of duplicating them.
    let poll_shared = shared.clone();
    std::thread::Builder::new()
        .name("terax-fs-poll".into())
        .stack_size(256 * 1024)
        .spawn(move || poll_loop(poll_tx, poll_shared))
        .map_err(|e| e.to_string())?;
    Ok(Running { shared, backend })
}

/// Re-lists the directories on the WSL share on a timer: their backend never reports, so a
/// change would otherwise stay invisible until the tree is reloaded by hand.
fn poll_loop(tx: mpsc::Sender<Batch>, shared: Arc<Shared>) {
    loop {
        std::thread::sleep(WSL_POLL_INTERVAL);
        if !poll_once(&tx, &shared) {
            return;
        }
    }
}

/// One tick. Returns false once the drain loop is gone and nothing can consume a batch.
fn poll_once(tx: &mpsc::Sender<Batch>, shared: &Shared) -> bool {
    // Copied out and read outside the lock, like `resolve_changes`: add/remove never wait
    // for the share, and an idle explorer costs one empty check per tick.
    let polled = {
        let set = shared.set.lock().unwrap_or_else(|e| e.into_inner());
        set.polled_dirs()
    };
    if polled.is_empty() {
        return true;
    }
    let signatures: Vec<Option<u64>> = polled
        .iter()
        .map(|(_, path)| plan::listing_signature(path))
        .collect();
    let moved: Vec<String> = {
        let set = shared.set.lock().unwrap_or_else(|e| e.into_inner());
        polled
            .iter()
            .zip(signatures)
            .filter(|((key, _), signature)| set.listing_moved(key, *signature))
            .map(|((key, _), _)| key.clone())
            .collect()
    };
    if moved.is_empty() {
        return true;
    }
    // `resolve_changes` re-reads and remembers the listing: the poller only decides that
    // something moved.
    tx.send(Batch {
        dirs: moved,
        subtrees: Vec::new(),
    })
    .is_ok()
}

fn drain_loop(
    rx: mpsc::Receiver<Batch>,
    shared: Arc<Shared>,
    app: AppHandle,
    index: FileIndexState,
) {
    loop {
        let Ok(first) = rx.recv() else { return };
        let mut pending = Pending::default();
        pending.merge(first);

        let deadline = Instant::now() + MAX_WINDOW;
        loop {
            let timeout = DEBOUNCE.min(deadline.saturating_duration_since(Instant::now()));
            match rx.recv_timeout(timeout) {
                Ok(batch) => pending.merge(batch),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if Instant::now() >= deadline {
                break;
            }
        }

        let Changes { touched, report } = resolve_changes(pending, &shared);
        // The file list cache hears about every touched directory, whether or not the
        // frontend does: an edited ignore file changes the list without changing a name.
        for path in &touched {
            index.note_change(path);
        }
        if report.is_empty() {
            continue;
        }
        let _ = app.emit("fs:changed", ChangedPayload { paths: report });
    }
}

/// What one burst resolved to.
struct Changes {
    /// Watched directories the backend reported.
    touched: Vec<String>,
    /// What the frontend is told: the touched directories whose listing moved, plus registered
    /// files inside them whose stamp moved.
    report: Vec<String>,
}

/// Watched directories that changed, plus registered files inside them whose
/// stamp moved. A directory whose listing is the one the frontend already has (a file edited
/// in place, a build rewriting a file) is left out: see `WatchSet::listing_changed`.
fn resolve_changes(pending: Pending, shared: &Shared) -> Changes {
    let (touched, locations) = {
        let set = shared.set.lock().unwrap_or_else(|e| e.into_inner());
        let touched = pending.resolve(set.dir_keys());
        let locations: Vec<Option<PathBuf>> = touched.iter().map(|dir| set.dir_path(dir)).collect();
        (touched, locations)
    };
    // Reading the directories happens outside the lock: add/remove never wait for the disk.
    let signatures: Vec<Option<u64>> = locations
        .iter()
        .map(|path| path.as_deref().and_then(plan::listing_signature))
        .collect();
    let mut set = shared.set.lock().unwrap_or_else(|e| e.into_inner());
    let stamp_of = |path: &str| FileStamp::of(std::path::Path::new(path));
    let mut report = Vec::new();
    for (dir, signature) in touched.iter().zip(signatures) {
        if set.listing_changed(dir, signature) {
            report.push(dir.clone());
        }
        report.extend(set.changed_files_in(dir, &stamp_of));
    }
    Changes { touched, report }
}

// Canonical keys keep add/remove symmetric regardless of how the path was spelled.
fn prepare_dirs(
    registry: &WorkspaceRegistry,
    workspace: &WorkspaceEnv,
    paths: Vec<String>,
) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter_map(|raw| {
            let resolved = resolve_path(&raw, workspace);
            let canonical = std::fs::canonicalize(&resolved).ok()?;
            if !canonical.is_dir()
                || plan::is_skipped(&canonical)
                || !registry.is_authorized(&canonical)
            {
                return None;
            }
            Some(canonical)
        })
        .collect()
}

/// A file is identified by its canonical directory plus its own name, so the
/// path we report matches what editor tabs store even when the file itself no
/// longer exists.
fn canonical_file(workspace: &WorkspaceEnv, raw: &str) -> Option<(String, String, PathBuf)> {
    let resolved = resolve_path(raw, workspace);
    let name = resolved.file_name()?.to_owned();
    let parent = std::fs::canonicalize(resolved.parent()?).ok()?;
    let file = parent.join(name);
    Some((to_canon(&parent), to_canon(&file), file))
}

impl FsWatchState {
    fn with_running<T>(
        &self,
        app: &AppHandle,
        create: bool,
        f: impl FnOnce(&mut Running) -> T,
    ) -> Result<Option<T>, String> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            if !create {
                return Ok(None);
            }
            *guard = Some(start(app)?);
        }
        Ok(guard.as_mut().map(f))
    }
}

impl Running {
    /// `change` reports whether the set of watched directories moved; file
    /// bookkeeping alone never touches the OS watches.
    fn apply(&mut self, change: impl FnOnce(&mut WatchSet) -> bool) {
        let mut set = self.shared.set.lock().unwrap_or_else(|e| e.into_inner());
        if !change(&mut set) {
            return;
        }
        *self.shared.dirs.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(set.snapshot());
        self.backend.sync(&set);
    }
}

#[tauri::command]
pub async fn fs_watch_add(
    app: AppHandle,
    paths: Vec<String>,
    files: Option<Vec<String>>,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let dirs = prepare_dirs(&app.state::<WorkspaceRegistry>(), &workspace, paths);
        let files: Vec<_> = files
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| canonical_file(&workspace, raw))
            .map(|(dir, key, path)| {
                let stamp = FileStamp::of(&path);
                (dir, key, stamp)
            })
            .collect();
        if dirs.is_empty() && files.is_empty() {
            return Ok(());
        }
        // Taken before the OS watch starts (inside `apply`), so a change after it differs.
        let baselines: Vec<Option<u64>> = dirs
            .iter()
            .map(|dir| plan::listing_signature(dir))
            .collect();
        app.state::<FsWatchState>()
            .with_running(&app, true, |running| {
                running.apply(|set| {
                    let mut moved = false;
                    for (dir, signature) in dirs.into_iter().zip(baselines) {
                        let key = to_canon(&dir);
                        // A `/mnt/<drive>` workspace path already became a native drive path in
                        // `prepare_dirs`; what is left on the share can never notify.
                        let poll = plan::is_wsl_share(&key);
                        if set.add_dir(key.clone(), dir, poll) {
                            set.record_listing(&key, signature);
                            moved = true;
                        }
                    }
                    for (dir, key, stamp) in files {
                        set.add_file(dir, key, stamp);
                    }
                    moved
                });
            })?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn fs_watch_remove(
    app: AppHandle,
    paths: Vec<String>,
    files: Option<Vec<String>>,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        // A removed/renamed dir no longer canonicalizes; fall back so the
        // refcount entry is still released.
        let dirs: Vec<String> = paths
            .into_iter()
            .map(|raw| {
                let resolved = resolve_path(&raw, &workspace);
                to_canon(std::fs::canonicalize(&resolved).unwrap_or(resolved))
            })
            .collect();
        let files: Vec<(String, String)> = files
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| canonical_file(&workspace, raw))
            .map(|(dir, key, _)| (dir, key))
            .collect();
        app.state::<FsWatchState>()
            .with_running(&app, false, |running| {
                running.apply(|set| {
                    let mut moved = false;
                    for dir in &dirs {
                        moved |= set.remove_dir(dir);
                    }
                    for (dir, key) in &files {
                        set.remove_file(dir, key);
                    }
                    moved
                });
            })?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_watching(dir: &std::path::Path) -> Shared {
        let key = to_canon(dir);
        let mut set = WatchSet::default();
        assert!(set.add_dir(key.clone(), dir.to_path_buf(), false));
        set.record_listing(&key, plan::listing_signature(dir));
        Shared {
            set: Mutex::new(set),
            dirs: Arc::new(RwLock::new(Arc::new(DirSet::new()))),
        }
    }

    fn burst(dir: &std::path::Path) -> Pending {
        let mut pending = Pending::default();
        pending.merge(Batch {
            dirs: vec![to_canon(dir)],
            subtrees: Vec::new(),
        });
        pending
    }

    fn shared_polling(dir: &std::path::Path) -> Shared {
        let key = to_canon(dir);
        let mut set = WatchSet::default();
        assert!(set.add_dir(key.clone(), dir.to_path_buf(), true));
        set.record_listing(&key, plan::listing_signature(dir));
        Shared {
            set: Mutex::new(set),
            dirs: Arc::new(RwLock::new(Arc::new(DirSet::new()))),
        }
    }

    #[test]
    fn a_polled_directory_reaches_the_frontend_through_the_backend_batch_path() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.ts"), "one").unwrap();
        let shared = shared_polling(dir.path());
        let (tx, rx) = mpsc::channel::<Batch>();

        assert!(poll_once(&tx, &shared));
        assert!(rx.try_recv().is_err(), "an unchanged listing is not a tick");

        std::fs::write(dir.path().join("b.ts"), "").unwrap();
        assert!(poll_once(&tx, &shared));
        let batch = rx.try_recv().expect("the moved listing is a batch");
        assert_eq!(batch.dirs, vec![to_canon(dir.path())]);
        assert!(batch.subtrees.is_empty());

        // The batch takes the normal resolve path, which remembers the listing.
        let mut pending = Pending::default();
        pending.merge(batch);
        let changes = resolve_changes(pending, &shared);
        assert_eq!(changes.report, vec![to_canon(dir.path())]);

        assert!(poll_once(&tx, &shared));
        assert!(
            rx.try_recv().is_err(),
            "the new listing is now the baseline"
        );
    }

    #[test]
    fn a_polled_directory_that_cannot_be_read_does_not_report_every_tick() {
        let dir = tempfile::tempdir().unwrap();
        let shared = shared_polling(dir.path());
        let (tx, rx) = mpsc::channel::<Batch>();
        std::fs::remove_dir_all(dir.path()).unwrap();

        assert!(poll_once(&tx, &shared));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn the_poller_stops_once_nothing_consumes_batches() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.ts"), "one").unwrap();
        let shared = shared_polling(dir.path());
        let (tx, rx) = mpsc::channel::<Batch>();
        drop(rx);

        std::fs::write(dir.path().join("b.ts"), "").unwrap();
        assert!(!poll_once(&tx, &shared), "a dead channel ends the loop");
    }

    #[test]
    fn edits_in_place_reach_the_index_but_not_the_frontend() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.ts"), "one").unwrap();
        let shared = shared_watching(dir.path());

        std::fs::write(dir.path().join("a.ts"), "two, longer").unwrap();
        let changes = resolve_changes(burst(dir.path()), &shared);
        assert_eq!(changes.touched, vec![to_canon(dir.path())]);
        assert!(
            changes.report.is_empty(),
            "nothing the explorer shows moved"
        );

        std::fs::write(dir.path().join("b.ts"), "").unwrap();
        let changes = resolve_changes(burst(dir.path()), &shared);
        assert_eq!(changes.report, vec![to_canon(dir.path())]);

        let changes = resolve_changes(burst(dir.path()), &shared);
        assert!(changes.report.is_empty(), "the new listing is now known");

        std::fs::remove_file(dir.path().join("b.ts")).unwrap();
        let changes = resolve_changes(burst(dir.path()), &shared);
        assert_eq!(changes.report, vec![to_canon(dir.path())]);
    }

    #[test]
    fn a_registered_file_is_still_reported_when_only_its_contents_change() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("open.ts");
        std::fs::write(&file, "one").unwrap();
        let shared = shared_watching(dir.path());
        shared.set.lock().unwrap().add_file(
            to_canon(dir.path()),
            to_canon(&file),
            FileStamp::of(&file),
        );

        std::fs::write(&file, "two, a different length").unwrap();
        let changes = resolve_changes(burst(dir.path()), &shared);
        assert_eq!(changes.report, vec![to_canon(&file)]);
    }
}
