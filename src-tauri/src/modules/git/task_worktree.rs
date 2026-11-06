use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::checkpoint::{self, Skipped};
use super::errors::{GitError, Result};
use super::plumbing::{
    branch_exists, check_branch_name, lock_for_repo, open_worktree, os_args, resolve_commit, run_ok,
};
use super::process::{ensure_success, run_git};
use super::project_config::{self, Ports};
use super::task_state::{lock_operation, Store};
pub use super::task_state::{TaskRecord, TaskSnapshot, TaskStatus};
use super::utils::ResolvedGitDirectory;
use super::worktree::{self, WorktreeAddRequest, WorktreeBranch, WorktreeRemoveReport};
use crate::modules::fs::to_canon;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TaskBase {
    Current,
    Branch { name: String },
    Origin { branch: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateRequest {
    pub name: String,
    pub base: Option<TaskBase>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreated {
    pub task: TaskRecord,
    pub env: BTreeMap<String, String>,
    pub setup_script: String,
    pub copied: Vec<String>,
    pub shared: Vec<String>,
    pub skipped: Vec<Skipped>,
    pub include_truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArchive {
    pub task: TaskRecord,
    pub snapshot: TaskSnapshot,
    pub removal: WorktreeRemoveReport,
    pub archive_script: String,
    pub shared_restore_failures: Vec<Skipped>,
}

fn open(
    registry: &WorkspaceRegistry,
    root: &str,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    let repo = open_worktree(registry, root, workspace)?;
    if workspace.is_wsl() {
        return Err(GitError::Unsupported(
            "task worktrees are not supported in WSL workspaces yet",
        ));
    }
    Ok(repo)
}

pub fn list(
    registry: &WorkspaceRegistry,
    root: &str,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<Vec<TaskRecord>> {
    let repo = open(registry, root, workspace)?;
    let root = to_canon(&repo.local_path);
    Ok(Store::open(home)?
        .tasks()
        .iter()
        .filter(|t| t.root == root)
        .cloned()
        .collect())
}

fn new_id() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| GitError::command("task id", e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn environment(task: &TaskRecord) -> BTreeMap<String, String> {
    let mut env = BTreeMap::from([
        ("TERAX_TASK".into(), task.name.clone()),
        ("TERAX_WORKSPACE_PATH".into(), task.path.clone()),
        ("TERAX_ROOT_PATH".into(), task.root.clone()),
        ("TERAX_PORT".into(), task.port.to_string()),
    ]);
    for n in 1..=9 {
        env.insert(format!("TERAX_PORT_{n}"), (task.port + n).to_string());
    }
    env
}

fn select_base(repo: &ResolvedGitDirectory, base: Option<&TaskBase>) -> Result<String> {
    match base {
        Some(TaskBase::Branch { name }) => {
            check_branch_name(repo, name)?;
            resolve_commit(repo, &format!("refs/heads/{name}"))
        }
        Some(TaskBase::Origin { branch }) => {
            check_branch_name(repo, branch)?;
            let refspec = format!("+refs/heads/{branch}:refs/remotes/origin/{branch}");
            let output = run_git(
                &repo.workspace,
                Some(&repo.git_path),
                os_args(["fetch", "--no-tags", "--", "origin", &refspec]),
                super::types::NETWORK_TIMEOUT_SECS,
            )?;
            ensure_success(&output, "task base fetch failed")?;
            resolve_commit(repo, &format!("refs/remotes/origin/{branch}"))
        }
        _ => resolve_commit(repo, "HEAD"),
    }
}

fn choose_branch(repo: &ResolvedGitDirectory, wanted: &str) -> Result<String> {
    for attempt in 1..=1000 {
        let name = if attempt == 1 {
            wanted.to_string()
        } else {
            format!("{wanted}-{attempt}")
        };
        check_branch_name(repo, &name)?;
        if !branch_exists(repo, &name)? {
            return Ok(name);
        }
    }
    Err(GitError::command("task branch", "no free branch name"))
}

fn claim(path: &Path, repo: &Path, home: &Path) -> Result<PathBuf> {
    let claimed = worktree::claim_directory(
        path.parent()
            .ok_or_else(|| GitError::InvalidPath(to_canon(path)))?,
        &path.file_name().unwrap_or_default().to_string_lossy(),
    )?;
    if let Err(error) = project_config::validate_location(&claimed, repo, home) {
        let _ = std::fs::remove_dir(&claimed);
        return Err(error);
    }
    Ok(claimed)
}

pub fn create(
    registry: &WorkspaceRegistry,
    root: &str,
    request: &TaskCreateRequest,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<TaskCreated> {
    let repo = open(registry, root, workspace)?;
    let _operation = lock_operation(&repo)?;
    let config = project_config::read(registry, root, workspace)?;
    let base = select_base(&repo, request.base.as_ref())?;
    let name = super::refs::slugify(&request.name, 48);
    let branch_slug = super::refs::slugify(&request.name.replace('.', "-"), 48);
    let branch = choose_branch(
        &repo,
        &format!("{}{branch_slug}", config.worktree.branch_prefix),
    )?;
    let id = new_id()?;
    let mut store = Store::open(home)?;
    let port = store.allocate(&config.ports, None)?;
    let target = project_config::location(&config.worktree, &repo.local_path, home, &name)?;
    let path = claim(&target, &repo.local_path, home)?;
    let task = TaskRecord {
        id,
        name,
        root: to_canon(&repo.local_path),
        path: to_canon(&path),
        branch,
        status: TaskStatus::Creating,
        port,
        port_count: config.ports.per_task,
        snapshot: None,
        archive_script: config.scripts.archive,
        include: config.worktree.include,
        shared: config.worktree.shared,
        shared_links: BTreeMap::new(),
    };
    if let Err(e) = store.put(task.clone()) {
        let _ = std::fs::remove_dir(&path);
        return Err(e);
    }
    drop(store);
    let add = WorktreeAddRequest {
        path: None,
        task_slug: None,
        branch: WorktreeBranch::NewBranch {
            name: task.branch.clone(),
        },
        base: Some(base),
        include: vec![],
    };
    materialize(
        registry,
        &repo,
        home,
        task,
        add,
        None,
        &config.scripts.setup,
    )
}

fn materialize(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    home: &Path,
    mut task: TaskRecord,
    request: WorktreeAddRequest,
    snapshot: Option<&TaskSnapshot>,
    setup: &str,
) -> Result<TaskCreated> {
    if let Err(err) = worktree::add_claimed(
        registry,
        &task.root,
        &request,
        PathBuf::from(&task.path),
        &repo.workspace,
    ) {
        let _ = std::fs::remove_dir(&task.path);
        // A process interrupted after git succeeded remains visible and keeps its ports.
        if !Path::new(&task.path).join(".git").exists() {
            if snapshot.is_some() {
                task.status = TaskStatus::Archived;
                Store::open(home)?.put(task)?;
            } else {
                Store::open(home)?.forget(&task.id)?;
            }
        }
        return Err(err);
    }
    let result = (|| {
        let target = std::fs::canonicalize(&task.path)?;
        if let Some(snapshot) = snapshot {
            let restored = open_worktree(registry, &task.path, &repo.workspace)?;
            let hooks = super::plumbing::git_dir(&restored)?.join("terax-empty-hooks");
            std::fs::create_dir_all(&hooks)?;
            let mut args = checkpoint::plumbing_config(&hooks);
            args.extend(os_args([
                "restore",
                "--source",
                &snapshot.commit,
                "--worktree",
                "--",
                ".",
            ]));
            run_ok(&restored, args, "task snapshot restore failed")?;
        }
        let copy = worktree::copy_ignored_included(repo, &target, &task.include)?;
        let (shared, mut skipped) = share(&repo.local_path, &target, &task.shared)?;
        skipped.extend(copy.skipped);
        task.shared_links = shared
            .iter()
            .map(|entry| {
                let relative = entry.trim_end_matches('/').to_string();
                std::fs::read_link(target.join(&relative))
                    .map(|target| (relative, to_canon(target)))
            })
            .collect::<std::io::Result<_>>()?;
        task.status = TaskStatus::Active;
        Store::open(home)?.put(task.clone())?;
        Ok(TaskCreated {
            env: environment(&task),
            task: task.clone(),
            setup_script: setup.into(),
            copied: copy.copied,
            shared,
            skipped,
            include_truncated: copy.truncated,
        })
    })();
    if result.is_err() {
        // Keep the recorded task and port reservation if cleanup cannot complete.
        if worktree::remove(registry, &task.root, &task.path, true, &repo.workspace)
            .is_ok_and(|r| r.removed)
        {
            if snapshot.is_some() {
                task.status = TaskStatus::Archived;
                Store::open(home)?.put(task)?;
            } else {
                Store::open(home)?.forget(&task.id)?;
            }
        }
    }
    result
}

pub(crate) fn link_privilege_missing(error: &std::io::Error, windows: bool) -> bool {
    windows && error.raw_os_error() == Some(1314)
}

fn symlink(source: &Path, destination: &Path, directory: bool) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        if directory {
            std::os::windows::fs::symlink_dir(source, destination)
        } else {
            std::os::windows::fs::symlink_file(source, destination)
        }
    }
    #[cfg(unix)]
    {
        let _ = directory;
        std::os::unix::fs::symlink(source, destination)
    }
}

fn share(root: &Path, target: &Path, entries: &[String]) -> Result<(Vec<String>, Vec<Skipped>)> {
    let mut shared = Vec::new();
    let mut skipped = Vec::new();
    for entry in entries {
        worktree::validate_include_pattern(entry).map_err(GitError::InvalidPath)?;
        let relative = entry.trim_end_matches('/');
        let src = root.join(relative);
        let canonical = match std::fs::canonicalize(&src) {
            Ok(path) => path,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        if !canonical.starts_with(root) || canonical.starts_with(root.join(".git")) {
            return Err(GitError::PathOutsideWorkspace(canonical));
        }
        let dst = target.join(relative);
        if std::fs::symlink_metadata(&dst).is_ok() {
            skipped.push(Skipped {
                path: entry.clone(),
                reason: "already-exists".into(),
            });
            continue;
        }
        worktree::create_dirs_confined(target, relative)
            .map_err(|e| GitError::InvalidPath(e.into()))?;
        let linked = symlink(&canonical, &dst, canonical.is_dir());
        if let Err(error) = linked {
            if link_privilege_missing(&error, cfg!(windows)) {
                skipped.push(Skipped {
                    path: entry.clone(),
                    reason: "symlink-privilege-required".into(),
                });
                continue;
            }
            return Err(error.into());
        }
        shared.push(entry.clone());
    }
    Ok((shared, skipped))
}

fn active_repo(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    task: &TaskRecord,
) -> Result<ResolvedGitDirectory> {
    let entries = worktree::list(registry, &task.root, &repo.workspace)?;
    let expected = std::fs::canonicalize(&task.path)?;
    if !entries
        .iter()
        .any(|e| !e.is_main && std::fs::canonicalize(&e.path).is_ok_and(|p| p == expected))
    {
        return Err(GitError::command(
            "task",
            "task path is not a linked worktree of this repository",
        ));
    }
    let active = open_worktree(registry, &task.path, &repo.workspace)?;
    if super::plumbing::common_dir(&active)? != super::plumbing::common_dir(repo)? {
        return Err(GitError::command(
            "task",
            "worktree belongs to a different repository",
        ));
    }
    Ok(active)
}

fn managed_links(repo: &ResolvedGitDirectory, task: &TaskRecord) -> Result<Vec<String>> {
    let mut links: Vec<String> = task
        .shared_links
        .iter()
        .filter_map(|(relative, target)| {
            let mut parent = repo.local_path.clone();
            let parts: Vec<_> = Path::new(relative).components().collect();
            for part in parts.iter().take(parts.len().saturating_sub(1)) {
                parent.push(part);
                if !std::fs::symlink_metadata(&parent)
                    .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
                {
                    return None;
                }
            }
            let path = repo.local_path.join(relative);
            (std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink())
                && std::fs::read_link(&path).is_ok_and(|p| to_canon(p) == *target))
            .then(|| relative.clone())
        })
        .collect();
    if !links.is_empty() {
        let mut args = os_args(["--literal-pathspecs", "ls-files", "-z", "--"]);
        args.extend(links.iter().map(Into::into));
        let output = run_ok(repo, args, "task shared links index check failed")?;
        if output.truncated {
            return Err(GitError::command(
                "task shared links",
                "index check was truncated",
            ));
        }
        links.retain(|p| !output.stdout.split(|b| *b == 0).any(|b| b == p.as_bytes()));
    }
    Ok(links)
}

pub(crate) fn remove_with_shared(
    task: &TaskRecord,
    links: &[String],
    remove: impl FnOnce() -> Result<WorktreeRemoveReport>,
) -> (Result<WorktreeRemoveReport>, Vec<Skipped>) {
    let mut detached = Vec::new();
    let result = (|| {
        for relative in links {
            let path = Path::new(&task.path).join(relative);
            if !std::fs::read_link(&path)
                .is_ok_and(|p| task.shared_links.get(relative) == Some(&to_canon(p)))
            {
                return Err(GitError::command(
                    "task archive",
                    "a shared link changed; retry",
                ));
            }
            #[cfg(windows)]
            let directory = {
                use std::os::windows::fs::FileTypeExt;
                std::fs::symlink_metadata(&path)?
                    .file_type()
                    .is_symlink_dir()
            };
            #[cfg(not(windows))]
            let directory = false;
            if directory {
                std::fs::remove_dir(&path)?;
            } else {
                std::fs::remove_file(&path)?;
            }
            detached.push((relative.clone(), directory));
        }
        remove()
    })();
    let mut failures = Vec::new();
    if !result.as_ref().is_ok_and(|r| r.removed) {
        // Restore only links removed by this attempt, never replace a user-created path.
        for (relative, directory) in detached {
            let path = Path::new(&task.path).join(&relative);
            let restored = match std::fs::symlink_metadata(&path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    symlink(Path::new(&task.shared_links[&relative]), &path, directory)
                }
                Err(error) => Err(error),
                Ok(_) => Err(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "path was replaced; left unchanged",
                )),
            };
            if let Err(error) = restored {
                failures.push(Skipped {
                    path: relative,
                    reason: error.to_string(),
                });
            }
        }
    }
    (result, failures)
}

fn inspect_archive(
    registry: &WorkspaceRegistry,
    active: &ResolvedGitDirectory,
    task: &TaskRecord,
    snapshot: &TaskSnapshot,
    excluded: &[String],
) -> Result<WorktreeRemoveReport> {
    let mut report = worktree::inspect_removal(
        registry,
        &task.root,
        &task.path,
        &active.workspace,
        excluded,
    )?;
    if !report.blockers.contains(&worktree::RemoveBlocker::Dirty) {
        let output = run_ok(
            active,
            os_args([
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--raw",
                "--numstat",
                "-z",
                &snapshot.parent,
                &snapshot.commit,
                "--",
            ]),
            "task snapshot diff failed",
        )?;
        if output.truncated {
            return Err(GitError::command(
                "task archive",
                "snapshot diff was truncated",
            ));
        }
        let changed = super::diff::parse_raw_numstat_z(&output.stdout);
        if !changed.is_empty() {
            report.blockers.push(worktree::RemoveBlocker::Dirty);
            report.dirty_total = changed.len() as u32;
            report.dirty_files = changed
                .into_iter()
                .take(50)
                .map(|file| checkpoint::ChangedPath {
                    path: file.path,
                    status: file.status,
                })
                .collect();
        }
    }
    Ok(report)
}

pub fn prepare_archive(
    registry: &WorkspaceRegistry,
    root: &str,
    id: &str,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<TaskArchive> {
    let repo = open(registry, root, workspace)?;
    let _operation = lock_operation(&repo)?;
    let mut task = Store::open(home)?.task(&to_canon(&repo.local_path), id)?;
    if task.status == TaskStatus::Archived {
        return Err(GitError::command("task archive", "already archived"));
    }
    let active = active_repo(registry, &repo, &task)?;
    let lock = lock_for_repo(&active);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let links = managed_links(&active, &task)?;
    let snapshot = checkpoint::task_snapshot(&active, id, &links)?;
    task.snapshot = Some(snapshot.clone());
    Store::open(home)?.put(task.clone())?;
    let removal = inspect_archive(registry, &active, &task, &snapshot, &links)?;
    Ok(TaskArchive {
        archive_script: task.archive_script.clone(),
        task,
        snapshot,
        removal,
        shared_restore_failures: vec![],
    })
}

pub fn archive(
    registry: &WorkspaceRegistry,
    root: &str,
    id: &str,
    force: bool,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<TaskArchive> {
    let repo = open(registry, root, workspace)?;
    let _operation = lock_operation(&repo)?;
    let mut task = Store::open(home)?.task(&to_canon(&repo.local_path), id)?;
    if task.status == TaskStatus::Archived {
        return Err(GitError::command("task archive", "already archived"));
    }
    let active = active_repo(registry, &repo, &task)?;
    let lock = lock_for_repo(&active);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let links = managed_links(&active, &task)?;
    let snapshot = checkpoint::task_snapshot(&active, id, &links)?;
    task.snapshot = Some(snapshot.clone());
    if !force {
        let removal = inspect_archive(registry, &active, &task, &snapshot, &links)?;
        if !removal.blockers.is_empty() {
            task.status = TaskStatus::Active;
            Store::open(home)?.put(task.clone())?;
            return Ok(TaskArchive {
                archive_script: task.archive_script.clone(),
                task,
                snapshot,
                removal,
                shared_restore_failures: vec![],
            });
        }
    }
    task.status = TaskStatus::Archiving;
    Store::open(home)?.put(task.clone())?;
    let attempt = remove_with_shared(&task, &links, || {
        worktree::remove(registry, &task.root, &task.path, force, workspace)
    });
    complete_archive(registry, &repo, task, snapshot, attempt, home)
}

pub(crate) fn complete_archive(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    mut task: TaskRecord,
    snapshot: TaskSnapshot,
    attempt: (Result<WorktreeRemoveReport>, Vec<Skipped>),
    home: &Path,
) -> Result<TaskArchive> {
    let (removal, failures) = attempt;
    match removal {
        Ok(removal) => {
            task.status = if removal.removed {
                TaskStatus::Archived
            } else {
                TaskStatus::Active
            };
            recover_removed(registry, repo, &mut task, home)?;
            Store::open(home)?.put(task.clone())?;
            Ok(TaskArchive {
                archive_script: task.archive_script.clone(),
                task,
                snapshot,
                removal,
                shared_restore_failures: failures,
            })
        }
        Err(error) => {
            // A failed git remove can be partial. Keep Archiving unless the directory is gone.
            let recovery = recover_removed(registry, repo, &mut task, home);
            let mut detail = format!("removal failed: {error}");
            for failure in failures {
                detail.push_str(&format!("; restoring {}: {}", failure.path, failure.reason));
            }
            if let Err(error) = recovery {
                detail.push_str(&format!("; recovery failed: {error}"));
            }
            Err(GitError::command("task archive", detail))
        }
    }
}

fn recover_removed(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    task: &mut TaskRecord,
    home: &Path,
) -> Result<()> {
    if task.status == TaskStatus::Archived || task.snapshot.is_none() {
        return Ok(());
    }
    match std::fs::symlink_metadata(&task.path) {
        Ok(_) => return Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let key = |path: &str| {
        let path = super::plumbing::forward_slashes(&to_canon(Path::new(path)));
        if cfg!(windows) {
            path.to_lowercase()
        } else {
            path
        }
    };
    if worktree::list(registry, &task.root, &repo.workspace)?
        .iter()
        .any(|e| !e.is_main && key(&e.path) == key(&task.path))
    {
        let removal = worktree::remove(registry, &task.root, &task.path, true, &repo.workspace)?;
        if !removal.removed {
            return Err(GitError::command(
                "task recovery",
                "missing worktree registration could not be removed",
            ));
        }
    }
    task.status = TaskStatus::Archived;
    Store::open(home)?.put(task.clone())
}

pub fn restore(
    registry: &WorkspaceRegistry,
    root: &str,
    id: &str,
    reference: Option<&str>,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<TaskCreated> {
    let repo = open(registry, root, workspace)?;
    let _operation = lock_operation(&repo)?;
    let mut task = Store::open(home)?.task(&to_canon(&repo.local_path), id)?;
    recover_removed(registry, &repo, &mut task, home)?;
    if task.status != TaskStatus::Archived {
        return Err(GitError::command("task restore", "task is not archived"));
    }
    let mut snapshot = task
        .snapshot
        .clone()
        .ok_or_else(|| GitError::command("task restore", "no archive snapshot"))?;
    if resolve_commit(&repo, &snapshot.reference)? != snapshot.commit {
        return Err(GitError::command(
            "task restore",
            "snapshot ref has changed",
        ));
    }
    if let Some(reference) = reference {
        let prefix = format!("refs/terax/tasks/{id}/archive/");
        let suffix = reference
            .strip_prefix(&prefix)
            .ok_or_else(|| GitError::InvalidRef(reference.into()))?;
        if suffix.len() != 32 || !suffix.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(GitError::InvalidRef(reference.into()));
        }
        let commit = resolve_commit(&repo, reference)?;
        let parent = resolve_commit(&repo, &format!("{commit}^"))?;
        snapshot = TaskSnapshot {
            reference: reference.into(),
            commit,
            parent,
            captures_ignored_files: false,
        };
        task.snapshot = Some(snapshot.clone());
    }
    let config = project_config::read(registry, root, workspace)?;
    let reusable =
        super::plumbing::resolve_commit_opt(&repo, &format!("refs/heads/{}", task.branch))?
            .as_deref()
            == Some(snapshot.parent.as_str())
            && !worktree::list(registry, root, workspace)?
                .iter()
                .any(|e| e.branch.as_deref() == Some(task.branch.as_str()));
    let branch = if reusable {
        WorktreeBranch::ExistingBranch {
            name: task.branch.clone(),
        }
    } else {
        task.branch = choose_branch(&repo, &task.branch)?;
        WorktreeBranch::NewBranch {
            name: task.branch.clone(),
        }
    };
    let target = project_config::location(&config.worktree, &repo.local_path, home, &task.name)?;
    let mut store = Store::open(home)?;
    task.port = store.allocate(
        &Ports {
            base: config.ports.base,
            per_task: task.port_count,
        },
        Some(task.port),
    )?;
    task.path = to_canon(claim(&target, &repo.local_path, home)?);
    task.status = TaskStatus::Creating;
    if let Err(error) = store.put(task.clone()) {
        let _ = std::fs::remove_dir(&task.path);
        return Err(error);
    }
    drop(store);
    let add = WorktreeAddRequest {
        path: None,
        task_slug: None,
        branch,
        base: Some(snapshot.parent.clone()),
        include: vec![],
    };
    materialize(
        registry,
        &repo,
        home,
        task,
        add,
        Some(&snapshot),
        &config.scripts.setup,
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub bytes: u64,
    pub entries: u64,
    pub truncated: bool,
}

pub fn disk_usage(
    registry: &WorkspaceRegistry,
    root: &str,
    id: &str,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<DiskUsage> {
    let repo = open(registry, root, workspace)?;
    let store = Store::open(home)?;
    let task = store.task(&to_canon(&repo.local_path), id)?;
    drop(store);
    if task.status == TaskStatus::Archived {
        return Ok(DiskUsage {
            bytes: 0,
            entries: 0,
            truncated: false,
        });
    }
    let active = active_repo(registry, &repo, &task)?;
    Ok(measure(
        &active.local_path,
        100_000,
        Duration::from_millis(250),
    ))
}

pub(crate) fn measure(root: &Path, max_entries: u64, budget: Duration) -> DiskUsage {
    let start = Instant::now();
    let mut usage = DiskUsage {
        bytes: 0,
        entries: 0,
        truncated: false,
    };
    let walker = ignore::WalkBuilder::new(root)
        .standard_filters(false)
        .follow_links(false)
        .max_depth(Some(128))
        .build();
    for entry in walker {
        if usage.entries >= max_entries || start.elapsed() >= budget {
            usage.truncated = true;
            break;
        }
        usage.entries += 1;
        if entry
            .as_ref()
            .is_ok_and(|e| e.depth() == 128 && e.file_type().is_some_and(|t| t.is_dir()))
        {
            usage.truncated = true;
        }
        match entry.and_then(|entry| entry.metadata()) {
            Ok(meta) if meta.is_file() => usage.bytes = usage.bytes.saturating_add(meta.len()),
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => {}
            Err(_) => usage.truncated = true,
        }
    }
    usage
}
