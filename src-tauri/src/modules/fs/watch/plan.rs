//! Platform-neutral half of the file watcher: what is watched, which backend
//! events matter, and how a burst collapses into the paths the frontend gets.
//! Everything here is pure so the macOS FSEvents callback and the notify
//! callback share one tested filter.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Directory-level FSEvents flags that matter here, mirrored so the filter
/// compiles and is tested on every host.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub mod flags {
    pub const MUST_SCAN_SUBDIRS: u32 = 0x0000_0001;
    pub const USER_DROPPED: u32 = 0x0000_0002;
    pub const KERNEL_DROPPED: u32 = 0x0000_0004;
    pub const HISTORY_DONE: u32 = 0x0000_0010;
    pub const ROOT_CHANGED: u32 = 0x0000_0020;
    pub const MOUNT: u32 = 0x0000_0040;
    pub const UNMOUNT: u32 = 0x0000_0080;
}

/// Exact byte spelling of every watched directory, trailing separator removed.
pub type DirSet = HashSet<Vec<u8>>;

/// Matched on the final path component. Never watched even when expanded: large
/// or generated trees where live updates cost more than they're worth.
pub const SKIP_DIRS: &[&str] = &[
    // VCS
    ".git",
    ".hg",
    ".svn",
    ".jj",
    // JS / web
    "node_modules",
    "bower_components",
    ".pnpm-store",
    ".yarn",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".vite",
    ".turbo",
    ".parcel-cache",
    ".angular",
    ".vercel",
    ".netlify",
    ".output",
    ".cache",
    // Rust
    "target",
    // Python
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".nox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    ".eggs",
    // JVM / Gradle
    ".gradle",
    // .NET
    "obj",
    // Go / PHP
    "vendor",
    // Elixir
    "_build",
    "deps",
    // Dart / Flutter
    ".dart_tool",
    // Haskell
    "dist-newstyle",
    ".stack-work",
    // Swift / Zig
    ".build",
    "zig-cache",
    "zig-out",
    // CMake (CLion)
    "cmake-build-debug",
    "cmake-build-release",
    // IDE / coverage / infra
    ".idea",
    "coverage",
    ".nyc_output",
    ".terraform",
];

/// Heavy directories that, when they sit directly under a watched root and
/// hold nothing we watch, are excluded from the FSEvents stream so the daemon
/// never even delivers their events. FSEvents allows eight exclusions.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const EXCLUDE_UNDER_ROOT: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
];
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const MAX_EXCLUSIONS: usize = 8;

pub fn is_skipped(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| SKIP_DIRS.contains(&n))
}

fn is_within(path: &str, ancestor: &str) -> bool {
    path == ancestor
        || path
            .strip_prefix(ancestor)
            .is_some_and(|rest| ancestor.ends_with('/') || rest.starts_with('/'))
}

/// Size, modification time and identity of a watched file. Directory events
/// say only that something in a directory changed; this is how an editor tab
/// learns that its own file did.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    inode: u64,
}

impl FileStamp {
    pub fn of(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        #[cfg(unix)]
        let inode = {
            use std::os::unix::fs::MetadataExt;
            meta.ino()
        };
        Some(Self {
            len: meta.len(),
            modified: meta.modified().ok(),
            #[cfg(unix)]
            inode,
        })
    }
}

/// Most entries a directory may have for its listing to be fingerprinted: a larger one is
/// always reported (the walk would cost more than the reload it saves).
const MAX_FINGERPRINTED_ENTRIES: usize = 50_000;

/// Ignore files change what the explorer shows for *other* entries (dimming), so a rewrite of
/// one counts as a listing change although no name moved.
fn is_ignore_file(name: &str) -> bool {
    matches!(name, ".gitignore" | ".ignore")
}

/// Order-independent fingerprint of what the explorer renders for a directory: the entry
/// names and their kinds. Entries are mixed with a commutative sum, so no sort and no
/// allocation per entry.
#[derive(Default)]
pub struct ListingHasher {
    sum: u64,
    count: u64,
}

impl ListingHasher {
    /// `extra` carries anything else that must count as a change of this entry (an ignore
    /// file's stamp).
    pub fn add(&mut self, name: &str, kind: u8, extra: u64) {
        let mut hasher = DefaultHasher::new();
        name.hash(&mut hasher);
        kind.hash(&mut hasher);
        extra.hash(&mut hasher);
        self.sum = self.sum.wrapping_add(hasher.finish());
        self.count += 1;
    }

    pub fn finish(self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.sum.hash(&mut hasher);
        self.count.hash(&mut hasher);
        hasher.finish()
    }
}

/// The fingerprint of `dir`'s listing, or `None` when it cannot be read (gone, denied) or is
/// too large to fingerprint: callers then report the directory, as they always did.
pub fn listing_signature(dir: &Path) -> Option<u64> {
    let mut hasher = ListingHasher::default();
    for (seen, entry) in std::fs::read_dir(dir).ok()?.enumerate() {
        if seen >= MAX_FINGERPRINTED_ENTRIES {
            return None;
        }
        let entry = entry.ok()?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let kind = match entry.file_type() {
            Ok(kind) if kind.is_dir() => 1,
            Ok(kind) if kind.is_symlink() => 2,
            Ok(_) => 0,
            Err(_) => 3,
        };
        let extra = if is_ignore_file(&name) {
            match FileStamp::of(&entry.path()) {
                Some(stamp) => {
                    let mut hasher = DefaultHasher::new();
                    stamp.len.hash(&mut hasher);
                    stamp.modified.hash(&mut hasher);
                    hasher.finish()
                }
                None => 1,
            }
        } else {
            0
        };
        hasher.add(&name, kind, extra);
    }
    Some(hasher.finish())
}

struct FileWatch {
    refs: usize,
    stamp: Option<FileStamp>,
}

struct DirWatch {
    refs: usize,
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    path: PathBuf,
    /// Fingerprint of the listing the frontend was last told about (or could have read when the
    /// directory was registered); `None` until known.
    listing: Option<u64>,
}

/// Refcounted directories (explorer expansion and open editors can ask for the
/// same one) and the files whose own changes are reported.
#[derive(Default)]
pub struct WatchSet {
    dirs: HashMap<String, DirWatch>,
    files: HashMap<String, HashMap<String, FileWatch>>,
}

impl WatchSet {
    /// True when the directory was not watched before.
    pub fn add_dir(&mut self, key: String, path: PathBuf) -> bool {
        match self.dirs.get_mut(&key) {
            Some(watch) => {
                watch.refs += 1;
                false
            }
            None => {
                self.dirs.insert(
                    key,
                    DirWatch {
                        refs: 1,
                        path,
                        listing: None,
                    },
                );
                true
            }
        }
    }

    /// True when the last reference was released.
    pub fn remove_dir(&mut self, key: &str) -> bool {
        match self.dirs.get_mut(key) {
            Some(watch) if watch.refs > 1 => {
                watch.refs -= 1;
                false
            }
            Some(_) => {
                self.dirs.remove(key);
                true
            }
            None => false,
        }
    }

    /// Remembers the listing a newly watched directory had when it was registered, taken before
    /// the OS watch starts so that any later change differs from it.
    pub fn record_listing(&mut self, key: &str, signature: Option<u64>) {
        if let Some(watch) = self.dirs.get_mut(key) {
            watch.listing = signature;
        }
    }

    /// Where a watched directory lives on disk.
    pub fn dir_path(&self, key: &str) -> Option<PathBuf> {
        self.dirs.get(key).map(|watch| watch.path.clone())
    }

    /// Whether the frontend must be told about `key`: its listing (names and kinds) moved since
    /// the last report. An in-place edit of a file changes the directory's timestamp but not
    /// its listing, and the explorer renders nothing else, so reporting it would only cost an
    /// IPC round trip, a reload and the garbage both leave in the web process. A directory
    /// that cannot be fingerprinted is always reported. The new fingerprint is remembered.
    pub fn listing_changed(&mut self, key: &str, current: Option<u64>) -> bool {
        let Some(watch) = self.dirs.get_mut(key) else {
            return false;
        };
        let previous = std::mem::replace(&mut watch.listing, current);
        match (previous, current) {
            (Some(before), Some(now)) => before != now,
            _ => true,
        }
    }

    pub fn add_file(&mut self, dir: String, file: String, stamp: Option<FileStamp>) {
        self.files
            .entry(dir)
            .or_default()
            .entry(file)
            .and_modify(|watch| watch.refs += 1)
            .or_insert(FileWatch { refs: 1, stamp });
    }

    pub fn remove_file(&mut self, dir: &str, file: &str) {
        let Some(in_dir) = self.files.get_mut(dir) else {
            return;
        };
        if let Some(watch) = in_dir.get_mut(file) {
            if watch.refs > 1 {
                watch.refs -= 1;
                return;
            }
            in_dir.remove(file);
        }
        if in_dir.is_empty() {
            self.files.remove(dir);
        }
    }

    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub fn dir_paths(&self) -> impl Iterator<Item = &Path> {
        self.dirs.values().map(|watch| watch.path.as_path())
    }

    pub fn dir_keys(&self) -> impl Iterator<Item = &str> {
        self.dirs.keys().map(String::as_str)
    }

    #[cfg(test)]
    pub fn contains_dir(&self, key: &str) -> bool {
        self.dirs.contains_key(key)
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.dirs.is_empty() && self.files.is_empty()
    }

    pub fn snapshot(&self) -> DirSet {
        self.dirs.keys().map(|k| k.as_bytes().to_vec()).collect()
    }

    /// Re-stamps the watched files of `dir` and returns those that changed.
    pub fn changed_files_in(
        &mut self,
        dir: &str,
        stamp_of: &dyn Fn(&str) -> Option<FileStamp>,
    ) -> Vec<String> {
        let Some(in_dir) = self.files.get_mut(dir) else {
            return Vec::new();
        };
        let mut changed = Vec::new();
        for (file, watch) in in_dir.iter_mut() {
            let now = stamp_of(file);
            if now != watch.stamp {
                watch.stamp = now;
                changed.push(file.clone());
            }
        }
        changed
    }

    /// The fewest directories that cover everything watched. FSEvents streams
    /// are recursive, so one stream path per top-level directory is enough.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn covering_roots(&self) -> Vec<String> {
        covering_roots(self.dirs.keys().map(String::as_str))
    }

    /// Whether any watched directory or file lives at or below `path`.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn watches_within(&self, path: &str) -> bool {
        self.dirs.keys().any(|dir| is_within(dir, path))
            || self.files.keys().any(|dir| is_within(dir, path))
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn covering_roots<'a>(dirs: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut sorted: Vec<&str> = dirs.collect();
    sorted.sort_unstable_by_key(|dir| (dir.len(), *dir));
    let mut roots: Vec<String> = Vec::new();
    for dir in sorted {
        if !roots.iter().any(|root| is_within(dir, root)) {
            roots.push(dir.to_owned());
        }
    }
    roots.sort_unstable();
    roots
}

/// Stream exclusions: well-known heavy directories directly under a root that
/// exist and contain nothing we watch. Order is stable so an unchanged watch
/// set never restarts the stream.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn exclusion_paths(
    roots: &[String],
    set: &WatchSet,
    is_dir: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    let mut out = Vec::new();
    'roots: for root in roots {
        for name in EXCLUDE_UNDER_ROOT {
            if out.len() >= MAX_EXCLUSIONS {
                break 'roots;
            }
            let candidate = if root.ends_with('/') {
                format!("{root}{name}")
            } else {
                format!("{root}/{name}")
            };
            if set.watches_within(&candidate) || !is_dir(&candidate) {
                continue;
            }
            out.push(candidate);
        }
    }
    out
}

/// What a backend reported for one batch, already reduced to watched
/// directories.
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Batch {
    /// Watched directories where something changed.
    pub dirs: Vec<String>,
    /// Subtrees that must be treated as entirely changed (dropped events,
    /// moved roots): every watched directory at or below each is reported.
    pub subtrees: Vec<String>,
}

impl Batch {
    pub fn is_empty(&self) -> bool {
        self.dirs.is_empty() && self.subtrees.is_empty()
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn trim_separator(path: &[u8]) -> &[u8] {
    match path {
        [rest @ .., b'/'] if !rest.is_empty() => rest,
        _ => path,
    }
}

/// Most event ids a rebuilt stream replays. Ids count every change on the
/// volume, so a stream over a quiet tree can sit on an id from hours ago; the
/// window that could have lost a change is the last delivery interval (a
/// fraction of a second), far inside this, while an unbounded replay would
/// make the system walk its whole history for any root added since.
const MAX_REPLAY_IDS: u64 = 100_000;

/// The event id a new FSEvents stream starts after. `previous` is the last id
/// the stream it replaces delivered, if there was one, and `current` is the
/// system's newest id. A usable previous id is resumed from, within
/// `MAX_REPLAY_IDS` of `current`, so no change is missed during the swap;
/// anything else starts at `current`: no predecessor, an id of zero (which
/// would replay all history), or one the system has not reached (a "since now"
/// sentinel, or ids that restarted).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn resume_after(previous: Option<u64>, current: u64) -> u64 {
    match previous {
        Some(id) if id != 0 && id <= current => id.max(current.saturating_sub(MAX_REPLAY_IDS)),
        _ => current,
    }
}

/// Reduces one FSEvents callback to watched directories. `on_path` sees every
/// distinct consecutive path (watched or not) without allocation, which is how
/// the file-list cache learns about changes under non-watched directories.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn reduce_directory_events<'a>(
    events: impl Iterator<Item = (&'a [u8], u32)>,
    dirs: &DirSet,
    on_path: &mut dyn FnMut(&[u8]),
) -> Batch {
    let mut batch = Batch::default();
    let mut previous: &[u8] = &[];
    let mut hits: Vec<&[u8]> = Vec::new();
    for (raw, event_flags) in events {
        if event_flags & flags::HISTORY_DONE != 0 {
            continue;
        }
        let path = trim_separator(raw);
        let subtree = event_flags
            & (flags::MUST_SCAN_SUBDIRS
                | flags::USER_DROPPED
                | flags::KERNEL_DROPPED
                | flags::ROOT_CHANGED
                | flags::MOUNT
                | flags::UNMOUNT)
            != 0;
        if !subtree && path == previous {
            continue;
        }
        previous = path;
        on_path(path);
        if subtree {
            if let Ok(text) = std::str::from_utf8(path) {
                batch.subtrees.push(text.to_owned());
            }
            continue;
        }
        if dirs.contains(path) && !hits.contains(&path) {
            hits.push(path);
        }
    }
    batch.dirs = hits
        .into_iter()
        .filter_map(|bytes| std::str::from_utf8(bytes).ok().map(str::to_owned))
        .collect();
    batch
}

/// Entry-level events (inotify, ReadDirectoryChangesW) map to the watched
/// directory that owns the entry.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn owning_dir(entry: &str, dirs: &DirSet) -> Option<String> {
    let entry = entry.trim_end_matches('/');
    if dirs.contains(entry.as_bytes()) {
        return Some(entry.to_owned());
    }
    let parent = &entry[..entry.rfind('/')?];
    let parent = if parent.is_empty() { "/" } else { parent };
    dirs.contains(parent.as_bytes()).then(|| parent.to_owned())
}

/// A burst, merged until the debounce window closes.
#[derive(Default)]
pub struct Pending {
    dirs: HashSet<String>,
    subtrees: Vec<String>,
}

impl Pending {
    pub fn merge(&mut self, batch: Batch) {
        self.dirs.extend(batch.dirs);
        for subtree in batch.subtrees {
            if !self.subtrees.contains(&subtree) {
                self.subtrees.push(subtree);
            }
        }
    }

    /// The watched directories to report, sorted for stable payloads.
    pub fn resolve<'a>(self, watched: impl Iterator<Item = &'a str>) -> Vec<String> {
        let mut out = self.dirs;
        if !self.subtrees.is_empty() {
            for dir in watched {
                if self.subtrees.iter().any(|root| is_within(dir, root)) {
                    out.insert(dir.to_owned());
                }
            }
        }
        let mut sorted: Vec<String> = out.into_iter().collect();
        sorted.sort_unstable();
        sorted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_of(dirs: &[&str]) -> WatchSet {
        let mut set = WatchSet::default();
        for dir in dirs {
            set.add_dir((*dir).to_owned(), PathBuf::from(dir));
        }
        set
    }

    #[test]
    fn skip_filter_matches_basename() {
        assert!(is_skipped(Path::new("/a/b/node_modules")));
        assert!(is_skipped(Path::new("/x/target")));
        assert!(is_skipped(Path::new("/p/obj")));
        assert!(!is_skipped(Path::new("/a/src")));
        assert!(!is_skipped(Path::new("/a/node_modules/pkg")));
    }

    #[test]
    fn refcounts_release_only_on_the_last_reference() {
        let mut set = WatchSet::default();
        assert!(set.add_dir("/a".into(), "/a".into()));
        assert!(!set.add_dir("/a".into(), "/a".into()));
        assert!(!set.remove_dir("/a"));
        assert!(set.contains_dir("/a"));
        assert!(set.remove_dir("/a"));
        assert!(!set.contains_dir("/a"));
        assert!(!set.remove_dir("/a"), "unknown removals are inert");
    }

    #[test]
    fn covering_roots_keep_only_top_level_directories() {
        let set = set_of(&[
            "/w/proj/src",
            "/w/proj",
            "/w/proj/src/ui",
            "/w/other",
            "/w/proj2",
        ]);
        assert_eq!(
            set.covering_roots(),
            vec!["/w/other", "/w/proj", "/w/proj2"],
            "a sibling that merely shares a prefix is not covered"
        );
        assert_eq!(set_of(&["/"]).covering_roots(), vec!["/"]);
        assert!(WatchSet::default().covering_roots().is_empty());
    }

    #[test]
    fn covering_roots_are_deterministic() {
        let a = set_of(&["/b", "/a/x", "/a"]);
        let b = set_of(&["/a", "/a/x", "/b"]);
        assert_eq!(a.covering_roots(), b.covering_roots());
    }

    #[test]
    fn exclusions_skip_heavy_children_unless_something_inside_is_watched() {
        let set = set_of(&["/w/proj", "/w/proj/src", "/w/proj/node_modules/pkg"]);
        let roots = set.covering_roots();
        let existing = ["/w/proj/node_modules", "/w/proj/target", "/w/proj/.git"];
        let out = exclusion_paths(&roots, &set, &|p| existing.contains(&p));
        assert_eq!(out, vec!["/w/proj/target", "/w/proj/.git"]);
    }

    #[test]
    fn exclusions_are_capped_at_the_fsevents_limit() {
        let dirs: Vec<String> = (0..6).map(|i| format!("/w/p{i}")).collect();
        let set = set_of(&dirs.iter().map(String::as_str).collect::<Vec<_>>());
        let roots = set.covering_roots();
        let out = exclusion_paths(&roots, &set, &|_| true);
        assert_eq!(out.len(), MAX_EXCLUSIONS);
    }

    #[test]
    fn directory_events_reduce_to_watched_directories_without_duplicates() {
        let dirs: DirSet = [b"/w/proj".to_vec(), b"/w/proj/src".to_vec()]
            .into_iter()
            .collect();
        let events: Vec<(&[u8], u32)> = vec![
            (b"/w/proj/node_modules/.pnpm/a/", 0),
            (b"/w/proj/node_modules/.pnpm/a/", 0),
            (b"/w/proj/src/", 0),
            (b"/w/proj/src/", 0),
            (b"/w/proj/src/", 0),
            (b"/w/proj/", 0),
            (b"/w/proj/src/", 0),
            (b"/elsewhere/", 0),
        ];
        let mut seen = Vec::new();
        let batch = reduce_directory_events(events.into_iter(), &dirs, &mut |p| {
            seen.push(String::from_utf8_lossy(p).into_owned());
        });
        let mut hit = batch.dirs.clone();
        hit.sort();
        assert_eq!(hit, vec!["/w/proj", "/w/proj/src"]);
        assert!(batch.subtrees.is_empty());
        assert_eq!(
            seen,
            vec![
                "/w/proj/node_modules/.pnpm/a",
                "/w/proj/src",
                "/w/proj",
                "/w/proj/src",
                "/elsewhere"
            ],
            "consecutive repeats collapse before the callback sees them"
        );
    }

    #[test]
    fn dropped_event_flags_become_subtree_rescans() {
        let dirs: DirSet = [b"/w/proj/src".to_vec()].into_iter().collect();
        for flag in [
            flags::MUST_SCAN_SUBDIRS,
            flags::USER_DROPPED,
            flags::KERNEL_DROPPED,
            flags::ROOT_CHANGED,
            flags::MOUNT,
            flags::UNMOUNT,
        ] {
            let events = vec![(&b"/w/proj/"[..], flag), (&b"/w/proj/"[..], flag)];
            let batch = reduce_directory_events(events.into_iter(), &dirs, &mut |_| {});
            assert_eq!(batch.subtrees, vec!["/w/proj", "/w/proj"], "flag {flag:#x}");
            assert!(batch.dirs.is_empty());
        }
    }

    #[test]
    fn a_rebuilt_stream_resumes_after_the_last_delivered_event() {
        assert_eq!(resume_after(Some(500), 900), 500);
        assert_eq!(resume_after(Some(900), 900), 900);
        // Nothing to resume from: start at the present, never at the beginning.
        assert_eq!(resume_after(None, 900), 900);
        assert_eq!(resume_after(Some(0), 900), 900);
        // A "since now" sentinel, or ids the system has not reached.
        assert_eq!(resume_after(Some(u64::MAX), 900), 900);
        assert_eq!(resume_after(Some(901), 900), 900);
    }

    #[test]
    fn a_stale_resume_point_is_clamped_so_history_is_not_replayed_wholesale() {
        let current = 5_000_000;
        assert_eq!(
            resume_after(Some(current - MAX_REPLAY_IDS), current),
            current - MAX_REPLAY_IDS
        );
        assert_eq!(
            resume_after(Some(current - MAX_REPLAY_IDS - 1), current),
            current - MAX_REPLAY_IDS
        );
        assert_eq!(resume_after(Some(1), current), current - MAX_REPLAY_IDS);
        // Near the start of the id space the clamp cannot go below zero.
        assert_eq!(resume_after(Some(7), 50), 7);
        assert_eq!(resume_after(Some(7), MAX_REPLAY_IDS + 7), 7);
    }

    #[test]
    fn history_sentinels_are_ignored() {
        let dirs: DirSet = [b"/w".to_vec()].into_iter().collect();
        let events = vec![(&b"/w/"[..], flags::HISTORY_DONE)];
        let batch = reduce_directory_events(events.into_iter(), &dirs, &mut |_| {});
        assert!(batch.is_empty());
    }

    #[test]
    fn the_filesystem_root_keeps_its_slash() {
        let dirs: DirSet = [b"/".to_vec()].into_iter().collect();
        let events = vec![(&b"/"[..], 0)];
        let batch = reduce_directory_events(events.into_iter(), &dirs, &mut |_| {});
        assert_eq!(batch.dirs, vec!["/"]);
    }

    #[test]
    fn entries_map_to_their_watched_directory() {
        let dirs: DirSet = [b"/w/proj".to_vec(), b"/".to_vec()].into_iter().collect();
        assert_eq!(
            owning_dir("/w/proj/a.rs", &dirs).as_deref(),
            Some("/w/proj")
        );
        assert_eq!(owning_dir("/w/proj", &dirs).as_deref(), Some("/w/proj"));
        assert_eq!(owning_dir("/w/proj/", &dirs).as_deref(), Some("/w/proj"));
        assert_eq!(owning_dir("/top.txt", &dirs).as_deref(), Some("/"));
        assert_eq!(owning_dir("/w/proj/sub/deep.rs", &dirs), None);
        assert_eq!(owning_dir("relative", &dirs), None);
    }

    #[test]
    fn a_burst_collapses_and_rescans_expand_to_watched_directories() {
        let mut pending = Pending::default();
        pending.merge(Batch {
            dirs: vec!["/w/a".into()],
            subtrees: vec![],
        });
        pending.merge(Batch {
            dirs: vec!["/w/a".into(), "/w/b".into()],
            subtrees: vec!["/w/c".into()],
        });
        let watched = ["/w/a", "/w/b", "/w/c", "/w/c/sub", "/w/cx", "/other"];
        let out = pending.resolve(watched.iter().copied());
        assert_eq!(out, vec!["/w/a", "/w/b", "/w/c", "/w/c/sub"]);
    }

    #[test]
    fn only_files_whose_stamp_moved_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "one").unwrap();
        let file_key = file.to_string_lossy().into_owned();
        let dir_key = dir.path().to_string_lossy().into_owned();
        let other = dir.path().join("b.txt");
        std::fs::write(&other, "1").unwrap();
        let other_key = other.to_string_lossy().into_owned();

        let mut set = WatchSet::default();
        set.add_file(dir_key.clone(), file_key.clone(), FileStamp::of(&file));
        set.add_file(dir_key.clone(), other_key.clone(), FileStamp::of(&other));
        let stamp_of = |p: &str| FileStamp::of(Path::new(p));
        assert!(set.changed_files_in(&dir_key, &stamp_of).is_empty());

        std::fs::write(&file, "two-longer").unwrap();
        assert_eq!(
            set.changed_files_in(&dir_key, &stamp_of),
            vec![file_key.clone()]
        );
        assert!(
            set.changed_files_in(&dir_key, &stamp_of).is_empty(),
            "a reported change is not reported twice"
        );

        std::fs::remove_file(&file).unwrap();
        assert_eq!(
            set.changed_files_in(&dir_key, &stamp_of),
            vec![file_key.clone()]
        );
        assert!(set.changed_files_in("/not/watched", &stamp_of).is_empty());
    }

    #[test]
    fn file_references_are_counted_and_released() {
        let mut set = WatchSet::default();
        set.add_file("/d".into(), "/d/f".into(), None);
        set.add_file("/d".into(), "/d/f".into(), None);
        set.remove_file("/d", "/d/f");
        assert!(!set.is_empty());
        set.remove_file("/d", "/d/f");
        assert!(set.is_empty());
        set.remove_file("/d", "/d/f");
    }

    #[test]
    fn watches_within_counts_directories_and_file_parents() {
        let mut set = set_of(&["/w/a"]);
        set.add_file("/w/b".into(), "/w/b/f".into(), None);
        assert!(set.watches_within("/w/a"));
        assert!(set.watches_within("/w"));
        assert!(set.watches_within("/w/b"));
        assert!(!set.watches_within("/w/ab"));
        assert!(!set.watches_within("/x"));
    }

    #[test]
    fn an_install_sized_event_flood_is_filtered_without_per_event_work() {
        let dirs: DirSet = (0..10)
            .map(|i| format!("/w/proj/src/d{i}").into_bytes())
            .collect();
        let paths: Vec<Vec<u8>> = (0..500)
            .map(|i| {
                format!("/w/proj/node_modules/.pnpm/pkg{i}/node_modules/pkg{i}/lib/").into_bytes()
            })
            .chain((0..10).map(|i| format!("/w/proj/src/d{i}/").into_bytes()))
            .collect();
        let started = std::time::Instant::now();
        let mut seen = 0usize;
        let mut hit_dirs = 0usize;
        for _ in 0..400 {
            let events = (0..500)
                .map(|i| (paths[i % paths.len()].as_slice(), 0u32))
                .chain((0..500).map(|i| (paths[500 + i % 10].as_slice(), 0u32)));
            let batch = reduce_directory_events(events, &dirs, &mut |_| seen += 1);
            hit_dirs += batch.dirs.len();
        }
        assert_eq!(hit_dirs, 400 * 10);
        assert!(
            seen >= 400 * 500,
            "every distinct path is offered to the index hook"
        );
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "400k events took {:?}",
            started.elapsed()
        );
    }

    fn signature_of(entries: &[(&str, u8)]) -> u64 {
        let mut hasher = ListingHasher::default();
        for (name, kind) in entries {
            hasher.add(name, *kind, 0);
        }
        hasher.finish()
    }

    #[test]
    fn listing_fingerprint_ignores_order_and_sees_every_kind_of_change() {
        let base = signature_of(&[("a.ts", 0), ("src", 1), ("b.ts", 0)]);
        assert_eq!(base, signature_of(&[("b.ts", 0), ("a.ts", 0), ("src", 1)]));
        assert_ne!(base, signature_of(&[("a.ts", 0), ("src", 1)]), "removed");
        assert_ne!(
            base,
            signature_of(&[("a.ts", 0), ("src", 1), ("b.ts", 0), ("c.ts", 0)]),
            "added"
        );
        assert_ne!(
            base,
            signature_of(&[("a.ts", 0), ("src", 1), ("c.ts", 0)]),
            "renamed"
        );
        assert_ne!(
            base,
            signature_of(&[("a.ts", 0), ("src", 0), ("b.ts", 0)]),
            "kind changed"
        );
        assert_ne!(
            signature_of(&[("a", 0), ("a", 0)]),
            signature_of(&[]),
            "duplicates count"
        );
    }

    #[test]
    fn an_edit_in_place_leaves_the_listing_alone_and_a_new_entry_does_not() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.ts"), "one").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let before = listing_signature(dir.path()).unwrap();

        std::fs::write(dir.path().join("a.ts"), "a much longer second version").unwrap();
        assert_eq!(listing_signature(dir.path()), Some(before), "edit in place");

        std::fs::write(dir.path().join("b.ts"), "").unwrap();
        let added = listing_signature(dir.path()).unwrap();
        assert_ne!(added, before);

        std::fs::rename(dir.path().join("b.ts"), dir.path().join("c.ts")).unwrap();
        let renamed = listing_signature(dir.path()).unwrap();
        assert_ne!(renamed, added);

        std::fs::remove_file(dir.path().join("c.ts")).unwrap();
        assert_eq!(listing_signature(dir.path()), Some(before), "back to start");

        std::fs::remove_file(dir.path().join("a.ts")).unwrap();
        std::fs::create_dir(dir.path().join("a.ts")).unwrap();
        assert_ne!(
            listing_signature(dir.path()),
            Some(before),
            "a file replaced by a directory of the same name"
        );
    }

    #[test]
    fn rewriting_an_ignore_file_counts_because_it_dims_other_entries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "target\n").unwrap();
        std::fs::write(dir.path().join("a.ts"), "x").unwrap();
        let before = listing_signature(dir.path()).unwrap();
        std::fs::write(dir.path().join(".gitignore"), "target\na.ts\n").unwrap();
        assert_ne!(listing_signature(dir.path()), Some(before));
    }

    #[test]
    fn unreadable_directories_have_no_signature() {
        assert_eq!(listing_signature(Path::new("/definitely/not/here")), None);
    }

    #[test]
    fn only_a_moved_listing_is_reported_and_unknowns_always_are() {
        let mut set = set_of(&["/w/a", "/w/b"]);
        // Baseline unknown: the first report goes out and is remembered.
        assert!(set.listing_changed("/w/a", Some(1)));
        assert!(!set.listing_changed("/w/a", Some(1)), "same listing");
        assert!(set.listing_changed("/w/a", Some(2)), "moved");
        assert!(!set.listing_changed("/w/a", Some(2)));
        // Unreadable now: reported, and the next readable one is reported again.
        assert!(set.listing_changed("/w/a", None));
        assert!(set.listing_changed("/w/a", Some(2)));
        // A recorded baseline suppresses the first unchanged event.
        set.record_listing("/w/b", Some(7));
        assert!(!set.listing_changed("/w/b", Some(7)));
        // Directories nobody watches are never reported through here.
        assert!(!set.listing_changed("/w/zzz", Some(1)));
    }

    #[test]
    fn releasing_a_directory_forgets_its_baseline() {
        let mut set = set_of(&["/w/a"]);
        set.record_listing("/w/a", Some(5));
        assert!(set.remove_dir("/w/a"));
        assert!(set.add_dir("/w/a".into(), "/w/a".into()));
        assert!(
            set.listing_changed("/w/a", Some(5)),
            "a re-registered directory starts unknown"
        );
    }
}
