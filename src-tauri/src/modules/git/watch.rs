//! `terax:git-changed` notifications. A subscription registers the repository's
//! non-ignored directories (plus HEAD, the index and the refs) with the shared
//! file watcher and turns the directories it reports into
//! `{ repo, kinds: [head | index | refs | worktree] }` events. With no
//! subscription there is no worker thread, no tap and no extra OS watch.
//!
//! Granularity is a directory: `worktree` means "something under a watched
//! directory changed", so a rewritten ignored file inside a watched directory
//! can still report it. Consumers re-query; they are never told what changed.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::modules::fs::to_canon;
use crate::modules::fs::watch::FsWatchState;
use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::plumbing::{common_dir, git_dir, open_worktree};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

pub const EVENT: &str = "terax:git-changed";
const MAX_WORKTREE_DIRS: usize = 2048;
const MAX_REF_DIRS: usize = 512;
const SHALLOW_DEPTH: usize = 2;
/// Touched worktree directories examined one by one per flush; a wider burst
/// is answered with a single resync walk instead.
const MAX_RESCANS_PER_FLUSH: usize = 64;
/// How long a subscribe waits for the worker to register a repository.
const SUBSCRIBE_TIMEOUT: Duration = Duration::from_secs(30);
const COALESCE: Duration = Duration::from_millis(80);
const MAX_WINDOW: Duration = Duration::from_millis(600);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub root: String,
    pub git_dir: String,
    pub common_dir: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirKind {
    GitDir,
    CommonDir,
    Refs,
    Worktree,
}

fn within(path: &str, ancestor: &str) -> bool {
    path == ancestor
        || path
            .strip_prefix(ancestor)
            .is_some_and(|rest| ancestor.ends_with('/') || rest.starts_with('/'))
}

/// What a touched directory means for this repository, or `None` when it is
/// inside git's own bookkeeping (objects, logs, hooks...) and irrelevant.
pub fn classify(layout: &Layout, dir: &str) -> Option<DirKind> {
    if dir == layout.git_dir {
        return Some(DirKind::GitDir);
    }
    if dir == layout.common_dir {
        return Some(DirKind::CommonDir);
    }
    if within(dir, &format!("{}/refs", layout.common_dir)) {
        return Some(DirKind::Refs);
    }
    if within(dir, &layout.git_dir) || within(dir, &layout.common_dir) {
        return None;
    }
    within(dir, &layout.root).then_some(DirKind::Worktree)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Kinds {
    pub head: bool,
    pub index: bool,
    pub refs: bool,
    pub worktree: bool,
}

impl Kinds {
    pub fn is_empty(&self) -> bool {
        !(self.head || self.index || self.refs || self.worktree)
    }

    pub fn names(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        for (on, name) in [
            (self.head, "head"),
            (self.index, "index"),
            (self.refs, "refs"),
            (self.worktree, "worktree"),
        ] {
            if on {
                out.push(name);
            }
        }
        out
    }
}

type Stamp = Option<(u64, i128, u64)>;

fn stamp_of(path: &Path) -> Stamp {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i128)
        .unwrap_or(0);
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        meta.ino()
    };
    #[cfg(not(unix))]
    let inode = 0;
    Some((meta.len(), modified, inode))
}

/// What HEAD points at: the text of the HEAD file and, for a branch, the
/// commit its ref holds. A commit moves the branch ref but never rewrites HEAD
/// itself, so the file's stamp alone would miss it.
type HeadState = Option<(String, Option<String>)>;

fn packed_ref(common_dir: &Path, name: &str) -> Option<String> {
    let text = std::fs::read_to_string(common_dir.join("packed-refs")).ok()?;
    text.lines().find_map(|line| {
        let (sha, refname) = line.split_once(' ')?;
        (refname == name).then(|| sha.to_string())
    })
}

fn head_state(layout: &Layout) -> HeadState {
    let content = std::fs::read_to_string(Path::new(&layout.git_dir).join("HEAD")).ok()?;
    let content = content.trim().to_string();
    let resolved = content.strip_prefix("ref: ").and_then(|name| {
        let common = Path::new(&layout.common_dir);
        match std::fs::read_to_string(common.join(name)) {
            Ok(sha) => Some(sha.trim().to_string()),
            Err(_) => packed_ref(common, name),
        }
    });
    Some((content, resolved))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stamps {
    head: HeadState,
    index: Stamp,
    packed_refs: Stamp,
}

impl Stamps {
    fn read(layout: &Layout) -> Self {
        Self {
            head: head_state(layout),
            index: stamp_of(&Path::new(&layout.git_dir).join("index")),
            packed_refs: stamp_of(&Path::new(&layout.common_dir).join("packed-refs")),
        }
    }

    /// The git-file kinds that moved since `previous`.
    fn diff(&self, previous: &Stamps) -> Kinds {
        Kinds {
            head: self.head != previous.head,
            index: self.index != previous.index,
            refs: self.packed_refs != previous.packed_refs,
            worktree: false,
        }
    }
}

fn walker(root: &Path) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .follow_links(false)
        .filter_entry(|entry| entry.file_name() != ".git");
    builder
}

/// Non-ignored directories under (and including) `root`, shallow ones first so
/// a budget cut drops the deepest. The bool reports a cut.
pub fn collect_worktree_dirs(root: &Path, budget: usize) -> (Vec<PathBuf>, bool) {
    let mut found: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut truncated = false;
    for limit in [Some(SHALLOW_DEPTH), None] {
        let mut builder = walker(root);
        builder.max_depth(limit);
        for entry in builder.build().flatten() {
            if !entry.file_type().is_some_and(|t| t.is_dir()) {
                continue;
            }
            let path = entry.into_path();
            if seen.contains(&path) {
                continue;
            }
            if found.len() >= budget {
                truncated = true;
                break;
            }
            seen.insert(path.clone());
            found.push(path);
        }
        if truncated {
            break;
        }
    }
    (found, truncated)
}

/// `refs` and every directory below it (branch namespaces like `feature/`).
pub fn collect_ref_dirs(common: &Path, budget: usize) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut stack = vec![common.join("refs")];
    while let Some(dir) = stack.pop() {
        if out.len() >= budget {
            break;
        }
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                stack.push(entry.path());
            }
        }
        out.push(dir);
    }
    out
}

struct RepoWatch {
    layout: Layout,
    subscribers: usize,
    stamps: Stamps,
    worktree_dirs: BTreeSet<PathBuf>,
    ref_dirs: BTreeSet<PathBuf>,
    git_dirs: Vec<PathBuf>,
    ignored: HashSet<PathBuf>,
    truncated: bool,
}

impl RepoWatch {
    fn all_dirs(&self) -> Vec<PathBuf> {
        self.worktree_dirs
            .iter()
            .chain(self.ref_dirs.iter())
            .chain(self.git_dirs.iter())
            .cloned()
            .collect()
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitWatchInfo {
    pub watching: bool,
    pub repo: String,
    pub watched_dirs: u32,
    /// The directory budget ran out: changes in deeper directories are missed
    /// and consumers should also refresh on focus.
    pub truncated: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChangedPayload {
    repo: String,
    kinds: Vec<&'static str>,
}

enum Msg {
    Subscribe {
        repo: String,
        layout: Layout,
        reply: mpsc::Sender<GitWatchInfo>,
    },
    /// Fire and forget: the caller keeps the subscriber counts, so it never has
    /// to wait on (or guess from) the worker.
    Unsubscribe {
        repo: String,
    },
    Touched(Vec<String>),
    Shutdown,
}

/// The channel to the worker thread.
trait Link {
    /// `false` when the worker is gone.
    fn send(&self, msg: Msg) -> bool;
    /// Stops the worker and whatever feeds it.
    fn retire(self);
}

struct WorkerLink {
    tx: mpsc::Sender<Msg>,
    tap_id: u64,
    app: AppHandle,
}

impl Link for WorkerLink {
    fn send(&self, msg: Msg) -> bool {
        self.tx.send(msg).is_ok()
    }

    fn retire(self) {
        self.app.state::<FsWatchState>().remove_tap(self.tap_id);
        let _ = self.tx.send(Msg::Shutdown);
    }
}

/// Subscriber counts and the worker, kept together under one lock. Counting
/// and messaging happen in the same critical section, so a subscriber can never
/// be told to a worker that a concurrent release is shutting down, and a worker
/// is shut down only when the counts say nobody is left, never because it was
/// slow to answer.
struct Inner<L: Link> {
    link: Option<L>,
    counts: HashMap<String, usize>,
}

impl<L: Link> Default for Inner<L> {
    fn default() -> Self {
        Self {
            link: None,
            counts: HashMap::new(),
        }
    }
}

impl<L: Link> Inner<L> {
    /// Counts a subscriber and queues its subscription; the answer arrives on
    /// the returned channel.
    fn attach(
        &mut self,
        key: String,
        layout: Layout,
        start: impl FnOnce() -> Result<L>,
    ) -> Result<mpsc::Receiver<GitWatchInfo>> {
        if self.link.is_none() {
            self.link = Some(start()?);
        }
        let (reply, answer) = mpsc::channel();
        let sent = self.link.as_ref().is_some_and(|link| {
            link.send(Msg::Subscribe {
                repo: key.clone(),
                layout,
                reply,
            })
        });
        if !sent {
            // The worker died: forget it and every count that depended on it.
            if let Some(dead) = self.link.take() {
                dead.retire();
            }
            self.counts.clear();
            return Err(GitError::command("git watch", "the watcher stopped"));
        }
        *self.counts.entry(key).or_insert(0) += 1;
        Ok(answer)
    }

    /// Forgets a subscriber the worker refused. The worker holds nothing for
    /// it, so nothing is sent: an `Unsubscribe` could cancel a different
    /// subscription of the same key that the worker did accept.
    fn forget(&mut self, key: &str) {
        let Some(count) = self.counts.get_mut(key) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            self.counts.remove(key);
        }
        if self.counts.is_empty() {
            if let Some(link) = self.link.take() {
                link.retire();
            }
        }
    }

    /// Drops one subscriber of `key`. A key nobody holds is ignored.
    fn release(&mut self, key: &str) {
        let Some(count) = self.counts.get_mut(key) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            self.counts.remove(key);
        }
        if let Some(link) = &self.link {
            let _ = link.send(Msg::Unsubscribe {
                repo: key.to_string(),
            });
        }
        if self.counts.is_empty() {
            if let Some(link) = self.link.take() {
                link.retire();
            }
        }
    }
}

#[derive(Default)]
pub struct GitWatchState {
    inner: Mutex<Inner<WorkerLink>>,
}

/// Everything the engine does to the outside world, so its logic runs under
/// test without an application.
trait Host: Send + 'static {
    fn watch(&self, dirs: Vec<PathBuf>) -> std::result::Result<(), String>;
    fn unwatch(&self, dirs: &[PathBuf]);
    fn emit(&self, payload: ChangedPayload);
}

struct AppHost(AppHandle);

impl Host for AppHost {
    fn watch(&self, dirs: Vec<PathBuf>) -> std::result::Result<(), String> {
        self.0.state::<FsWatchState>().watch_dirs(&self.0, dirs)
    }

    fn unwatch(&self, dirs: &[PathBuf]) {
        self.0.state::<FsWatchState>().unwatch_dirs(&self.0, dirs);
    }

    fn emit(&self, payload: ChangedPayload) {
        let _ = self.0.emit(EVENT, payload);
    }
}

struct Engine<H: Host> {
    host: H,
    repos: HashMap<String, RepoWatch>,
    /// Work counters (also what the tests assert on).
    rescans: u32,
    resyncs: u32,
}

impl<H: Host> Engine<H> {
    fn subscribe(&mut self, repo: String, layout: Layout) -> GitWatchInfo {
        if let Some(existing) = self.repos.get_mut(&repo) {
            existing.subscribers += 1;
            return info_of(&repo, existing);
        }
        let (worktree, truncated) =
            collect_worktree_dirs(Path::new(&layout.root), MAX_WORKTREE_DIRS);
        let ref_dirs: BTreeSet<PathBuf> =
            collect_ref_dirs(Path::new(&layout.common_dir), MAX_REF_DIRS)
                .into_iter()
                .collect();
        let mut git_dirs = vec![PathBuf::from(&layout.git_dir)];
        if layout.common_dir != layout.git_dir {
            git_dirs.push(PathBuf::from(&layout.common_dir));
        }
        let watch = RepoWatch {
            stamps: Stamps::read(&layout),
            layout,
            subscribers: 1,
            worktree_dirs: worktree.into_iter().collect(),
            ref_dirs,
            git_dirs,
            ignored: HashSet::new(),
            truncated,
        };
        let outcome = self.host.watch(watch.all_dirs());
        let mut info = info_of(&repo, &watch);
        if let Err(reason) = outcome {
            info.watching = false;
            info.reason = Some(reason);
            return info;
        }
        self.repos.insert(repo, watch);
        info
    }

    fn unsubscribe(&mut self, repo: &str) -> usize {
        if let Some(watch) = self.repos.get_mut(repo) {
            watch.subscribers = watch.subscribers.saturating_sub(1);
            if watch.subscribers == 0 {
                if let Some(watch) = self.repos.remove(repo) {
                    self.host.unwatch(&watch.all_dirs());
                }
            }
        }
        self.repos.len()
    }

    /// Registered directories at or below `prefix`, found by ordering alone.
    fn subtree(dirs: &BTreeSet<PathBuf>, prefix: &Path) -> Vec<PathBuf> {
        dirs.range(prefix.to_path_buf()..)
            .take_while(|d| d.starts_with(prefix))
            .cloned()
            .collect()
    }

    /// Rebuilds the registered set from the tree in one walk: the answer to a
    /// burst too wide to look at directory by directory (a checkout, a
    /// `git clean`, a branch switch).
    fn resync(&mut self, repo: &str) {
        self.resyncs += 1;
        let Some(watch) = self.repos.get_mut(repo) else {
            return;
        };
        let (found, truncated) =
            collect_worktree_dirs(Path::new(&watch.layout.root), MAX_WORKTREE_DIRS);
        let now: BTreeSet<PathBuf> = found.into_iter().collect();
        let added: Vec<PathBuf> = now.difference(&watch.worktree_dirs).cloned().collect();
        let gone: Vec<PathBuf> = watch.worktree_dirs.difference(&now).cloned().collect();
        watch.worktree_dirs = now;
        watch.truncated = truncated;
        watch.ignored.clear();
        self.host.unwatch(&gone);
        if let Err(reason) = self.host.watch(added) {
            log::debug!("git watch: could not watch new directories: {reason}");
        }
    }

    /// Keeps the registered directories in step with the tree after `dir`
    /// changed: new non-ignored subdirectories are added, vanished ones
    /// dropped. Only `dir` and its registered children are looked at on disk;
    /// anything deeper is dealt with when its own parent reports, so one touch
    /// costs a number of stats bounded by the width of `dir`, not the size of
    /// the whole watched tree.
    fn rescan(&mut self, repo: &str, dir: &Path) {
        self.rescans += 1;
        let Some(watch) = self.repos.get_mut(repo) else {
            return;
        };
        let mut gone: Vec<PathBuf> = Vec::new();
        if !dir.is_dir() {
            gone = Self::subtree(&watch.worktree_dirs, dir);
        } else {
            let children: Vec<PathBuf> = Self::subtree(&watch.worktree_dirs, dir)
                .into_iter()
                .filter(|d| d.parent() == Some(dir))
                .collect();
            for child in children {
                if !child.is_dir() {
                    gone.extend(Self::subtree(&watch.worktree_dirs, &child));
                }
            }
        }
        for path in &gone {
            watch.worktree_dirs.remove(path);
        }

        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(read) = std::fs::read_dir(dir) {
            for entry in read.flatten() {
                let path = entry.path();
                if entry.file_type().is_ok_and(|t| t.is_dir())
                    && entry.file_name() != ".git"
                    && !watch.worktree_dirs.contains(&path)
                    && !watch.ignored.contains(&path)
                {
                    candidates.push(path);
                }
            }
        }
        let mut added: Vec<PathBuf> = Vec::new();
        if !candidates.is_empty() {
            let mut shallow = walker(dir);
            shallow.max_depth(Some(1));
            let visible: HashSet<PathBuf> = shallow
                .build()
                .flatten()
                .filter(|e| e.file_type().is_some_and(|t| t.is_dir()))
                .map(|e| e.into_path())
                .collect();
            for candidate in candidates {
                if !visible.contains(&candidate) {
                    watch.ignored.insert(candidate);
                    continue;
                }
                let room = MAX_WORKTREE_DIRS.saturating_sub(watch.worktree_dirs.len());
                if room == 0 {
                    watch.truncated = true;
                    break;
                }
                let (found, cut) = collect_worktree_dirs(&candidate, room);
                watch.truncated |= cut;
                for path in found {
                    if watch.worktree_dirs.insert(path.clone()) {
                        added.push(path);
                    }
                }
            }
        }
        // A bounded ignored-set: forget it rather than grow without limit.
        if watch.ignored.len() > 4096 {
            watch.ignored.clear();
        }
        self.host.unwatch(&gone);
        if let Err(reason) = self.host.watch(added) {
            log::debug!("git watch: could not watch new directories: {reason}");
        }
    }

    fn rescan_refs(&mut self, repo: &str) {
        let Some(watch) = self.repos.get_mut(repo) else {
            return;
        };
        let now: BTreeSet<PathBuf> =
            collect_ref_dirs(Path::new(&watch.layout.common_dir), MAX_REF_DIRS)
                .into_iter()
                .collect();
        let added: Vec<PathBuf> = now.difference(&watch.ref_dirs).cloned().collect();
        let gone: Vec<PathBuf> = watch.ref_dirs.difference(&now).cloned().collect();
        watch.ref_dirs = now;
        self.host.unwatch(&gone);
        let _ = self.host.watch(added);
    }

    fn flush(&mut self, touched: HashSet<String>) {
        let repos: Vec<String> = self.repos.keys().cloned().collect();
        for repo in repos {
            let mut kinds = Kinds::default();
            let mut check_git_files = false;
            let mut worktree_dirs: Vec<String> = Vec::new();
            let mut refs_touched = false;
            if let Some(watch) = self.repos.get(&repo) {
                for dir in &touched {
                    match classify(&watch.layout, dir) {
                        Some(DirKind::GitDir | DirKind::CommonDir) => check_git_files = true,
                        Some(DirKind::Refs) => {
                            refs_touched = true;
                            kinds.refs = true;
                        }
                        Some(DirKind::Worktree) => {
                            // The shared watcher also reports directories only
                            // the explorer watches (an ignored build tree, say):
                            // those are none of this repository's business.
                            if !watch.worktree_dirs.contains(Path::new(dir.as_str())) {
                                continue;
                            }
                            kinds.worktree = true;
                            worktree_dirs.push(dir.clone());
                        }
                        None => {}
                    }
                }
            }
            if check_git_files {
                if let Some(watch) = self.repos.get_mut(&repo) {
                    let now = Stamps::read(&watch.layout);
                    let moved = now.diff(&watch.stamps);
                    watch.stamps = now;
                    kinds.head |= moved.head;
                    kinds.index |= moved.index;
                    kinds.refs |= moved.refs;
                }
            }
            if refs_touched {
                self.rescan_refs(&repo);
            }
            if worktree_dirs.len() > MAX_RESCANS_PER_FLUSH {
                self.resync(&repo);
            } else {
                for dir in worktree_dirs {
                    self.rescan(&repo, Path::new(&dir));
                }
            }
            if !kinds.is_empty() {
                self.host.emit(ChangedPayload {
                    repo: repo.clone(),
                    kinds: kinds.names(),
                });
            }
        }
    }
}

fn info_of(repo: &str, watch: &RepoWatch) -> GitWatchInfo {
    GitWatchInfo {
        watching: true,
        repo: repo.to_string(),
        watched_dirs: watch.all_dirs().len() as u32,
        truncated: watch.truncated,
        reason: None,
    }
}

fn run_worker(app: AppHandle, rx: mpsc::Receiver<Msg>) {
    let mut engine = Engine {
        host: AppHost(app),
        repos: HashMap::new(),
        rescans: 0,
        resyncs: 0,
    };
    let mut pending: HashSet<String> = HashSet::new();
    let mut window_start: Option<Instant> = None;
    loop {
        let timeout = match window_start {
            None => Duration::from_secs(3600),
            Some(start) => COALESCE.min(MAX_WINDOW.saturating_sub(start.elapsed())),
        };
        match rx.recv_timeout(timeout) {
            Ok(Msg::Subscribe {
                repo,
                layout,
                reply,
            }) => {
                let _ = reply.send(engine.subscribe(repo, layout));
            }
            Ok(Msg::Unsubscribe { repo }) => {
                engine.unsubscribe(&repo);
            }
            Ok(Msg::Touched(dirs)) => {
                window_start.get_or_insert_with(Instant::now);
                pending.extend(dirs);
                if window_start.is_some_and(|s| s.elapsed() >= MAX_WINDOW) {
                    engine.flush(std::mem::take(&mut pending));
                    window_start = None;
                }
            }
            Ok(Msg::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                let repos: Vec<String> = engine.repos.keys().cloned().collect();
                for repo in repos {
                    while engine.repos.contains_key(&repo) {
                        engine.unsubscribe(&repo);
                    }
                }
                return;
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() {
                    engine.flush(std::mem::take(&mut pending));
                }
                window_start = None;
            }
        }
    }
}

fn layout_for(repo: &crate::modules::git::utils::ResolvedGitDirectory) -> Result<Layout> {
    let git = git_dir(repo)?;
    let common = common_dir(repo)?;
    let canon = |p: PathBuf| std::fs::canonicalize(&p).unwrap_or(p);
    Ok(Layout {
        root: to_canon(&repo.local_path),
        git_dir: to_canon(canon(git)),
        common_dir: to_canon(canon(common)),
    })
}

impl GitWatchState {
    fn start_worker(app: &AppHandle) -> Result<WorkerLink> {
        let (tx, rx) = mpsc::channel::<Msg>();
        let tap_tx = Mutex::new(tx.clone());
        let tap_id = app
            .state::<FsWatchState>()
            .add_tap(Arc::new(move |dirs: &[String]| {
                if let Ok(tx) = tap_tx.lock() {
                    let _ = tx.send(Msg::Touched(dirs.to_vec()));
                }
            }));
        let worker_app = app.clone();
        if let Err(e) = std::thread::Builder::new()
            .name("terax-git-watch".into())
            .stack_size(512 * 1024)
            .spawn(move || run_worker(worker_app, rx))
        {
            app.state::<FsWatchState>().remove_tap(tap_id);
            return Err(GitError::Io(e));
        }
        Ok(WorkerLink {
            tx,
            tap_id,
            app: app.clone(),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner<WorkerLink>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn subscribe(
        &self,
        app: &AppHandle,
        registry: &WorkspaceRegistry,
        repo_root: &str,
        workspace: &WorkspaceEnv,
    ) -> Result<GitWatchInfo> {
        let repo = open_worktree(registry, repo_root, workspace)?;
        let key = repo.git_path.clone();
        if workspace.is_wsl() {
            return Ok(GitWatchInfo {
                watching: false,
                repo: key,
                watched_dirs: 0,
                truncated: false,
                reason: Some("wsl-unsupported".into()),
            });
        }
        let layout = layout_for(&repo)?;
        let answer = self
            .lock()
            .attach(key.clone(), layout, || Self::start_worker(app))?;
        // Waited for outside the lock, so a slow registration blocks nobody.
        match answer.recv_timeout(SUBSCRIBE_TIMEOUT) {
            Ok(info) if info.watching => Ok(info),
            Ok(refused) => {
                self.lock().forget(&key);
                Ok(refused)
            }
            Err(_) => {
                // The subscription is still queued; releasing queues its undo
                // right behind it.
                self.lock().release(&key);
                Err(GitError::command("git watch", "the watcher did not answer"))
            }
        }
    }

    /// Releases one subscription by the `repo` key `subscribe` returned. It
    /// touches no repository, so it works after the worktree is gone.
    pub fn unsubscribe(&self, key: &str) {
        self.lock().release(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::git::testutil::TestRepo;

    type Event = (String, Vec<&'static str>);

    #[derive(Clone, Default)]
    struct FakeHost {
        watched: Arc<Mutex<BTreeSet<PathBuf>>>,
        events: Arc<Mutex<Vec<Event>>>,
    }

    impl Host for FakeHost {
        fn watch(&self, dirs: Vec<PathBuf>) -> std::result::Result<(), String> {
            self.watched.lock().unwrap().extend(dirs);
            Ok(())
        }

        fn unwatch(&self, dirs: &[PathBuf]) {
            let mut watched = self.watched.lock().unwrap();
            for dir in dirs {
                watched.remove(dir);
            }
        }

        fn emit(&self, payload: ChangedPayload) {
            self.events
                .lock()
                .unwrap()
                .push((payload.repo, payload.kinds));
        }
    }

    fn engine_for(repo: &TestRepo) -> (Engine<FakeHost>, FakeHost, String, Layout) {
        let host = FakeHost::default();
        let engine = Engine {
            host: host.clone(),
            repos: HashMap::new(),
            rescans: 0,
            resyncs: 0,
        };
        let resolved = open_worktree(&repo.registry, &repo.path(), &repo.ws).unwrap();
        let layout = layout_for(&resolved).unwrap();
        (engine, host, resolved.git_path, layout)
    }

    fn touched(dirs: &[&str]) -> HashSet<String> {
        dirs.iter().map(|d| d.to_string()).collect()
    }

    fn events(host: &FakeHost) -> Vec<Vec<&'static str>> {
        std::mem::take(&mut *host.events.lock().unwrap())
            .into_iter()
            .map(|(_, kinds)| kinds)
            .collect()
    }

    #[test]
    fn subscribing_watches_the_tree_git_dirs_and_refs_and_unsubscribing_releases_everything() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "node_modules/\n");
        repo.write("src/lib/mod.rs", "x\n");
        repo.write("node_modules/pkg/index.js", "x\n");
        repo.commit_all("tree");
        repo.git(&["branch", "feature/deep"]);

        let (mut engine, host, key, layout) = engine_for(&repo);
        let info = engine.subscribe(key.clone(), layout.clone());
        assert!(info.watching && !info.truncated);
        let watched = host.watched.lock().unwrap().clone();
        let has = |path: PathBuf| watched.contains(&path);
        assert!(has(repo.root.clone()));
        assert!(has(repo.root.join("src/lib")));
        assert!(has(repo.root.join(".git")));
        assert!(has(repo.root.join(".git/refs/heads")));
        assert!(has(repo.root.join(".git/refs/heads/feature")));
        assert!(
            !has(repo.root.join("node_modules")),
            "ignored directories cost nothing"
        );
        assert!(!has(repo.root.join(".git/objects")));
        assert_eq!(info.watched_dirs as usize, watched.len());

        engine.subscribe(key.clone(), layout);
        assert_eq!(engine.unsubscribe(&key), 1, "still subscribed once");
        assert!(!host.watched.lock().unwrap().is_empty());
        assert_eq!(engine.unsubscribe(&key), 0);
        assert!(
            host.watched.lock().unwrap().is_empty(),
            "no subscribers, no OS watches"
        );
    }

    #[test]
    fn committing_reports_head_index_and_refs_once() {
        let repo = TestRepo::new();
        let (mut engine, host, key, layout) = engine_for(&repo);
        engine.subscribe(key, layout.clone());

        repo.write("a.txt", "a\n");
        repo.commit_all("second");
        let heads = format!("{}/refs/heads", layout.common_dir);
        engine.flush(touched(&[&layout.git_dir, &heads]));
        assert_eq!(events(&host), vec![vec!["head", "index", "refs"]]);

        engine.flush(touched(&[&layout.git_dir]));
        assert!(
            events(&host).is_empty(),
            "nothing moved since the last report"
        );
    }

    #[test]
    fn staging_alone_reports_only_the_index_and_noise_in_git_reports_nothing() {
        let repo = TestRepo::new();
        let (mut engine, host, key, layout) = engine_for(&repo);
        engine.subscribe(key, layout.clone());

        repo.write("a.txt", "a\n");
        repo.git(&["add", "a.txt"]);
        engine.flush(touched(&[&layout.git_dir]));
        assert_eq!(events(&host), vec![vec!["index"]]);

        std::fs::write(repo.root.join(".git/FETCH_HEAD"), "").unwrap();
        engine.flush(touched(&[&layout.git_dir]));
        assert!(events(&host).is_empty());
        engine.flush(touched(&[&format!("{}/objects/ab", layout.common_dir)]));
        assert!(events(&host).is_empty(), "object writes are not reported");
    }

    #[test]
    fn worktree_edits_report_worktree_and_new_directories_are_picked_up() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "node_modules/\n");
        repo.write("src/a.rs", "a\n");
        repo.commit_all("base");
        let (mut engine, host, key, layout) = engine_for(&repo);
        engine.subscribe(key, layout.clone());

        let src = repo.root.join("src");
        std::fs::create_dir_all(src.join("new/inner")).unwrap();
        std::fs::create_dir_all(src.join("node_modules/pkg")).unwrap();
        repo.write("src/new/inner/file.rs", "x\n");
        engine.flush(touched(&[&to_canon(&src)]));
        assert_eq!(events(&host), vec![vec!["worktree"]]);
        let watched = host.watched.lock().unwrap().clone();
        assert!(watched.contains(&src.join("new")));
        assert!(watched.contains(&src.join("new/inner")));
        assert!(!watched.contains(&src.join("node_modules")));

        std::fs::remove_dir_all(src.join("new")).unwrap();
        engine.flush(touched(&[&to_canon(&src)]));
        let watched = host.watched.lock().unwrap().clone();
        assert!(!watched.contains(&src.join("new")));
        assert!(!watched.contains(&src.join("new/inner")));
        assert!(watched.contains(&src));
    }

    #[test]
    fn a_linked_worktree_watches_the_shared_refs_and_its_own_head() {
        let repo = TestRepo::new();
        let (_scratch_keep, scratch_root) = crate::modules::git::testutil::scratch();
        let linked = scratch_root.join("wt");
        repo.git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "task",
            &linked.to_string_lossy(),
        ]);
        repo.registry.authorize(&linked).unwrap();

        let host = FakeHost::default();
        let mut engine = Engine {
            host: host.clone(),
            repos: HashMap::new(),
            rescans: 0,
            resyncs: 0,
        };
        let resolved = open_worktree(&repo.registry, &linked.to_string_lossy(), &repo.ws).unwrap();
        let layout = layout_for(&resolved).unwrap();
        assert_ne!(layout.git_dir, layout.common_dir);
        engine.subscribe(resolved.git_path.clone(), layout.clone());
        let watched = host.watched.lock().unwrap().clone();
        assert!(watched.contains(&PathBuf::from(&layout.git_dir)));
        assert!(watched.contains(&PathBuf::from(&layout.common_dir)));
        assert!(watched.contains(&PathBuf::from(&layout.common_dir).join("refs/heads")));
        assert!(watched.contains(&linked));

        crate::modules::git::testutil::git_in(
            &linked,
            &["commit", "-q", "--allow-empty", "-m", "in task"],
        );
        let heads = format!("{}/refs/heads", layout.common_dir);
        engine.flush(touched(&[&layout.git_dir, &heads]));
        let reported = events(&host);
        assert_eq!(reported.len(), 1);
        assert!(reported[0].contains(&"head") && reported[0].contains(&"refs"));
    }

    #[derive(Default)]
    struct LinkLog {
        messages: Mutex<Vec<String>>,
        retired: std::sync::atomic::AtomicBool,
        sent_after_retire: std::sync::atomic::AtomicU32,
        dead: std::sync::atomic::AtomicBool,
    }

    #[derive(Clone)]
    struct FakeLink(Arc<LinkLog>);

    impl Link for FakeLink {
        fn send(&self, msg: Msg) -> bool {
            use std::sync::atomic::Ordering::SeqCst;
            if self.0.dead.load(SeqCst) {
                return false;
            }
            if self.0.retired.load(SeqCst) {
                self.0.sent_after_retire.fetch_add(1, SeqCst);
            }
            let text = match msg {
                Msg::Subscribe { repo, .. } => format!("subscribe {repo}"),
                Msg::Unsubscribe { repo } => format!("unsubscribe {repo}"),
                Msg::Touched(_) => "touched".to_string(),
                Msg::Shutdown => "shutdown".to_string(),
            };
            self.0.messages.lock().unwrap().push(text);
            true
        }

        fn retire(self) {
            self.0
                .retired
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn lay() -> Layout {
        Layout {
            root: "/r".into(),
            git_dir: "/r/.git".into(),
            common_dir: "/r/.git".into(),
        }
    }

    fn attach(inner: &mut Inner<FakeLink>, key: &str, started: &mut Vec<FakeLink>) {
        inner
            .attach(key.to_string(), lay(), || {
                let link = FakeLink(Arc::new(LinkLog::default()));
                started.push(link.clone());
                Ok(link)
            })
            .unwrap();
    }

    #[test]
    fn the_worker_lives_exactly_as_long_as_somebody_is_subscribed() {
        let mut inner = Inner::<FakeLink>::default();
        let mut started = Vec::new();
        attach(&mut inner, "/a", &mut started);
        attach(&mut inner, "/a", &mut started);
        attach(&mut inner, "/b", &mut started);
        assert_eq!(started.len(), 1, "one worker serves every repository");

        inner.release("/a");
        inner.release("/b");
        assert!(!started[0]
            .0
            .retired
            .load(std::sync::atomic::Ordering::SeqCst));
        inner.release("/a");
        assert!(started[0]
            .0
            .retired
            .load(std::sync::atomic::Ordering::SeqCst));
        assert!(inner.link.is_none() && inner.counts.is_empty());
    }

    #[test]
    fn releasing_an_unknown_key_never_shuts_anything_down() {
        let mut inner = Inner::<FakeLink>::default();
        let mut started = Vec::new();
        attach(&mut inner, "/a", &mut started);
        inner.release("/never-subscribed");
        inner.release("/never-subscribed");
        assert!(!started[0]
            .0
            .retired
            .load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(inner.counts.get("/a"), Some(&1));
        assert_eq!(*started[0].0.messages.lock().unwrap(), vec!["subscribe /a"]);
    }

    #[test]
    fn a_refused_subscriber_is_forgotten_without_telling_the_worker() {
        use std::sync::atomic::Ordering::SeqCst;
        let mut inner = Inner::<FakeLink>::default();
        let mut started = Vec::new();
        attach(&mut inner, "/a", &mut started);
        attach(&mut inner, "/a", &mut started);

        // The second subscription was refused by the worker: an `Unsubscribe`
        // would cancel the first one, which the worker did accept.
        inner.forget("/a");
        let log = &started[0].0;
        assert_eq!(
            *log.messages.lock().unwrap(),
            vec!["subscribe /a", "subscribe /a"],
            "nothing is sent for a subscriber the worker never held"
        );
        assert_eq!(inner.counts.get("/a"), Some(&1));
        assert!(!log.retired.load(SeqCst));

        inner.forget("/never-subscribed");
        assert_eq!(inner.counts.get("/a"), Some(&1));
        assert!(!log.retired.load(SeqCst));

        inner.forget("/a");
        assert!(log.retired.load(SeqCst), "nobody left: the worker goes");
        assert!(inner.link.is_none() && inner.counts.is_empty());
        assert_eq!(log.messages.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_touch_in_a_directory_the_repository_does_not_watch_reports_nothing() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "build/\n");
        repo.write("src/a.rs", "a\n");
        repo.commit_all("base");
        std::fs::create_dir_all(repo.root.join("build/out")).unwrap();
        let (mut engine, host, key, layout) = engine_for(&repo);
        engine.subscribe(key, layout);
        assert!(!host
            .watched
            .lock()
            .unwrap()
            .contains(&repo.root.join("build")));

        // The shared watcher reports every directory anyone watches, such as
        // the explorer's view of an ignored build tree.
        engine.flush(touched(&[
            &to_canon(repo.root.join("build")),
            &to_canon(repo.root.join("build/out")),
        ]));
        assert!(events(&host).is_empty());
        assert_eq!((engine.rescans, engine.resyncs), (0, 0));

        engine.flush(touched(&[&to_canon(repo.root.join("src"))]));
        assert_eq!(events(&host), vec![vec!["worktree"]]);
        assert_eq!(engine.rescans, 1);
    }

    #[test]
    fn a_subscriber_after_the_last_release_gets_a_live_worker_not_the_retired_one() {
        let mut inner = Inner::<FakeLink>::default();
        let mut started = Vec::new();
        attach(&mut inner, "/a", &mut started);
        inner.release("/a");
        attach(&mut inner, "/b", &mut started);
        assert_eq!(started.len(), 2);
        let first = &started[0].0;
        let second = &started[1].0;
        assert!(first.retired.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(
            first
                .sent_after_retire
                .load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        assert!(!second.retired.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(*second.messages.lock().unwrap(), vec!["subscribe /b"]);
    }

    #[test]
    fn concurrent_subscribers_and_releasers_never_reach_a_retired_worker() {
        let inner = Arc::new(Mutex::new(Inner::<FakeLink>::default()));
        let started: Arc<Mutex<Vec<FakeLink>>> = Arc::new(Mutex::new(Vec::new()));
        let threads: Vec<_> = (0..6)
            .map(|n| {
                let inner = inner.clone();
                let started = started.clone();
                std::thread::spawn(move || {
                    let key = format!("/repo-{}", n % 3);
                    for _ in 0..300 {
                        inner
                            .lock()
                            .unwrap()
                            .attach(key.clone(), lay(), || {
                                let link = FakeLink(Arc::new(LinkLog::default()));
                                started.lock().unwrap().push(link.clone());
                                Ok(link)
                            })
                            .unwrap();
                        inner.lock().unwrap().release(&key);
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        let inner = inner.lock().unwrap();
        assert!(inner.link.is_none() && inner.counts.is_empty());
        let started = started.lock().unwrap();
        assert!(!started.is_empty());
        for link in started.iter() {
            assert!(link.0.retired.load(std::sync::atomic::Ordering::SeqCst));
            assert_eq!(
                link.0
                    .sent_after_retire
                    .load(std::sync::atomic::Ordering::SeqCst),
                0
            );
        }
    }

    #[test]
    fn a_dead_worker_is_replaced_and_its_counts_forgotten() {
        let mut inner = Inner::<FakeLink>::default();
        let mut started = Vec::new();
        attach(&mut inner, "/a", &mut started);
        started[0]
            .0
            .dead
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let refused = inner.attach("/b".into(), lay(), || {
            Ok(FakeLink(Arc::new(LinkLog::default())))
        });
        assert!(refused.is_err());
        assert!(inner.link.is_none() && inner.counts.is_empty());
        attach(&mut inner, "/b", &mut started);
        assert_eq!(
            started.len(),
            2,
            "the next subscriber starts a fresh worker"
        );
    }

    #[test]
    fn a_watch_is_released_by_its_key_after_the_worktree_is_gone() {
        let repo = TestRepo::new();
        let (_scratch_keep, scratch_root) = crate::modules::git::testutil::scratch();
        let linked = scratch_root.join("wt");
        repo.git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "gone",
            &linked.to_string_lossy(),
        ]);
        repo.registry.authorize(&linked).unwrap();

        let host = FakeHost::default();
        let mut engine = Engine {
            host: host.clone(),
            repos: HashMap::new(),
            rescans: 0,
            resyncs: 0,
        };
        let resolved = open_worktree(&repo.registry, &linked.to_string_lossy(), &repo.ws).unwrap();
        let layout = layout_for(&resolved).unwrap();
        let key = resolved.git_path.clone();
        engine.subscribe(key.clone(), layout);
        assert!(!host.watched.lock().unwrap().is_empty());

        // Normal flow: the worktree is removed, then the view unmounts.
        std::fs::remove_dir_all(&linked).unwrap();
        repo.git(&["worktree", "prune"]);
        assert!(open_worktree(&repo.registry, &linked.to_string_lossy(), &repo.ws).is_err());

        assert_eq!(engine.unsubscribe(&key), 0);
        assert!(
            host.watched.lock().unwrap().is_empty(),
            "every registered directory is released without touching git"
        );
    }

    #[test]
    fn a_touch_only_looks_at_its_directory_and_that_directorys_children() {
        let repo = TestRepo::new();
        for dir in ["a/b/c", "a/d", "x/y/z"] {
            std::fs::create_dir_all(repo.root.join(dir)).unwrap();
            repo.write(&format!("{dir}/f.txt"), "x\n");
        }
        repo.commit_all("tree");
        let (mut engine, host, key, layout) = engine_for(&repo);
        engine.subscribe(key, layout);
        let watched =
            |h: &FakeHost, rel: &str| h.watched.lock().unwrap().contains(&repo.root.join(rel));
        assert!(watched(&host, "a/b/c"));

        // Two levels down vanish without their parent being reported.
        std::fs::remove_dir_all(repo.root.join("a/b/c")).unwrap();
        engine.flush(touched(&[&to_canon(&repo.root)]));
        assert!(
            watched(&host, "a/b/c"),
            "a root touch does not stat every descendant"
        );
        assert_eq!(engine.rescans, 1);

        // The parent's own report cleans it up.
        engine.flush(touched(&[&to_canon(repo.root.join("a/b"))]));
        assert!(!watched(&host, "a/b/c"));
        assert!(watched(&host, "a/b"));

        // A removed child takes its whole registered subtree with it.
        std::fs::remove_dir_all(repo.root.join("x")).unwrap();
        engine.flush(touched(&[&to_canon(&repo.root)]));
        assert!(!watched(&host, "x") && !watched(&host, "x/y") && !watched(&host, "x/y/z"));
    }

    #[test]
    fn a_burst_wider_than_the_rescan_budget_is_answered_with_one_resync() {
        let repo = TestRepo::new();
        for i in 0..(MAX_RESCANS_PER_FLUSH + 10) {
            std::fs::create_dir_all(repo.root.join(format!("d{i:03}"))).unwrap();
        }
        let (mut engine, host, key, layout) = engine_for(&repo);
        engine.subscribe(key, layout);
        std::fs::create_dir_all(repo.root.join("brand-new/inner")).unwrap();
        std::fs::remove_dir_all(repo.root.join("d000")).unwrap();

        let dirs: Vec<String> = (1..(MAX_RESCANS_PER_FLUSH + 10))
            .map(|i| to_canon(repo.root.join(format!("d{i:03}"))))
            .collect();
        let refs: Vec<&str> = dirs.iter().map(String::as_str).collect();
        engine.flush(touched(&refs));
        assert_eq!((engine.rescans, engine.resyncs), (0, 1));
        let watched = host.watched.lock().unwrap().clone();
        assert!(watched.contains(&repo.root.join("brand-new/inner")));
        assert!(!watched.contains(&repo.root.join("d000")));
    }

    fn layout() -> Layout {
        Layout {
            root: "/w/repo".into(),
            git_dir: "/m/.git/worktrees/repo".into(),
            common_dir: "/m/.git".into(),
        }
    }

    #[test]
    fn classifies_git_and_worktree_directories() {
        let l = layout();
        assert_eq!(
            classify(&l, "/m/.git/worktrees/repo"),
            Some(DirKind::GitDir)
        );
        assert_eq!(classify(&l, "/m/.git"), Some(DirKind::CommonDir));
        assert_eq!(classify(&l, "/m/.git/refs"), Some(DirKind::Refs));
        assert_eq!(
            classify(&l, "/m/.git/refs/heads/feature"),
            Some(DirKind::Refs)
        );
        assert_eq!(classify(&l, "/m/.git/objects/ab"), None);
        assert_eq!(classify(&l, "/m/.git/worktrees/repo/logs"), None);
        assert_eq!(classify(&l, "/w/repo"), Some(DirKind::Worktree));
        assert_eq!(classify(&l, "/w/repo/src/deep"), Some(DirKind::Worktree));
        assert_eq!(classify(&l, "/w/repository"), None);
        assert_eq!(classify(&l, "/elsewhere"), None);
    }

    #[test]
    fn main_worktree_layout_has_one_git_directory() {
        let l = Layout {
            root: "/w/repo".into(),
            git_dir: "/w/repo/.git".into(),
            common_dir: "/w/repo/.git".into(),
        };
        assert_eq!(classify(&l, "/w/repo/.git"), Some(DirKind::GitDir));
        assert_eq!(classify(&l, "/w/repo/.git/refs/heads"), Some(DirKind::Refs));
        assert_eq!(classify(&l, "/w/repo/.git/hooks"), None);
        assert_eq!(classify(&l, "/w/repo/src"), Some(DirKind::Worktree));
    }

    #[test]
    fn kinds_list_in_a_stable_order() {
        let kinds = Kinds {
            head: true,
            index: false,
            refs: true,
            worktree: true,
        };
        assert_eq!(kinds.names(), vec!["head", "refs", "worktree"]);
        assert!(Kinds::default().is_empty());
        assert!(!kinds.is_empty());
    }

    #[test]
    fn stamps_report_only_the_files_that_moved() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(root.join("index"), "i").unwrap();
        let l = Layout {
            root: to_canon(&root),
            git_dir: to_canon(&root),
            common_dir: to_canon(&root),
        };
        let before = Stamps::read(&l);
        assert_eq!(Stamps::read(&l).diff(&before), Kinds::default());

        std::fs::write(root.join("index"), "a different index").unwrap();
        let moved = Stamps::read(&l).diff(&before);
        assert!(moved.index && !moved.head && !moved.refs);

        std::fs::write(root.join("packed-refs"), "# pack-refs\n").unwrap();
        assert!(Stamps::read(&l).diff(&before).refs);
    }

    #[test]
    fn worktree_dirs_skip_ignored_and_git_directories_and_report_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::create_dir_all(root.join("src/deep/er")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join("nested/ignored_here")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();
        std::fs::write(root.join("nested/.gitignore"), "ignored_here/\n").unwrap();

        let (dirs, truncated) = collect_worktree_dirs(&root, 100);
        assert!(!truncated);
        let rel: BTreeSet<String> = dirs
            .iter()
            .map(|d| {
                d.strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        for expected in ["", "src", "src/deep", "src/deep/er", "nested"] {
            assert!(rel.contains(expected), "{expected} missing from {rel:?}");
        }
        for unexpected in [
            ".git",
            ".git/objects",
            "node_modules",
            "node_modules/pkg",
            "nested/ignored_here",
        ] {
            assert!(!rel.contains(unexpected), "{unexpected} should be skipped");
        }

        let (limited, cut) = collect_worktree_dirs(&root, 2);
        assert_eq!(limited.len(), 2);
        assert!(cut);
        assert_eq!(limited[0], root, "the root always comes first");
    }

    #[test]
    fn ref_dirs_include_namespaces() {
        let dir = tempfile::tempdir().unwrap();
        let common = dir.path();
        std::fs::create_dir_all(common.join("refs/heads/feature")).unwrap();
        std::fs::create_dir_all(common.join("refs/remotes/origin")).unwrap();
        let dirs = collect_ref_dirs(common, 100);
        let rel: BTreeSet<_> = dirs
            .iter()
            .map(|d| {
                d.strip_prefix(common)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        for expected in [
            "refs",
            "refs/heads",
            "refs/heads/feature",
            "refs/remotes",
            "refs/remotes/origin",
        ] {
            assert!(rel.contains(expected), "{expected}");
        }
        assert_eq!(collect_ref_dirs(common, 2).len(), 2);
    }
}
