//! Per-root file-list cache behind `fs_search` and `fs_list_files`.
//!
//! A keystroke in the explorer search used to re-walk up to 50k entries. The
//! walk now happens once per root, the result is kept in a packed buffer, and
//! each query only ranks it. Entries go stale on watcher events, on our own
//! mutations, and after a TTL. A changed entry is dropped on the spot and
//! rebuilt lazily by the next query, so an idle app holds at most two bounded
//! buffers and runs nothing. A change that lands while a cold walk is running
//! has no entry to drop, so the walk is marked dirty instead: its result is
//! returned to the query that asked for it but never cached.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ignore::WalkBuilder;

use super::to_canon;

/// Hard cap on entries a walk may visit. Protects against roots like $HOME
/// where there is no .gitignore and the tree is effectively unbounded.
pub const MAX_SCANNED: usize = 50_000;

/// Directory names pruned unconditionally; they dominate scan time when present
/// and are rarely useful in a file finder.
pub const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];

const MAX_SLOTS: usize = 2;
const TTL: Duration = Duration::from_secs(45);
/// Upper bound on the packed path text of one index (about 50k typical paths).
const MAX_PACKED_BYTES: usize = 16 * 1024 * 1024;
const DIR_BIT: u32 = 1 << 31;

/// Paths of one walk in a single string plus end offsets: about 12 bytes of
/// overhead per entry instead of a heap allocation each.
#[derive(Default)]
pub struct Packed {
    buf: String,
    ends: Vec<u32>,
}

impl Packed {
    /// False when the buffer budget is exhausted; the entry is not stored.
    pub(crate) fn push(&mut self, rel: &str, is_dir: bool) -> bool {
        if self.buf.len() + rel.len() > MAX_PACKED_BYTES || self.ends.len() >= MAX_SCANNED {
            return false;
        }
        self.buf.push_str(rel);
        let end = self.buf.len() as u32;
        self.ends.push(if is_dir { end | DIR_BIT } else { end });
        true
    }

    pub fn len(&self) -> usize {
        self.ends.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }

    pub fn get(&self, index: usize) -> (&str, bool) {
        let start = if index == 0 {
            0
        } else {
            (self.ends[index - 1] & !DIR_BIT) as usize
        };
        let raw = self.ends[index];
        (
            &self.buf[start..(raw & !DIR_BIT) as usize],
            raw & DIR_BIT != 0,
        )
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, bool)> {
        (0..self.len()).map(|i| self.get(i))
    }

    #[cfg(test)]
    fn heap_bytes(&self) -> usize {
        self.buf.capacity() + self.ends.capacity() * std::mem::size_of::<u32>()
    }
}

pub struct FileIndex {
    pub entries: Packed,
    /// The walk stopped at a budget; results are a prefix of the tree.
    pub truncated: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct IndexKey {
    pub root: PathBuf,
    pub show_hidden: bool,
    pub max_depth: Option<usize>,
}

struct Slot {
    key: IndexKey,
    /// Canonical root with a trailing separator, to match watcher event paths.
    event_prefix: String,
    index: Arc<FileIndex>,
    built_at: Instant,
    last_used: Instant,
}

/// A cold walk in progress. It is registered before the first directory is
/// read, so every change reported after that point is seen by `note_change`.
struct Walk {
    id: u64,
    event_prefix: String,
    /// A change under the root was reported while walking: the listing may
    /// already be out of date.
    dirty: bool,
}

#[derive(Default)]
struct Table {
    slots: Vec<Slot>,
    walks: Vec<Walk>,
    next_walk: u64,
}

#[derive(Default)]
struct Inner {
    table: Mutex<Table>,
    /// Serializes cold walks so concurrent queries for one root share a build.
    build: Mutex<()>,
}

/// Unregisters the walk when the build ends, however it ends (a panic in the
/// walker must not leave a registration behind).
struct WalkGuard<'a> {
    inner: &'a Inner,
    id: u64,
}

impl WalkGuard<'_> {
    /// Whether a change was reported since the walk began.
    fn dirty(&self) -> bool {
        let table = self.inner.table.lock().unwrap_or_else(|e| e.into_inner());
        table
            .walks
            .iter()
            .find(|walk| walk.id == self.id)
            .is_none_or(|walk| walk.dirty)
    }
}

impl Drop for WalkGuard<'_> {
    fn drop(&mut self) {
        let mut table = self.inner.table.lock().unwrap_or_else(|e| e.into_inner());
        table.walks.retain(|walk| walk.id != self.id);
    }
}

#[derive(Clone, Default)]
pub struct FileIndexState(Arc<Inner>);

fn event_prefix(root: &Path) -> String {
    let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut prefix = to_canon(canonical);
    if !prefix.ends_with('/') {
        prefix.push('/');
    }
    prefix
}

/// Whether a change at `path` (no trailing separator) can alter the index of
/// the root behind `event_prefix`.
fn covers(event_prefix: &str, path: &str) -> bool {
    let root = event_prefix.trim_end_matches('/');
    if path == root {
        true
    } else if let Some(rest) = path.strip_prefix(event_prefix) {
        !is_pruned_relative(rest)
    } else {
        // A change to an ancestor (rename of a parent) also invalidates.
        root.strip_prefix(path)
            .is_some_and(|rest| rest.starts_with('/'))
    }
}

/// Changes inside pruned directories never show up in an index, so they must
/// not invalidate one (a package install would otherwise rebuild per keystroke).
fn is_pruned_relative(relative: &str) -> bool {
    relative
        .split(['/', '\\'])
        .any(|component| PRUNE_DIRS.contains(&component))
}

impl FileIndexState {
    /// Returns the cached index for `key` or builds it.
    pub fn get_or_build(&self, key: &IndexKey) -> Arc<FileIndex> {
        self.get_or_build_with(key, Instant::now(), || build_index(key))
    }

    pub(crate) fn get_or_build_with(
        &self,
        key: &IndexKey,
        now: Instant,
        build: impl FnOnce() -> FileIndex,
    ) -> Arc<FileIndex> {
        if let Some(hit) = self.lookup(key, now) {
            return hit;
        }
        let _build = self.0.build.lock().unwrap_or_else(|e| e.into_inner());
        // Another caller may have finished the same walk while we waited.
        if let Some(hit) = self.lookup(key, now) {
            return hit;
        }
        let prefix = event_prefix(&key.root);
        let walk = self.begin_walk(&prefix);
        let index = Arc::new(build());
        if !walk.dirty() {
            self.insert(key, prefix, index.clone(), now);
        }
        index
    }

    fn begin_walk(&self, event_prefix: &str) -> WalkGuard<'_> {
        let mut table = self.0.table.lock().unwrap_or_else(|e| e.into_inner());
        let id = table.next_walk;
        table.next_walk += 1;
        table.walks.push(Walk {
            id,
            event_prefix: event_prefix.to_string(),
            dirty: false,
        });
        WalkGuard { inner: &self.0, id }
    }

    fn lookup(&self, key: &IndexKey, now: Instant) -> Option<Arc<FileIndex>> {
        let mut table = self.0.table.lock().unwrap_or_else(|e| e.into_inner());
        table
            .slots
            .retain(|slot| now.saturating_duration_since(slot.built_at) < TTL);
        let slot = table.slots.iter_mut().find(|slot| slot.key == *key)?;
        slot.last_used = now;
        Some(slot.index.clone())
    }

    fn insert(&self, key: &IndexKey, event_prefix: String, index: Arc<FileIndex>, now: Instant) {
        let mut table = self.0.table.lock().unwrap_or_else(|e| e.into_inner());
        let slots = &mut table.slots;
        slots.retain(|slot| slot.key != *key);
        while slots.len() >= MAX_SLOTS {
            let oldest = slots
                .iter()
                .enumerate()
                .min_by_key(|(_, slot)| slot.last_used)
                .map(|(i, _)| i)
                .unwrap_or(0);
            slots.swap_remove(oldest);
        }
        slots.push(Slot {
            key: key.clone(),
            event_prefix,
            index,
            built_at: now,
            last_used: now,
        });
    }

    /// A filesystem change at `path` (an event path or a directory we mutated).
    /// Frees the matching buffers immediately and marks any walk under way as
    /// stale; the next query rebuilds. Runs even with nothing cached: a cold
    /// walk is exactly when a change has no entry to drop.
    pub fn note_change(&self, path: &str) {
        let path = path.trim_end_matches('/');
        let mut table = self.0.table.lock().unwrap_or_else(|e| e.into_inner());
        for walk in &mut table.walks {
            if covers(&walk.event_prefix, path) {
                walk.dirty = true;
            }
        }
        table.slots.retain(|slot| !covers(&slot.event_prefix, path));
    }

    #[cfg(test)]
    fn slot_count(&self) -> usize {
        self.0.table.lock().unwrap().slots.len()
    }

    #[cfg(test)]
    fn walks_in_flight(&self) -> usize {
        self.0.table.lock().unwrap().walks.len()
    }

    #[cfg(test)]
    fn cached_bytes(&self) -> usize {
        self.0
            .table
            .lock()
            .unwrap()
            .slots
            .iter()
            .map(|slot| slot.index.entries.heap_bytes())
            .sum()
    }
}

fn build_index(key: &IndexKey) -> FileIndex {
    let walker = WalkBuilder::new(&key.root)
        .hidden(!key.show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .max_depth(key.max_depth)
        .filter_entry(|dent| {
            // Prune known-heavy dirs even when no .gitignore is present.
            if dent.depth() == 0 {
                return true;
            }
            match dent.file_name().to_str() {
                Some(name) => !PRUNE_DIRS.contains(&name),
                None => true,
            }
        })
        .build();

    let mut entries = Packed::default();
    let mut scanned = 0usize;
    let mut truncated = false;
    for dent in walker.flatten() {
        scanned += 1;
        if scanned > MAX_SCANNED {
            truncated = true;
            break;
        }
        let Ok(relative) = dent.path().strip_prefix(&key.root) else {
            continue;
        };
        let rel = to_canon(relative);
        if rel.is_empty() {
            continue;
        }
        let is_dir = dent.file_type().is_some_and(|t| t.is_dir());
        if !entries.push(&rel, is_dir) {
            truncated = true;
            break;
        }
    }
    FileIndex { entries, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn key(root: &Path) -> IndexKey {
        IndexKey {
            root: root.to_path_buf(),
            show_hidden: false,
            max_depth: None,
        }
    }

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src/deep")).unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        std::fs::write(dir.path().join("src/a.rs"), "").unwrap();
        std::fs::write(dir.path().join("src/deep/b.rs"), "").unwrap();
        std::fs::write(dir.path().join("node_modules/pkg/index.js"), "").unwrap();
        dir
    }

    #[test]
    fn packed_round_trips_entries_and_directory_flags() {
        let mut packed = Packed::default();
        assert!(packed.push("src", true));
        assert!(packed.push("src/a.rs", false));
        assert!(packed.push("", false));
        assert_eq!(packed.len(), 3);
        assert_eq!(packed.get(0), ("src", true));
        assert_eq!(packed.get(1), ("src/a.rs", false));
        assert_eq!(packed.get(2), ("", false));
        assert_eq!(packed.iter().count(), 3);
    }

    #[test]
    fn packed_refuses_entries_past_its_budgets() {
        let mut packed = Packed::default();
        for i in 0..MAX_SCANNED {
            assert!(packed.push(&i.to_string(), false));
        }
        assert!(!packed.push("one-too-many", false));
        let mut huge = Packed::default();
        assert!(!huge.push(&"x".repeat(MAX_PACKED_BYTES + 1), false));
    }

    #[test]
    fn walk_lists_files_and_dirs_and_prunes_heavy_directories() {
        let dir = tree();
        let index = build_index(&key(dir.path()));
        let mut rels: Vec<_> = index
            .entries
            .iter()
            .map(|(r, d)| (r.to_string(), d))
            .collect();
        rels.sort();
        assert_eq!(
            rels,
            vec![
                ("src".to_string(), true),
                ("src/a.rs".to_string(), false),
                ("src/deep".to_string(), true),
                ("src/deep/b.rs".to_string(), false),
            ]
        );
        assert!(!index.truncated);
    }

    #[test]
    fn depth_limit_is_part_of_the_walk() {
        let dir = tree();
        let mut shallow = key(dir.path());
        shallow.max_depth = Some(1);
        let index = build_index(&shallow);
        assert!(index.entries.iter().all(|(rel, _)| !rel.contains("deep/")));
    }

    #[test]
    fn a_fresh_index_is_reused_until_a_change_arrives() {
        let dir = tree();
        let state = FileIndexState::default();
        let builds = AtomicUsize::new(0);
        let now = Instant::now();
        let k = key(dir.path());
        let get = |at: Instant| {
            state.get_or_build_with(&k, at, || {
                builds.fetch_add(1, Ordering::SeqCst);
                build_index(&k)
            })
        };
        get(now);
        get(now + Duration::from_secs(1));
        assert_eq!(builds.load(Ordering::SeqCst), 1);

        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        state.note_change(&to_canon(canonical.join("src")));
        assert_eq!(
            state.slot_count(),
            0,
            "changed index is dropped, not kept stale"
        );
        get(now + Duration::from_secs(2));
        assert_eq!(builds.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn changes_inside_pruned_directories_do_not_invalidate() {
        let dir = tree();
        let state = FileIndexState::default();
        let k = key(dir.path());
        let now = Instant::now();
        state.get_or_build_with(&k, now, || build_index(&k));
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        state.note_change(&to_canon(canonical.join("node_modules/pkg")));
        state.note_change(&to_canon(canonical.join("target")));
        state.note_change("/somewhere/else");
        assert_eq!(state.slot_count(), 1);
        state.note_change(&to_canon(&canonical));
        assert_eq!(state.slot_count(), 0, "a change at the root itself counts");
    }

    #[test]
    fn a_renamed_ancestor_invalidates_the_index() {
        let dir = tree();
        let state = FileIndexState::default();
        let k = key(&dir.path().join("src"));
        state.get_or_build_with(&k, Instant::now(), || build_index(&k));
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        state.note_change(&to_canon(&canonical));
        assert_eq!(state.slot_count(), 0);
    }

    #[test]
    fn entries_expire_after_the_ttl() {
        let dir = tree();
        let state = FileIndexState::default();
        let builds = AtomicUsize::new(0);
        let k = key(dir.path());
        let now = Instant::now();
        let get = |at: Instant| {
            state.get_or_build_with(&k, at, || {
                builds.fetch_add(1, Ordering::SeqCst);
                build_index(&k)
            })
        };
        get(now);
        get(now + TTL - Duration::from_secs(1));
        assert_eq!(builds.load(Ordering::SeqCst), 1);
        get(now + TTL + Duration::from_secs(1));
        assert_eq!(builds.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn memory_is_bounded_by_evicting_the_least_recently_used_root() {
        let state = FileIndexState::default();
        let dirs: Vec<_> = (0..3).map(|_| tree()).collect();
        let now = Instant::now();
        for (i, dir) in dirs.iter().enumerate() {
            let k = key(dir.path());
            state.get_or_build_with(&k, now + Duration::from_secs(i as u64), || build_index(&k));
        }
        assert_eq!(state.slot_count(), MAX_SLOTS);
        assert!(state.cached_bytes() < 64 * 1024);
        let table = state.0.table.lock().unwrap();
        assert!(table
            .slots
            .iter()
            .all(|slot| slot.key.root != dirs[0].path()));
    }

    #[test]
    fn a_change_during_a_cold_walk_is_returned_but_never_cached() {
        let dir = tree();
        let state = FileIndexState::default();
        let k = key(dir.path());
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let builds = AtomicUsize::new(0);
        let now = Instant::now();
        let first = state.get_or_build_with(&k, now, || {
            builds.fetch_add(1, Ordering::SeqCst);
            let listing = build_index(&k);
            // Created after the walker passed this directory, reported before
            // the walk returns: the listing above does not have it.
            std::fs::write(dir.path().join("src/late.rs"), "").unwrap();
            state.note_change(&to_canon(canonical.join("src/late.rs")));
            listing
        });
        assert!(first.entries.iter().all(|(rel, _)| rel != "src/late.rs"));
        assert_eq!(state.slot_count(), 0, "a stale listing must not be cached");
        assert_eq!(state.walks_in_flight(), 0);

        let second = state.get_or_build_with(&k, now, || {
            builds.fetch_add(1, Ordering::SeqCst);
            build_index(&k)
        });
        assert_eq!(builds.load(Ordering::SeqCst), 2);
        assert!(second.entries.iter().any(|(rel, _)| rel == "src/late.rs"));
        assert_eq!(state.slot_count(), 1, "a clean walk is cached");
    }

    #[test]
    fn only_changes_that_can_alter_the_walked_root_taint_it() {
        let dir = tree();
        let state = FileIndexState::default();
        let k = key(dir.path());
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let now = Instant::now();
        state.get_or_build_with(&k, now, || {
            state.note_change("/somewhere/else");
            state.note_change(&to_canon(canonical.join("node_modules/pkg")));
            state.note_change(&to_canon(canonical.join("target/debug")));
            build_index(&k)
        });
        assert_eq!(state.slot_count(), 1);

        for path in [
            to_canon(&canonical),
            to_canon(canonical.join("src/new.rs")),
            to_canon(canonical.parent().unwrap()),
        ] {
            let state = FileIndexState::default();
            state.get_or_build_with(&k, now, || {
                state.note_change(&path);
                build_index(&k)
            });
            assert_eq!(state.slot_count(), 0, "{path} must taint the walk");
        }
    }

    #[test]
    fn a_walk_that_panics_leaves_no_registration_behind() {
        let dir = tree();
        let state = FileIndexState::default();
        let k = key(dir.path());
        let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            state.get_or_build_with(&k, Instant::now(), || panic!("walker failed"));
        }));
        assert!(attempt.is_err());
        assert_eq!(state.walks_in_flight(), 0);
        assert_eq!(state.slot_count(), 0);
        state.get_or_build_with(&k, Instant::now(), || build_index(&k));
        assert_eq!(state.slot_count(), 1);
    }

    #[test]
    fn different_visibility_or_depth_are_separate_entries() {
        let dir = tree();
        let state = FileIndexState::default();
        let now = Instant::now();
        let mut hidden = key(dir.path());
        hidden.show_hidden = true;
        let shown = key(dir.path());
        let builds = AtomicUsize::new(0);
        for k in [&hidden, &shown, &hidden, &shown] {
            state.get_or_build_with(k, now, || {
                builds.fetch_add(1, Ordering::SeqCst);
                build_index(k)
            });
        }
        assert_eq!(builds.load(Ordering::SeqCst), 2);
    }
}
