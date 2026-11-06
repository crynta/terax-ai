//! Per-agent-turn checkpoints. A checkpoint is a commit object reachable only
//! from `refs/terax/checkpoints/<task>/<turn>`, built from a private copy of
//! the index, so the user's index, HEAD, branches and working files are never
//! touched by creating one. Restoring does write the working tree (and syncs the
//! index entries of the files it changed), but only the paths that differ.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::modules::git::diff::{parse_raw_numstat_z, DiffFileSummary, FileStatus};
use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::plumbing::{
    git_dir, head_commit_opt, lock_for_repo, open_worktree, os_args, run, run_ok, stdout_text,
    verify_tree,
};
use crate::modules::git::process::{ensure_success, run_git_with, RunOptions};
use crate::modules::git::refs;
use crate::modules::git::types::{GitOutput, NETWORK_TIMEOUT_SECS};
use crate::modules::git::utils::ResolvedGitDirectory;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

/// Snapshot passes before giving up on a quiet moment. Each extra pass costs a
/// stat walk, not a rehash, because the private index already knows every file.
const MAX_PASSES: u32 = 3;
/// Extra attempts per pass on top of one per excluded file.
const ADD_ATTEMPTS: u32 = 3;
const MAX_UNSTABLE_FILES: usize = 50;
const INDEX_SYNC_CHUNK: usize = 100;
const MAX_DIRTY_REPORTED: usize = 200;
const SNAPSHOT_TIMEOUT_SECS: u64 = NETWORK_TIMEOUT_SECS;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

const WORKTREE_ID_FILE: &str = "terax-worktree-id";
const LAST_RESTORE_FILE: &str = "terax-last-restore";
const NO_HOOKS_DIR: &str = "terax-no-hooks";

static ID_LOCK: Mutex<()> = Mutex::new(());

/// A worktree's private git directory (`.git`, or `.git/worktrees/<name>`) and
/// what checkpoints keep in it: an empty hooks directory, the worktree's random
/// id and the marker of the last restore. It moves with the worktree, so
/// renaming or moving the directory does not orphan anything.
struct Admin {
    dir: PathBuf,
    hooks: PathBuf,
}

fn is_valid_worktree_id(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

impl Admin {
    fn new(repo: &ResolvedGitDirectory) -> Result<Self> {
        let dir = git_dir(repo)?;
        let hooks = dir.join(NO_HOOKS_DIR);
        Ok(Self { dir, hooks })
    }

    /// `args` behind the plumbing config (see `plumbing_config`); makes sure the
    /// empty hooks directory exists.
    fn plumb(&self, args: Vec<OsString>) -> Result<Vec<OsString>> {
        std::fs::create_dir_all(&self.hooks)?;
        Ok(with_plumbing_config(&self.hooks, args))
    }

    /// The id, if this worktree ever made a checkpoint. Reading never writes.
    fn existing_worktree_id(&self) -> Option<String> {
        std::fs::read_to_string(self.dir.join(WORKTREE_ID_FILE))
            .ok()
            .map(|t| t.trim().to_string())
            .filter(|t| is_valid_worktree_id(t))
    }

    /// The id every checkpoint of this worktree is stamped with, created once
    /// from the system's random source and kept in the git directory.
    fn worktree_id(&self) -> Result<String> {
        let read = || self.existing_worktree_id();
        if let Some(id) = read() {
            return Ok(id);
        }
        let _guard = ID_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(id) = read() {
            return Ok(id);
        }
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes)
            .map_err(|e| GitError::command("git checkpoint", format!("no random source: {e}")))?;
        let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        publish_worktree_id(&self.dir, &id, &|from, to| std::fs::hard_link(from, to))?;
        read().ok_or_else(|| GitError::command("git checkpoint", "could not record the worktree id"))
    }
}

/// Writes `id` to the worktree-id file without ever replacing an existing one.
/// The preferred way is to write the id whole under a temporary name and hard
/// link it into place, so a reader never sees half an id. File systems without
/// hard links (FAT32, exFAT, some network mounts) fall back to creating the
/// final file exclusively; a reader that catches it half written rejects it,
/// because a valid id is exactly 32 hex digits, and a lost race is not an error
/// either way.
fn publish_worktree_id(
    dir: &Path,
    id: &str,
    link: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    use std::io::Write;
    let path = dir.join(WORKTREE_ID_FILE);
    let staging = dir.join(format!("{WORKTREE_ID_FILE}.{id}"));
    std::fs::write(&staging, id)?;
    let linked = link(&staging, &path);
    let _ = std::fs::remove_file(&staging);
    match linked {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(_) => match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => file.write_all(id.as_bytes()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(e) => Err(e),
        },
    }
}

/// Gives the private copy of the index the real one's modification time.
///
/// Git trusts an entry's cached stat data only if the entry is older than the
/// index file itself ("racy git"): a file rewritten within the timestamp
/// granularity of the moment it was indexed, with the same size, looks unchanged
/// otherwise. A plain copy carries a fresh mtime and would hide exactly those
/// edits. The copy of a read-only index is read-only too, so it is made
/// owner-writable first (only that bit: never group or world).
fn keep_modification_time(real: &Path, copy: &Path) -> std::io::Result<()> {
    let modified = std::fs::metadata(real)?.modified()?;
    make_owner_writable(copy)?;
    std::fs::OpenOptions::new()
        .write(true)
        .open(copy)?
        .set_modified(modified)
}

#[cfg(unix)]
fn make_owner_writable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_mode(permissions.mode() | 0o200);
    std::fs::set_permissions(path, permissions)
}

#[cfg(windows)]
#[allow(
    clippy::permissions_set_readonly_false,
    reason = "on Windows this only clears FILE_ATTRIBUTE_READONLY of our own private copy"
)]
fn make_owner_writable(path: &Path) -> std::io::Result<()> {
    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_readonly(false);
    std::fs::set_permissions(path, permissions)
}

#[cfg(not(any(unix, windows)))]
fn make_owner_writable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// A throwaway index file inside the git directory, removed on drop.
struct TempIndex {
    path: PathBuf,
    hooks: PathBuf,
}

impl TempIndex {
    /// Seeds the copy from the real index when there is one, so unchanged files
    /// are recognized by their cached stat data and never rehashed.
    fn seeded(repo: &ResolvedGitDirectory) -> Result<Self> {
        let admin = Admin::new(repo)?;
        std::fs::create_dir_all(&admin.hooks)?;
        let dir = admin.dir;
        let unique = format!(
            "terax-snapshot-{}-{}-{}.index",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        // Built before anything can fail, so `Drop` removes the copy on every path.
        let temp = Self {
            path: dir.join(unique),
            hooks: admin.hooks,
        };
        let real = dir.join("index");
        if real.is_file() {
            std::fs::copy(&real, &temp.path)?;
            if keep_modification_time(&real, &temp.path).is_err() {
                // A copy that cannot be dated like the original would hide edits
                // (see `keep_modification_time`). An index that knows nothing is
                // slower, since every file is read again, but exact.
                let _ = std::fs::remove_file(&temp.path);
            }
        }
        Ok(temp)
    }

    fn empty(repo: &ResolvedGitDirectory) -> Result<Self> {
        let temp = Self::seeded(repo)?;
        let _ = std::fs::remove_file(&temp.path);
        Ok(temp)
    }

    fn options(&self, stdin: Option<Vec<u8>>) -> RunOptions {
        RunOptions {
            env: vec![(
                OsString::from("GIT_INDEX_FILE"),
                crate::modules::git::utils::git_arg(&self.path),
            )],
            stdin,
            stdout_cap: 0,
        }
    }
}

impl Drop for TempIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let mut lock = self.path.clone().into_os_string();
        lock.push(".lock");
        let _ = std::fs::remove_file(PathBuf::from(lock));
    }
}

/// Config for every plumbing call a checkpoint makes: no filesystem-monitor
/// daemon is started or consulted, no hook of the user's can run (`hooks` is a
/// real, empty directory, which every platform resolves the same way), and a
/// file with mixed line endings is snapshotted instead of failing
/// `core.safecrlf`.
pub fn plumbing_config(hooks: &Path) -> Vec<OsString> {
    let mut hooks_arg = OsString::from("core.hooksPath=");
    hooks_arg.push(crate::modules::git::utils::git_arg(hooks));
    let mut args = os_args(["-c", "core.fsmonitor=false", "-c"]);
    args.push(hooks_arg);
    args.extend(os_args(["-c", "core.safecrlf=false"]));
    args
}

fn with_plumbing_config(hooks: &Path, args: Vec<OsString>) -> Vec<OsString> {
    let mut full = plumbing_config(hooks);
    full.extend(args);
    full
}

/// The modification time of a freshly seeded private index (test hook).
#[cfg(test)]
pub(crate) fn seeded_index_mtime_for_tests(
    repo: &ResolvedGitDirectory,
) -> Result<std::time::SystemTime> {
    let temp = TempIndex::seeded(repo)?;
    Ok(std::fs::metadata(&temp.path)?.modified()?)
}

fn run_indexed(
    repo: &ResolvedGitDirectory,
    temp: &TempIndex,
    args: Vec<OsString>,
    stdin: Option<Vec<u8>>,
) -> Result<GitOutput> {
    run_git_with(
        &repo.workspace,
        Some(&repo.git_path),
        with_plumbing_config(&temp.hooks, args),
        SNAPSHOT_TIMEOUT_SECS,
        temp.options(stdin),
    )
}

#[derive(Debug)]
pub struct Snapshot {
    pub tree: String,
    pub consistent: bool,
    pub passes: u32,
    pub warnings: Vec<String>,
    /// Files that kept disappearing under the snapshot and were left out; for a
    /// tracked file the index's version is recorded instead.
    pub unstable_paths: Vec<String>,
}

fn ensure_supported(repo: &ResolvedGitDirectory) -> Result<()> {
    if repo.workspace.is_wsl() {
        return Err(GitError::Unsupported(
            "checkpoints are not supported in WSL workspaces yet",
        ));
    }
    Ok(())
}

fn warn(warnings: &mut Vec<String>, code: &str) {
    if !warnings.iter().any(|w| w == code) {
        warnings.push(code.to_string());
    }
}

/// The file git reports it could not `stat`: it was listed by the directory
/// walk and gone (or being replaced) by the time git looked, i.e. an agent
/// writing while we snapshot.
pub fn vanished_path(stderr: &str) -> Option<String> {
    let line = stderr.lines().find(|l| l.contains("unable to stat '"))?;
    let rest = line.split_once("unable to stat '")?.1;
    let end = rest.rfind("': ")?;
    Some(rest[..end].to_string())
}

/// Files `git add --ignore-errors` reported as unreadable or changing mid-read.
pub fn unindexed_paths(stderr: &str) -> Vec<String> {
    stderr
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("error: unable to index file '")?;
            Some(rest.strip_suffix('\'')?.to_string())
        })
        .collect()
}

/// One `git add -A` pass over the private index. A file that vanishes aborts
/// git's whole pass (the index is left unwritten, so a retry starts clean);
/// the pass is retried with that file excluded and the file is reported in
/// `unstable` rather than failing the snapshot.
fn add_everything(
    repo: &ResolvedGitDirectory,
    temp: &TempIndex,
    warnings: &mut Vec<String>,
    unstable: &mut Vec<String>,
) -> Result<()> {
    for attempt in 1..=(ADD_ATTEMPTS + MAX_UNSTABLE_FILES as u32) {
        let mut args = os_args(["add", "-A", "--ignore-errors", "--", "."]);
        args.extend(
            unstable
                .iter()
                .map(|path| OsString::from(format!(":(exclude,literal){path}"))),
        );
        let output = run_indexed(repo, temp, args, None)?;
        if output.timed_out {
            return Err(GitError::TimedOut("git add"));
        }
        if output.exit_code == Some(0) {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if !stderr.contains("fatal:") && stderr.contains("unable to index file") {
            // `--ignore-errors`: files that could not be read are skipped, the
            // rest was added and the index written; git only exits non-zero.
            warn(warnings, "unreadable-files");
            for path in unindexed_paths(&stderr) {
                if unstable.len() < MAX_UNSTABLE_FILES && !unstable.contains(&path) {
                    unstable.push(path);
                }
            }
            return Ok(());
        }
        if let Some(path) = vanished_path(&stderr) {
            if unstable.len() < MAX_UNSTABLE_FILES && !unstable.contains(&path) {
                warn(warnings, "unstable-files-skipped");
                unstable.push(path);
                std::thread::sleep(std::time::Duration::from_millis(
                    u64::from(attempt.min(5)) * 5,
                ));
                continue;
            }
        }
        return ensure_success(&output, "git add failed");
    }
    Err(GitError::command(
        "git add failed",
        "the working tree kept changing during the snapshot",
    ))
}

fn write_tree(repo: &ResolvedGitDirectory, temp: &TempIndex) -> Result<String> {
    let output = run_indexed(repo, temp, os_args(["write-tree"]), None)?;
    ensure_success(&output, "git write-tree failed")?;
    Ok(stdout_text(&output))
}

/// Freezes the working tree (tracked files plus untracked, non-ignored ones)
/// into a tree object without touching the real index. With `verify`, the
/// snapshot is repeated until two consecutive passes agree or `MAX_PASSES` is
/// reached; `consistent` reports whether they did.
pub fn snapshot_tree(repo: &ResolvedGitDirectory, verify: bool) -> Result<Snapshot> {
    ensure_supported(repo)?;
    let temp = TempIndex::seeded(repo)?;
    let mut warnings = Vec::new();
    let mut unstable = Vec::new();
    add_everything(repo, &temp, &mut warnings, &mut unstable)?;
    let mut tree = write_tree(repo, &temp)?;
    let mut passes = 1;
    let mut consistent = false;
    while verify && passes < MAX_PASSES {
        add_everything(repo, &temp, &mut warnings, &mut unstable)?;
        let again = write_tree(repo, &temp)?;
        passes += 1;
        if again == tree {
            consistent = true;
            break;
        }
        tree = again;
    }
    if verify && !consistent {
        warn(&mut warnings, "concurrent-writes");
    }
    Ok(Snapshot {
        tree,
        consistent,
        passes,
        warnings,
        unstable_paths: unstable,
    })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInfo {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub task_id: String,
    pub turn: u32,
    pub commit: String,
    pub tree: String,
    /// HEAD when the checkpoint was taken; `None` for an unborn branch.
    pub parent: Option<String>,
    pub created_at_secs: i64,
    /// The worktree that made it (not sent to the frontend).
    #[serde(skip)]
    pub worktree_id: Option<String>,
}

/// What a checkpoint does and does not capture, stated in the result so the UI
/// never has to assume.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointLimits {
    /// The snapshot is not atomic: files written while it runs may be mixed.
    pub atomic: bool,
    pub captures_ignored_files: bool,
    /// Submodules are recorded as their commit pointer only.
    pub captures_submodule_contents: bool,
    /// Restoring puts files back; what was staged is not recorded.
    pub captures_index_state: bool,
}

const LIMITS: CheckpointLimits = CheckpointLimits {
    atomic: false,
    captures_ignored_files: false,
    captures_submodule_contents: false,
    captures_index_state: false,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointCreated {
    #[serde(flatten)]
    pub info: CheckpointInfo,
    /// Two consecutive snapshot passes produced the same tree.
    pub consistent: bool,
    pub passes: u32,
    pub warnings: Vec<String>,
    pub unstable_paths: Vec<String>,
    pub limits: CheckpointLimits,
    pub duration_ms: u64,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A commit object for `tree` (no ref, no HEAD movement, never signed, a fixed
/// identity so a missing `user.name` cannot fail it).
fn write_commit(
    repo: &ResolvedGitDirectory,
    admin: &Admin,
    tree: &str,
    parent: Option<&str>,
    message: &str,
) -> Result<String> {
    let mut args = os_args(["-c", "commit.gpgsign=false", "commit-tree", tree]);
    if let Some(parent) = parent {
        args.extend(os_args(["-p", parent]));
    }
    args.extend(os_args(["-m", message]));
    let output = run_git_with(
        &repo.workspace,
        Some(&repo.git_path),
        admin.plumb(args)?,
        crate::modules::git::types::DEFAULT_TIMEOUT_SECS,
        RunOptions {
            env: ["AUTHOR", "COMMITTER"]
                .iter()
                .flat_map(|who| {
                    [
                        (
                            OsString::from(format!("GIT_{who}_NAME")),
                            OsString::from("Terax"),
                        ),
                        (
                            OsString::from(format!("GIT_{who}_EMAIL")),
                            OsString::from("terax@localhost"),
                        ),
                    ]
                })
                .collect(),
            ..Default::default()
        },
    )?;
    ensure_success(&output, "git commit-tree failed")?;
    Ok(stdout_text(&output))
}

pub(crate) fn task_snapshot(
    repo: &ResolvedGitDirectory,
    id: &str,
) -> Result<super::task_state::TaskSnapshot> {
    let snapshot = snapshot_tree(repo, true)?;
    if !snapshot.consistent || !snapshot.unstable_paths.is_empty() || !snapshot.warnings.is_empty()
    {
        return Err(GitError::command(
            "task archive",
            "could not capture a complete, stable snapshot; stop writers and retry",
        ));
    }
    let parent = super::plumbing::resolve_commit(repo, "HEAD")?;
    let admin = Admin::new(repo)?;
    let commit = write_commit(
        repo,
        &admin,
        &snapshot.tree,
        Some(&parent),
        "task archive snapshot",
    )?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| GitError::command("task snapshot", e.to_string()))?;
    let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let reference = format!("refs/terax/tasks/{id}/archive/{suffix}");
    run_ok(
        repo,
        admin.plumb(os_args(["update-ref", &reference, &commit, ""]))?,
        "git update-ref failed",
    )?;
    Ok(super::task_state::TaskSnapshot {
        reference,
        commit,
        parent,
        captures_ignored_files: false,
    })
}

pub fn create(
    registry: &WorkspaceRegistry,
    worktree: &str,
    task_id: &str,
    turn: u32,
    workspace: &WorkspaceEnv,
) -> Result<CheckpointCreated> {
    if !refs::is_valid_task_id(task_id) {
        return Err(GitError::InvalidRef(task_id.to_string()));
    }
    let started = Instant::now();
    let repo = open_worktree(registry, worktree, workspace)?;
    ensure_supported(&repo)?;
    let admin = Admin::new(&repo)?;
    let lock = lock_for_repo(&repo);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let name = refs::checkpoint_ref(task_id, turn);
    let mine = admin.worktree_id()?;
    // A task id reused by another worktree must not overwrite its checkpoints.
    let taken = list_records(&repo, task_id)?
        .into_iter()
        .any(|r| r.name == name && r.worktree_id.as_deref() != Some(mine.as_str()));
    if taken {
        return Err(GitError::command(
            "git checkpoint create",
            "that checkpoint belongs to another worktree",
        ));
    }

    let mut snapshot = snapshot_tree(&repo, true)?;
    let parent = head_commit_opt(&repo)?;
    let message = format!("terax checkpoint {task_id}/{turn}{WORKTREE_MARK}{mine}");
    let commit = write_commit(&repo, &admin, &snapshot.tree, parent.as_deref(), &message)?;
    run_ok(
        &repo,
        admin.plumb(os_args(["update-ref", name.as_str(), commit.as_str()]))?,
        "git update-ref failed",
    )?;
    // The newest checkpoint is now what the worktree is measured against.
    clear_last_restore(&admin);

    Ok(CheckpointCreated {
        info: CheckpointInfo {
            ref_name: name,
            task_id: task_id.to_string(),
            turn,
            commit,
            tree: snapshot.tree,
            parent,
            created_at_secs: now_secs(),
            worktree_id: None,
        },
        consistent: snapshot.consistent,
        passes: snapshot.passes,
        warnings: std::mem::take(&mut snapshot.warnings),
        unstable_paths: std::mem::take(&mut snapshot.unstable_paths),
        limits: LIMITS,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

const LIST_FORMAT: &str = "--format=%(refname)%00%(objectname)%00%(tree)%00%(parent)%00%(committerdate:unix)%00%(contents:subject)";

/// Every checkpoint ref's commit message ends with the id of the worktree that
/// made it, because refs live in the repository shared by all its worktrees:
/// only the owner may list, restore or prune them.
const WORKTREE_MARK: &str = " wt:";

/// What the worktree is expected to look like right after a restore: the
/// restored checkpoint's tree. Kept in the worktree's git directory until the
/// next checkpoint is made (which replaces it as the baseline).
struct LastRestore {
    task_id: String,
    ref_name: String,
    tree: String,
}

fn read_last_restore(admin: &Admin) -> Option<LastRestore> {
    let text = std::fs::read_to_string(admin.dir.join(LAST_RESTORE_FILE)).ok()?;
    let mut lines = text.lines();
    let task_id = lines.next()?.to_string();
    let ref_name = lines.next()?.to_string();
    let tree = lines.next()?.to_string();
    (refs::is_valid_task_id(&task_id) && refs::parse_restore_source(&ref_name).is_some()).then_some(
        LastRestore {
            task_id,
            ref_name,
            tree,
        },
    )
}

fn write_last_restore(admin: &Admin, task_id: &str, ref_name: &str, tree: &str) {
    let _ = std::fs::write(
        admin.dir.join(LAST_RESTORE_FILE),
        format!("{task_id}\n{ref_name}\n{tree}\n"),
    );
}

fn clear_last_restore(admin: &Admin) {
    let _ = std::fs::remove_file(admin.dir.join(LAST_RESTORE_FILE));
}

/// The worktree id a checkpoint commit subject ends with.
pub fn subject_worktree_id(subject: &str) -> Option<&str> {
    let id = subject.rsplit_once(WORKTREE_MARK)?.1.trim();
    (!id.is_empty()).then_some(id)
}

/// One line of `for-each-ref` output in `LIST_FORMAT`.
struct RefRecord {
    name: String,
    commit: String,
    tree: String,
    parent: Option<String>,
    created_at_secs: i64,
    worktree_id: Option<String>,
}

fn parse_ref_records(output: &[u8]) -> Vec<RefRecord> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let name = fields.next()?.to_string();
            let commit = fields.next()?.to_string();
            let tree = fields.next()?.to_string();
            let parent = fields.next()?.split_whitespace().next().map(str::to_string);
            let created_at_secs = fields.next()?.parse().unwrap_or(0);
            let subject = fields.next().unwrap_or("");
            Some(RefRecord {
                name,
                commit,
                tree,
                parent,
                created_at_secs,
                worktree_id: subject_worktree_id(subject).map(str::to_string),
            })
        })
        .collect()
}

fn info_of(record: RefRecord) -> Option<CheckpointInfo> {
    let (task, turn) = refs::parse_checkpoint_ref(&record.name)?;
    Some(CheckpointInfo {
        task_id: task.to_string(),
        turn,
        ref_name: record.name,
        commit: record.commit,
        tree: record.tree,
        parent: record.parent,
        created_at_secs: record.created_at_secs,
        worktree_id: record.worktree_id,
    })
}

/// Parses `for-each-ref` output in `LIST_FORMAT`: the turn checkpoints, ordered
/// by turn (safety snapshots are not turns and are left out).
pub fn parse_checkpoint_list(output: &[u8]) -> Vec<CheckpointInfo> {
    let mut infos: Vec<CheckpointInfo> = parse_ref_records(output)
        .into_iter()
        .filter_map(info_of)
        .collect();
    infos.sort_by_key(|info| info.turn);
    infos
}

fn list_records(repo: &ResolvedGitDirectory, task_id: &str) -> Result<Vec<RefRecord>> {
    let prefix = refs::checkpoint_task_prefix(task_id);
    let output = run_ok(
        repo,
        os_args(["for-each-ref", LIST_FORMAT, prefix.as_str()]),
        "git for-each-ref failed",
    )?;
    Ok(parse_ref_records(&output.stdout))
}

/// This worktree's turn checkpoints of `task_id`, ordered by turn.
fn list_for(
    repo: &ResolvedGitDirectory,
    admin: &Admin,
    task_id: &str,
) -> Result<Vec<CheckpointInfo>> {
    // A worktree that never made a checkpoint has no id and owns nothing.
    let Some(mine) = admin.existing_worktree_id() else {
        return Ok(Vec::new());
    };
    let mut infos: Vec<CheckpointInfo> = list_records(repo, task_id)?
        .into_iter()
        .filter(|r| r.worktree_id.as_deref() == Some(mine.as_str()))
        .filter_map(info_of)
        .collect();
    infos.sort_by_key(|info| info.turn);
    Ok(infos)
}

pub fn list(
    registry: &WorkspaceRegistry,
    worktree: &str,
    task_id: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<CheckpointInfo>> {
    if !refs::is_valid_task_id(task_id) {
        return Err(GitError::InvalidRef(task_id.to_string()));
    }
    let repo = open_worktree(registry, worktree, workspace)?;
    list_for(&repo, &Admin::new(&repo)?, task_id)
}

pub fn prune(
    registry: &WorkspaceRegistry,
    worktree: &str,
    task_id: &str,
    workspace: &WorkspaceEnv,
) -> Result<u32> {
    if !refs::is_valid_task_id(task_id) {
        return Err(GitError::InvalidRef(task_id.to_string()));
    }
    let repo = open_worktree(registry, worktree, workspace)?;
    let admin = Admin::new(&repo)?;
    let lock = lock_for_repo(&repo);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    // Turn checkpoints and the safety snapshots of restores, this worktree's
    // only: another worktree may use the same task id.
    let Some(mine) = admin.existing_worktree_id() else {
        return Ok(0);
    };
    let names: Vec<String> = list_records(&repo, task_id)?
        .into_iter()
        .filter(|r| r.worktree_id.as_deref() == Some(mine.as_str()))
        .map(|r| r.name)
        .collect();
    if names.is_empty() {
        return Ok(0);
    }
    let mut script = String::new();
    for name in &names {
        script.push_str("delete ");
        script.push_str(name);
        script.push('\n');
    }
    let output = run_git_with(
        &repo.workspace,
        Some(&repo.git_path),
        admin.plumb(os_args(["update-ref", "--stdin"]))?,
        crate::modules::git::types::DEFAULT_TIMEOUT_SECS,
        RunOptions {
            stdin: Some(script.into_bytes()),
            ..Default::default()
        },
    )?;
    ensure_success(&output, "git update-ref failed")?;
    clear_last_restore(&admin);
    Ok(names.len() as u32)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedPath {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RestoreRefusal {
    /// Files changed since the latest checkpoint, or since the last restore
    /// when that is newer; restoring would lose them.
    ChangedSinceLatest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: bool,
    pub refusal: Option<RestoreRefusal>,
    pub latest_ref: Option<String>,
    /// What the working tree was compared against: the last restore's target
    /// when a restore happened after the latest checkpoint, else `latest_ref`.
    pub baseline_ref: Option<String>,
    /// Files that differ between the working tree and the baseline (capped at
    /// `MAX_DIRTY_REPORTED`).
    pub dirty: Vec<ChangedPath>,
    pub dirty_total: u32,
    pub written: u32,
    pub removed: u32,
    pub skipped: Vec<Skipped>,
    /// HEAD is not where it was when the checkpoint was taken (the agent
    /// committed, or switched branches). Commits are left alone.
    pub head_moved: bool,
    /// Index entries of the touched paths were reset to HEAD.
    pub index_synced: bool,
    pub consistent: bool,
    /// Files that kept changing under the pre-restore snapshot and were left
    /// out of it.
    pub unstable_paths: Vec<String>,
    /// The working tree as it was before this restore, kept under a ref so the
    /// restore can be undone by restoring this ref. Present whenever the
    /// restore could drop work that no checkpoint holds.
    pub safety: Option<SafetySnapshot>,
    pub atomic: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SafetySnapshot {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub commit: String,
    pub tree: String,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Records `tree` (the working tree about to be overwritten) under a fresh
/// `refs/terax/checkpoints/<task>/prerestore-<millis>` ref. An existing ref is
/// never replaced.
fn write_safety_snapshot(
    repo: &ResolvedGitDirectory,
    admin: &Admin,
    task_id: &str,
    tree: &str,
    parent: Option<&str>,
    worktree: &str,
) -> Result<SafetySnapshot> {
    let message = format!("terax prerestore {task_id}{WORKTREE_MARK}{worktree}");
    let commit = write_commit(repo, admin, tree, parent, &message)?;
    for millis in (now_millis()..).take(50) {
        let name = refs::prerestore_ref(task_id, millis);
        // An empty old value makes update-ref fail if the ref already exists.
        let output = run(
            repo,
            admin.plumb(os_args(["update-ref", name.as_str(), commit.as_str(), ""]))?,
        )?;
        if output.exit_code == Some(0) {
            return Ok(SafetySnapshot {
                ref_name: name,
                commit,
                tree: tree.to_string(),
            });
        }
    }
    Err(GitError::command(
        "git update-ref failed",
        "could not create the pre-restore safety ref",
    ))
}

fn tree_of(repo: &ResolvedGitDirectory, commit: &str) -> Result<String> {
    let output = run_ok(
        repo,
        os_args(["rev-parse", "--verify", &format!("{commit}^{{tree}}")]),
        "git rev-parse failed",
    )?;
    Ok(stdout_text(&output))
}

fn diff_trees(repo: &ResolvedGitDirectory, a: &str, b: &str) -> Result<Vec<DiffFileSummary>> {
    let output = run_ok(
        repo,
        os_args(["diff-tree", "-r", "-z", "--no-renames", a, b]),
        "git diff-tree failed",
    )?;
    Ok(parse_raw_numstat_z(&output.stdout))
}

/// A path that may be written or removed during a restore: relative, no `..`,
/// nothing inside `.git`, no NUL or control characters.
pub fn is_safe_restore_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.chars().any(|c| c.is_control())
        && !path.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git")
        })
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RestorePlan {
    pub writes: Vec<String>,
    pub deletes: Vec<String>,
    pub skipped: Vec<Skipped>,
}

/// `changes` is the diff from the current tree to the checkpoint tree: what is
/// `Added` exists only in the checkpoint (write it), `Deleted` only now (remove
/// it).
pub fn plan_restore(changes: &[DiffFileSummary]) -> RestorePlan {
    let mut plan = RestorePlan::default();
    for change in changes {
        let skip = |reason: &str| Skipped {
            path: change.path.clone(),
            reason: reason.to_string(),
        };
        if !is_safe_restore_path(&change.path) {
            plan.skipped.push(skip("unsafe-path"));
            continue;
        }
        if change.submodule {
            plan.skipped.push(skip("submodule"));
            continue;
        }
        match change.status {
            FileStatus::Added | FileStatus::Modified => plan.writes.push(change.path.clone()),
            FileStatus::Deleted => plan.deletes.push(change.path.clone()),
            FileStatus::TypeChanged => {
                plan.deletes.push(change.path.clone());
                plan.writes.push(change.path.clone());
            }
            _ => plan.skipped.push(skip("unsupported-change")),
        }
    }
    plan
}

/// Removes a file or symlink without following symlinks in its parent chain,
/// then prunes directories that became empty. `Ok(false)` when already gone.
fn remove_tracked_path(root: &Path, rel: &str) -> std::result::Result<bool, String> {
    let full = root.join(rel);
    let Some(parent) = full.parent() else {
        return Err("no parent".into());
    };
    let canonical_parent = match std::fs::canonicalize(parent) {
        Ok(path) => path,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    if !canonical_parent.starts_with(root) {
        return Err("outside-worktree".into());
    }
    match std::fs::symlink_metadata(&full) {
        Ok(meta) if meta.is_dir() => return Err("is-directory".into()),
        Ok(_) => std::fs::remove_file(&full).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    }
    let mut dir = full.parent().map(Path::to_path_buf);
    while let Some(current) = dir {
        if current == root || !current.starts_with(root) || std::fs::remove_dir(&current).is_err() {
            break;
        }
        dir = current.parent().map(Path::to_path_buf);
    }
    Ok(true)
}

fn sync_index_to_head(repo: &ResolvedGitDirectory, admin: &Admin, paths: &[String]) -> bool {
    let has_head = matches!(head_commit_opt(repo), Ok(Some(_)));
    for chunk in paths.chunks(INDEX_SYNC_CHUNK) {
        let mut args = if has_head {
            os_args(["--literal-pathspecs", "reset", "-q", "HEAD", "--"])
        } else {
            os_args([
                "--literal-pathspecs",
                "rm",
                "--cached",
                "-q",
                "-r",
                "--ignore-unmatch",
                "--",
            ])
        };
        args.extend(os_args(chunk));
        let Ok(args) = admin.plumb(args) else {
            return false;
        };
        match run(repo, args) {
            Ok(output) if output.exit_code == Some(0) => {}
            _ => return false,
        }
    }
    true
}

pub fn restore(
    registry: &WorkspaceRegistry,
    worktree: &str,
    reference: &str,
    force: bool,
    workspace: &WorkspaceEnv,
) -> Result<RestoreReport> {
    let Some(task_id) = refs::parse_restore_source(reference) else {
        return Err(GitError::InvalidRef(reference.to_string()));
    };
    let repo = open_worktree(registry, worktree, workspace)?;
    ensure_supported(&repo)?;
    let admin = Admin::new(&repo)?;
    let lock = lock_for_repo(&repo);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    // The refs are shared by every worktree of the repository; only a
    // checkpoint this worktree made may be restored into it.
    let mine = admin.existing_worktree_id().ok_or_else(|| {
        GitError::command(
            "git checkpoint restore",
            "no such checkpoint for this worktree",
        )
    })?;
    let target = list_records(&repo, task_id)?
        .into_iter()
        .find(|r| r.name == reference && r.worktree_id.as_deref() == Some(mine.as_str()))
        .ok_or_else(|| {
            GitError::command(
                "git checkpoint restore",
                "no such checkpoint for this worktree",
            )
        })?;
    let target_tree = tree_of(&repo, &target.commit)?;
    let latest = list_for(&repo, &admin, task_id)?.pop();
    let target_parent = target.parent.clone();

    // What the worktree should look like if nobody touched it since: the tree
    // the last restore wrote when that happened after the latest checkpoint
    // (making a checkpoint clears the marker), otherwise the latest checkpoint.
    // Without this, restoring forward (turn 1, then turn 2) would always count
    // the first restore itself as a change.
    let after_restore = read_last_restore(&admin)
        .filter(|r| r.task_id == task_id && verify_tree(&repo, &r.tree).is_ok());
    let (baseline_tree, baseline_ref) = match (&after_restore, &latest) {
        (Some(restore), _) => (Some(restore.tree.clone()), Some(restore.ref_name.clone())),
        (None, Some(latest)) => (Some(latest.tree.clone()), Some(latest.ref_name.clone())),
        (None, None) => (None, None),
    };

    let snapshot = snapshot_tree(&repo, true)?;
    let mut report = RestoreReport {
        restored: false,
        refusal: None,
        latest_ref: latest.as_ref().map(|l| l.ref_name.clone()),
        baseline_ref,
        dirty: Vec::new(),
        dirty_total: 0,
        written: 0,
        removed: 0,
        skipped: Vec::new(),
        head_moved: head_commit_opt(&repo)? != target_parent,
        index_synced: true,
        consistent: snapshot.consistent,
        unstable_paths: snapshot.unstable_paths.clone(),
        safety: None,
        atomic: false,
    };

    if !force {
        if let Some(baseline) = &baseline_tree {
            let dirty = diff_trees(&repo, baseline, &snapshot.tree)?;
            if !dirty.is_empty() {
                report.dirty_total = dirty.len() as u32;
                report.dirty = dirty
                    .into_iter()
                    .take(MAX_DIRTY_REPORTED)
                    .map(|d| ChangedPath {
                        path: d.path,
                        status: d.status,
                    })
                    .collect();
                report.refusal = Some(RestoreRefusal::ChangedSinceLatest);
                return Ok(report);
            }
        }
    }

    let changes = diff_trees(&repo, &snapshot.tree, &target_tree)?;
    let mut plan = plan_restore(&changes);
    report.skipped.append(&mut plan.skipped);

    // A path that is on disk but was not in the snapshot is an ignored file;
    // it is never overwritten.
    let in_snapshot: std::collections::HashSet<&str> = changes
        .iter()
        .filter(|c| c.status != FileStatus::Added)
        .map(|c| c.path.as_str())
        .collect();
    let mut writes: Vec<&String> = Vec::new();
    for path in &plan.writes {
        let exists = std::fs::symlink_metadata(repo.local_path.join(path)).is_ok();
        if exists && !in_snapshot.contains(path.as_str()) {
            report.skipped.push(Skipped {
                path: path.clone(),
                reason: "ignored-file-in-the-way".into(),
            });
        } else {
            writes.push(path);
        }
    }

    // Everything that can fail before the working tree is touched happens now:
    // the safety snapshot (so a forced or lossy restore can be undone) and the
    // private index the files are written from.
    let needs_safety = force || baseline_tree.as_ref().is_none_or(|t| *t != snapshot.tree);
    if needs_safety {
        let head = head_commit_opt(&repo)?;
        report.safety = Some(write_safety_snapshot(
            &repo,
            &admin,
            task_id,
            &snapshot.tree,
            head.as_deref(),
            &mine,
        )?);
    }
    let staged = if writes.is_empty() {
        None
    } else {
        let temp = TempIndex::empty(&repo)?;
        let read = run_indexed(
            &repo,
            &temp,
            os_args(["read-tree", target_tree.as_str()]),
            None,
        )?;
        ensure_success(&read, "git read-tree failed")?;
        Some(temp)
    };

    let mut touched: Vec<String> = Vec::new();
    for path in &plan.deletes {
        match remove_tracked_path(&repo.local_path, path) {
            Ok(true) => {
                report.removed += 1;
                touched.push(path.clone());
            }
            Ok(false) => {}
            Err(reason) => report.skipped.push(Skipped {
                path: path.clone(),
                reason,
            }),
        }
    }

    if let Some(temp) = staged {
        let mut list: Vec<u8> = Vec::new();
        for path in &writes {
            list.extend_from_slice(path.as_bytes());
            list.push(0);
        }
        let checkout = run_indexed(
            &repo,
            &temp,
            os_args(["checkout-index", "-f", "-z", "--stdin"]),
            Some(list),
        )?;
        ensure_success(&checkout, "git checkout-index failed")?;
        report.written = writes.len() as u32;
        touched.extend(writes.iter().map(|p| (*p).clone()));
    }

    touched.sort();
    touched.dedup();
    if !touched.is_empty() {
        report.index_synced = sync_index_to_head(&repo, &admin, &touched);
    }
    write_last_restore(&admin, task_id, reference, &target_tree);
    report.restored = true;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(path: &str, status: FileStatus) -> DiffFileSummary {
        DiffFileSummary {
            path: path.into(),
            old_path: None,
            status,
            added: 0,
            removed: 0,
            binary: false,
            submodule: false,
            symlink: false,
            approximate: false,
        }
    }

    #[test]
    fn parses_checkpoint_listing_in_turn_order() {
        let listing = "refs/terax/checkpoints/t1/10\u{0}c10\u{0}tree10\u{0}p10\u{0}1700000010\nrefs/terax/checkpoints/t1/2\u{0}c2\u{0}tree2\u{0}\u{0}1700000002\nrefs/terax/checkpoints/t1/x\u{0}bad\u{0}\u{0}\u{0}0\n";
        let infos = parse_checkpoint_list(listing.as_bytes());
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].turn, 2);
        assert_eq!(infos[0].parent, None);
        assert_eq!(infos[1].turn, 10);
        assert_eq!(infos[1].parent.as_deref(), Some("p10"));
        assert_eq!(infos[1].created_at_secs, 1_700_000_010);
        assert_eq!(infos[1].task_id, "t1");
    }

    #[test]
    fn restore_paths_must_stay_inside_the_worktree() {
        for ok in [
            "a.txt",
            "dir/sub/file.rs",
            "caf\u{e9}/x y.txt",
            ".github/workflows/ci.yml",
        ] {
            assert!(is_safe_restore_path(ok), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../x",
            "a//b",
            ".git/config",
            "sub/.git/hooks/pre-commit",
            "sub/.GIT/x",
            "a\\b",
            "a\nb",
            "./a",
        ] {
            assert!(!is_safe_restore_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn plan_writes_additions_and_edits_deletes_extras_and_skips_the_rest() {
        let mut sub = change("vendor/lib", FileStatus::Modified);
        sub.submodule = true;
        let plan = plan_restore(&[
            change("only-in-checkpoint.txt", FileStatus::Added),
            change("edited.txt", FileStatus::Modified),
            change("created-since.txt", FileStatus::Deleted),
            change("swapped", FileStatus::TypeChanged),
            change("../escape", FileStatus::Added),
            change("conflict.txt", FileStatus::Unmerged),
            sub,
        ]);
        assert_eq!(
            plan.writes,
            vec!["only-in-checkpoint.txt", "edited.txt", "swapped"]
        );
        assert_eq!(plan.deletes, vec!["created-since.txt", "swapped"]);
        let reasons: Vec<_> = plan.skipped.iter().map(|s| s.reason.as_str()).collect();
        assert_eq!(
            reasons,
            vec!["unsafe-path", "unsupported-change", "submodule"]
        );
    }

    #[test]
    fn the_vanished_file_is_read_out_of_gits_error() {
        assert_eq!(
            vanished_path("fatal: unable to stat 'dir/a b.txt': No such file or directory\n"),
            Some("dir/a b.txt".to_string())
        );
        assert_eq!(
            vanished_path("fatal: unable to stat 'it's': here.txt': No such file or directory"),
            Some("it's': here.txt".to_string())
        );
        assert_eq!(
            vanished_path("fatal: pathspec 'x' did not match any files"),
            None
        );
        assert_eq!(vanished_path(""), None);
    }

    #[test]
    fn unreadable_files_are_read_out_of_gits_error_lines() {
        let stderr = "error: short read while indexing src/f18.txt\nerror: src/f18.txt: failed to insert into database\nerror: unable to index file 'src/f18.txt'\nerror: open(\"x\"): Permission denied\nerror: unable to index file 'x'\n";
        assert_eq!(unindexed_paths(stderr), vec!["src/f18.txt", "x"]);
        assert!(unindexed_paths("").is_empty());
    }

    const SOME_ID: &str = "0123456789abcdef0123456789abcdef";
    const OTHER_ID: &str = "fedcba9876543210fedcba9876543210";

    fn no_hard_links(_: &Path, _: &Path) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "this file system has no hard links",
        ))
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn the_worktree_id_is_published_by_hard_link_when_the_file_system_has_them() {
        let dir = tempfile::tempdir().unwrap();
        publish_worktree_id(dir.path(), SOME_ID, &|from, to| std::fs::hard_link(from, to)).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(WORKTREE_ID_FILE)).unwrap(),
            SOME_ID
        );
        assert_eq!(names_in(dir.path()), vec![WORKTREE_ID_FILE.to_string()]);
    }

    #[test]
    fn the_worktree_id_is_created_exclusively_where_hard_links_fail() {
        let dir = tempfile::tempdir().unwrap();
        publish_worktree_id(dir.path(), SOME_ID, &no_hard_links).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(WORKTREE_ID_FILE)).unwrap(),
            SOME_ID
        );
        assert_eq!(
            names_in(dir.path()),
            vec![WORKTREE_ID_FILE.to_string()],
            "the staging file is cleaned up"
        );

        // Never replaces an id another caller published first, on either path.
        publish_worktree_id(dir.path(), OTHER_ID, &no_hard_links).unwrap();
        publish_worktree_id(dir.path(), OTHER_ID, &|from, to| std::fs::hard_link(from, to)).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(WORKTREE_ID_FILE)).unwrap(),
            SOME_ID
        );
        assert_eq!(names_in(dir.path()), vec![WORKTREE_ID_FILE.to_string()]);
    }

    #[test]
    fn publishing_the_worktree_id_reports_a_directory_it_cannot_write() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("not-there");
        assert!(publish_worktree_id(&missing, SOME_ID, &no_hard_links).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_index_copy_is_dated_like_the_original_and_made_owner_writable_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("index");
        let copy = dir.path().join("copy");
        std::fs::write(&real, "index bytes").unwrap();
        let long_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(7200);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&real)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o444)).unwrap();
        std::fs::copy(&real, &copy).unwrap();
        assert_eq!(
            std::fs::metadata(&copy).unwrap().permissions().mode() & 0o777,
            0o444,
            "the copy of a read-only file is read-only"
        );

        keep_modification_time(&real, &copy).unwrap();
        assert_eq!(std::fs::metadata(&copy).unwrap().modified().unwrap(), long_ago);
        assert_eq!(
            std::fs::metadata(&copy).unwrap().permissions().mode() & 0o777,
            0o644,
            "only the owner's write bit was added"
        );
    }

    #[test]
    fn dating_a_copy_after_a_missing_original_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let copy = dir.path().join("copy");
        std::fs::write(&copy, "x").unwrap();
        assert!(keep_modification_time(&dir.path().join("index"), &copy).is_err());
    }

    #[test]
    fn limits_serialize_as_explicit_flags() {
        let json = serde_json::to_value(&LIMITS).unwrap();
        assert_eq!(json["atomic"], false);
        assert_eq!(json["capturesIgnoredFiles"], false);
        assert_eq!(json["capturesSubmoduleContents"], false);
        assert_eq!(json["capturesIndexState"], false);
    }

    #[test]
    fn checkpoint_info_serializes_the_ref_under_its_real_name() {
        let info = CheckpointInfo {
            ref_name: "refs/terax/checkpoints/t/1".into(),
            task_id: "t".into(),
            turn: 1,
            commit: "c".into(),
            tree: "t".into(),
            parent: None,
            created_at_secs: 5,
            worktree_id: Some("abc".into()),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["ref"], "refs/terax/checkpoints/t/1");
        assert_eq!(json["createdAtSecs"], 5);
        assert!(
            json.get("worktreeId").is_none(),
            "internal field stays internal"
        );
    }
}
