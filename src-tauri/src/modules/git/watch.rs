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
    Unsubscribe {
        repo: String,
        reply: mpsc::Sender<usize>,
    },
    Touched(Vec<String>),
    Shutdown,
}

struct Worker {
    tx: mpsc::Sender<Msg>,
    tap_id: u64,
}

#[derive(Default)]
pub struct GitWatchState {
    worker: Mutex<Option<Worker>>,
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

    /// Keeps the registered directories in step with the tree: new non-ignored
    /// subdirectories of `dir` are added, vanished ones dropped.
    fn rescan(&mut self, repo: &str, dir: &Path) {
        let Some(watch) = self.repos.get_mut(repo) else {
            return;
        };
        let mut gone: Vec<PathBuf> = watch
            .worktree_dirs
            .range(dir.to_path_buf()..)
            .take_while(|d| d.starts_with(dir))
            .filter(|d| !d.is_dir())
            .cloned()
            .collect();
        gone.sort();
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
            for dir in worktree_dirs {
                self.rescan(&repo, Path::new(&dir));
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
            Ok(Msg::Unsubscribe { repo, reply }) => {
                let _ = reply.send(engine.unsubscribe(&repo));
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
    fn ensure_worker(&self, app: &AppHandle) -> Result<mpsc::Sender<Msg>> {
        let mut guard = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(worker) = guard.as_ref() {
            return Ok(worker.tx.clone());
        }
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
        std::thread::Builder::new()
            .name("terax-git-watch".into())
            .stack_size(512 * 1024)
            .spawn(move || run_worker(worker_app, rx))
            .map_err(GitError::Io)?;
        *guard = Some(Worker {
            tx: tx.clone(),
            tap_id,
        });
        Ok(tx)
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
        let tx = self.ensure_worker(app)?;
        let (reply, answer) = mpsc::channel();
        tx.send(Msg::Subscribe {
            repo: key,
            layout,
            reply,
        })
        .map_err(|_| GitError::command("git watch", "watcher stopped"))?;
        answer
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| GitError::command("git watch", "watcher did not answer"))
    }

    pub fn unsubscribe(
        &self,
        app: &AppHandle,
        registry: &WorkspaceRegistry,
        repo_root: &str,
        workspace: &WorkspaceEnv,
    ) -> Result<()> {
        let repo = open_worktree(registry, repo_root, workspace)?;
        let mut guard = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        let Some(worker) = guard.as_ref() else {
            return Ok(());
        };
        let (reply, answer) = mpsc::channel();
        if worker
            .tx
            .send(Msg::Unsubscribe {
                repo: repo.git_path.clone(),
                reply,
            })
            .is_err()
        {
            *guard = None;
            return Ok(());
        }
        let remaining = answer.recv_timeout(Duration::from_secs(30)).unwrap_or(0);
        if remaining == 0 {
            if let Some(worker) = guard.take() {
                app.state::<FsWatchState>().remove_tap(worker.tap_id);
                let _ = worker.tx.send(Msg::Shutdown);
            }
        }
        Ok(())
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
        let scratch = tempfile::tempdir().unwrap();
        let linked = std::fs::canonicalize(scratch.path()).unwrap().join("wt");
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
                    .into_owned()
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
                    .into_owned()
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
