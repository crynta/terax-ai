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
use plan::{Batch, DirSet, FileStamp, ListingSnapshot, ListingStamp, Pending, WatchSet};

// Quiet-gap before a batch flushes; MAX_WINDOW caps latency under a long stream.
const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_WINDOW: Duration = Duration::from_millis(1000);

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

/// Receives the watched directories a burst touched, before the explorer's
/// listing filter is applied (so in-place file edits are included). Runs on the
/// drain thread: it must only hand the paths off.
pub type Tap = Arc<dyn Fn(&[String]) + Send + Sync>;

type Taps = Arc<RwLock<Vec<(u64, Tap)>>>;

#[derive(Default)]
pub struct FsWatchState {
    inner: Mutex<Option<Running>>,
    taps: Taps,
    next_tap: std::sync::atomic::AtomicU64,
}

#[derive(Clone, serde::Serialize)]
struct ChangedPayload {
    paths: Vec<String>,
}

fn start(app: &AppHandle, taps: Taps) -> Result<Running, String> {
    let (tx, rx) = mpsc::channel::<Batch>();
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
        .spawn(move || drain_loop(rx, drain_shared, app, index, taps))
        .map_err(|e| e.to_string())?;
    Ok(Running { shared, backend })
}

fn drain_loop(
    rx: mpsc::Receiver<Batch>,
    shared: Arc<Shared>,
    app: AppHandle,
    index: FileIndexState,
    taps: Taps,
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
        if !touched.is_empty() {
            let listeners: Vec<Tap> = taps
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .map(|(_, tap)| tap.clone())
                .collect();
            for tap in listeners {
                tap(&touched);
            }
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
    resolve_changes_with(pending, shared, &plan::listing_signature)
}

fn resolve_changes_with(
    pending: Pending,
    shared: &Shared,
    scan: &dyn Fn(&std::path::Path) -> Option<u64>,
) -> Changes {
    let (touched, locations) = {
        let set = shared.set.lock().unwrap_or_else(|e| e.into_inner());
        let touched = pending.resolve(set.dir_keys());
        let locations: Vec<_> = touched
            .iter()
            .map(|dir| {
                (
                    set.dir_path(dir),
                    set.listing_stamp(dir),
                    pending.listing_change(dir),
                )
            })
            .collect();
        (touched, locations)
    };
    // Reading the directories happens outside the lock: add/remove never wait for the disk.
    let snapshots: Vec<_> = locations
        .iter()
        .map(|(path, previous, change)| {
            let path = path.as_deref()?;
            if !change.forced
                && ListingStamp::of(path)
                    .zip(*previous)
                    .is_some_and(|(now, before)| now.can_skip(&before, change.content_only))
            {
                return None;
            }
            Some(ListingSnapshot::read(path, scan))
        })
        .collect();
    let mut set = shared.set.lock().unwrap_or_else(|e| e.into_inner());
    let stamp_of = |path: &str| FileStamp::of(std::path::Path::new(path));
    let mut report = Vec::new();
    for (dir, snapshot) in touched.iter().zip(snapshots) {
        if let Some(snapshot) = snapshot {
            if set.listing_changed(dir, snapshot.signature) {
                report.push(dir.clone());
            }
            set.record_listing_stamp(dir, snapshot.stamp);
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
            *guard = Some(start(app, self.taps.clone())?);
        }
        Ok(guard.as_mut().map(f))
    }

    /// Registers `tap` for every burst; the id removes it again.
    pub(crate) fn add_tap(&self, tap: Tap) -> u64 {
        let id = self
            .next_tap
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.taps
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .push((id, tap));
        id
    }

    pub(crate) fn remove_tap(&self, id: u64) {
        self.taps
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(tap_id, _)| *tap_id != id);
    }

    /// Watches already-canonical, already-vetted directories for an internal
    /// consumer. Reference counted with the explorer's own registrations.
    pub(crate) fn watch_dirs(&self, app: &AppHandle, dirs: Vec<PathBuf>) -> Result<(), String> {
        if dirs.is_empty() {
            return Ok(());
        }
        let baselines: Vec<ListingSnapshot> = dirs
            .iter()
            .map(|dir| ListingSnapshot::read(dir, &plan::listing_signature))
            .collect();
        self.with_running(app, true, |running| {
            running.apply(|set| {
                let mut moved = false;
                for (dir, signature) in dirs.into_iter().zip(baselines) {
                    let key = to_canon(&dir);
                    if set.add_dir(key.clone(), dir) {
                        set.record_listing(&key, signature.signature);
                        set.record_listing_stamp(&key, signature.stamp);
                        moved = true;
                    }
                }
                moved
            });
        })?;
        Ok(())
    }

    pub(crate) fn unwatch_dirs(&self, app: &AppHandle, dirs: &[PathBuf]) {
        if dirs.is_empty() {
            return;
        }
        let _ = self.with_running(app, false, |running| {
            running.apply(|set| {
                let mut moved = false;
                for dir in dirs {
                    moved |= set.remove_dir(&to_canon(dir));
                }
                moved
            });
        });
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
        let baselines: Vec<ListingSnapshot> = dirs
            .iter()
            .map(|dir| ListingSnapshot::read(dir, &plan::listing_signature))
            .collect();
        app.state::<FsWatchState>()
            .with_running(&app, true, |running| {
                running.apply(|set| {
                    let mut moved = false;
                    for (dir, signature) in dirs.into_iter().zip(baselines) {
                        let key = to_canon(&dir);
                        if set.add_dir(key.clone(), dir) {
                            set.record_listing(&key, signature.signature);
                            set.record_listing_stamp(&key, signature.stamp);
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
        assert!(set.add_dir(key.clone(), dir.to_path_buf()));
        let baseline = ListingSnapshot::read(dir, &plan::listing_signature);
        set.record_listing(&key, baseline.signature);
        set.record_listing_stamp(&key, baseline.stamp);
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
            ..Batch::default()
        });
        pending
    }

    #[test]
    fn repeated_content_edits_do_not_enumerate_a_wide_directory() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..1000 {
            std::fs::write(dir.path().join(format!("{i}.txt")), "").unwrap();
        }
        let shared = shared_watching(dir.path());
        let reusable = shared
            .set
            .lock()
            .unwrap()
            .listing_stamp(&to_canon(dir.path()))
            .is_some_and(|stamp| stamp.can_skip(&stamp, false));
        let expected_scans = if reusable { 0 } else { 9 };
        let scans = std::cell::Cell::new(0);
        let scan = |path: &std::path::Path| {
            scans.set(scans.get() + 1);
            plan::listing_signature(path)
        };
        for i in 1..10 {
            std::fs::write(dir.path().join("0.txt"), "x".repeat(i)).unwrap();
            let changes = resolve_changes_with(burst(dir.path()), &shared, &scan);
            assert!(changes.report.is_empty());
        }
        assert_eq!(
            scans.get(),
            expected_scans,
            "only uncertain directory metadata should require a scan"
        );
        std::fs::rename(dir.path().join("0.txt"), dir.path().join("renamed.txt")).unwrap();
        let changes = resolve_changes_with(burst(dir.path()), &shared, &scan);
        assert_eq!(changes.report, vec![to_canon(dir.path())]);
        assert_eq!(scans.get(), expected_scans + 1);
    }

    #[test]
    fn content_only_batches_skip_listing_but_still_report_registered_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("open.txt");
        std::fs::write(&file, "old").unwrap();
        let shared = shared_watching(dir.path());
        shared.set.lock().unwrap().add_file(
            to_canon(dir.path()),
            to_canon(&file),
            FileStamp::of(&file),
        );
        std::fs::write(&file, "new content").unwrap();
        let mut pending = Pending::default();
        pending.merge(Batch {
            dirs: vec![to_canon(dir.path())],
            listing: plan::ListingChange {
                content_only: true,
                forced: false,
            },
            ..Batch::default()
        });
        let changes = resolve_changes_with(pending, &shared, &|_| {
            panic!("content-only event must not enumerate")
        });
        assert_eq!(changes.report, vec![to_canon(&file)]);
    }

    #[cfg(unix)]
    #[test]
    fn restoring_directory_mtime_cannot_hide_a_rename() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("before.txt"), "").unwrap();
        let directory = std::fs::File::open(dir.path()).unwrap();
        let original =
            std::time::SystemTime::UNIX_EPOCH + std::time::Duration::new(123456, 123456789);
        directory.set_modified(original).unwrap();
        let shared = shared_watching(dir.path());
        // Give the filesystem change clock a tick; the mtime is restored below.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::rename(dir.path().join("before.txt"), dir.path().join("after.txt")).unwrap();
        directory.set_modified(original).unwrap();
        let changes = resolve_changes(burst(dir.path()), &shared);
        assert_eq!(changes.report, vec![to_canon(dir.path())]);
    }

    #[test]
    fn content_edits_through_an_ignore_alias_still_update_the_listing() {
        let dir = tempfile::tempdir().unwrap();
        let ignore = dir.path().join(".gitignore");
        let alias = dir.path().join("rules.txt");
        std::fs::write(&ignore, "old").unwrap();
        std::fs::hard_link(&ignore, &alias).unwrap();
        let shared = shared_watching(dir.path());
        std::fs::write(&alias, "a new ignore rule").unwrap();
        let mut pending = Pending::default();
        pending.merge(Batch {
            dirs: vec![to_canon(dir.path())],
            listing: plan::ListingChange {
                content_only: true,
                forced: false,
            },
            ..Batch::default()
        });
        let changes = resolve_changes(pending, &shared);
        assert_eq!(changes.report, vec![to_canon(dir.path())]);
    }

    #[test]
    fn ignore_edits_and_uncertain_events_still_scan_the_listing() {
        let dir = tempfile::tempdir().unwrap();
        let ignore = dir.path().join(".gitignore");
        std::fs::write(&ignore, "old").unwrap();
        let shared = shared_watching(dir.path());
        let scans = std::cell::Cell::new(0);
        let scan = |path: &std::path::Path| {
            scans.set(scans.get() + 1);
            plan::listing_signature(path)
        };
        std::fs::write(&ignore, "a new ignore rule").unwrap();
        let changed = resolve_changes_with(burst(dir.path()), &shared, &scan);
        assert_eq!(changed.report, vec![to_canon(dir.path())]);
        assert_eq!(scans.get(), 1);
        let mut dropped = Pending::default();
        dropped.merge(Batch {
            subtrees: vec![to_canon(dir.path())],
            ..Batch::default()
        });
        resolve_changes_with(dropped, &shared, &scan);
        assert_eq!(
            scans.get(),
            2,
            "dropped events force a scan even with stable metadata"
        );
    }

    #[test]
    fn taps_are_registered_and_removed_by_id_and_cost_nothing_when_absent() {
        let state = FsWatchState::default();
        assert!(state.taps.read().unwrap().is_empty());

        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = seen.clone();
        let first = state.add_tap(Arc::new(move |dirs: &[String]| {
            sink.lock().unwrap().extend(dirs.iter().cloned());
        }));
        let second = state.add_tap(Arc::new(|_: &[String]| {}));
        assert_ne!(first, second);
        assert_eq!(state.taps.read().unwrap().len(), 2);

        for (_, tap) in state.taps.read().unwrap().iter() {
            tap(&["/watched/dir".to_string()]);
        }
        assert_eq!(*seen.lock().unwrap(), vec!["/watched/dir".to_string()]);

        state.remove_tap(first);
        state.remove_tap(first);
        let remaining = state.taps.read().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0, second);
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
