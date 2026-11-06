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
use super::task_state::Store;
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

fn claim(path: &Path) -> Result<PathBuf> {
    worktree::claim_directory(
        path.parent()
            .ok_or_else(|| GitError::InvalidPath(to_canon(path)))?,
        &path.file_name().unwrap_or_default().to_string_lossy(),
    )
    .map_err(Into::into)
}

pub fn create(
    registry: &WorkspaceRegistry,
    root: &str,
    request: &TaskCreateRequest,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<TaskCreated> {
    let repo = open(registry, root, workspace)?;
    let config = project_config::read(registry, root, workspace)?;
    let base = select_base(&repo, request.base.as_ref())?;
    let mut store = Store::open(home)?;
    let name = super::refs::slugify(&request.name, 48);
    let branch = choose_branch(&repo, &format!("{}{name}", config.worktree.branch_prefix))?;
    let port = store.allocate(&config.ports, None)?;
    let target = project_config::location(&config.worktree, &repo.local_path, home, &name)?;
    let id = new_id()?;
    let path = claim(&target)?;
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
    };
    if let Err(e) = store.put(task.clone()) {
        let _ = std::fs::remove_dir(&path);
        return Err(e);
    }
    materialize(
        registry,
        &repo,
        &mut store,
        task,
        &base,
        None,
        &config.scripts.setup,
    )
}

fn materialize(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    store: &mut Store,
    mut task: TaskRecord,
    base: &str,
    snapshot: Option<&TaskSnapshot>,
    setup: &str,
) -> Result<TaskCreated> {
    let request = WorktreeAddRequest {
        path: None,
        task_slug: None,
        branch: WorktreeBranch::NewBranch {
            name: task.branch.clone(),
        },
        base: Some(base.into()),
        include: vec![],
    };
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
                store.put(task)?;
            } else {
                store.forget(&task.id)?;
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
        task.status = TaskStatus::Active;
        store.put(task.clone())?;
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
                store.put(task)?;
            } else {
                store.forget(&task.id)?;
            }
        }
    }
    result
}

fn share(root: &Path, target: &Path, entries: &[String]) -> Result<(Vec<String>, Vec<Skipped>)> {
    let mut shared = Vec::new();
    let mut skipped = Vec::new();
    for entry in entries {
        worktree::validate_include_pattern(entry).map_err(GitError::InvalidPath)?;
        let src = root.join(entry);
        let canonical = match std::fs::canonicalize(&src) {
            Ok(path) => path,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        if !canonical.starts_with(root) || canonical.starts_with(root.join(".git")) {
            return Err(GitError::PathOutsideWorkspace(canonical));
        }
        let dst = target.join(entry);
        if std::fs::symlink_metadata(&dst).is_ok() {
            skipped.push(Skipped {
                path: entry.clone(),
                reason: "already-exists".into(),
            });
            continue;
        }
        worktree::create_dirs_confined(target, entry)
            .map_err(|e| GitError::InvalidPath(e.into()))?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(&canonical, &dst)?;
        #[cfg(windows)]
        if canonical.is_dir() {
            std::os::windows::fs::symlink_dir(&canonical, &dst)?;
        } else {
            std::os::windows::fs::symlink_file(&canonical, &dst)?;
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

pub fn prepare_archive(
    registry: &WorkspaceRegistry,
    root: &str,
    id: &str,
    workspace: &WorkspaceEnv,
    home: &Path,
) -> Result<TaskArchive> {
    let repo = open(registry, root, workspace)?;
    let mut store = Store::open(home)?;
    let mut task = store.task(&to_canon(&repo.local_path), id)?;
    if task.status == TaskStatus::Archived {
        return Err(GitError::command("task archive", "already archived"));
    }
    let active = active_repo(registry, &repo, &task)?;
    let lock = lock_for_repo(&active);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let snapshot = checkpoint::task_snapshot(&active, id)?;
    task.snapshot = Some(snapshot.clone());
    store.put(task.clone())?;
    let removal = worktree::inspect_removal(registry, &task.root, &task.path, workspace)?;
    Ok(TaskArchive {
        archive_script: task.archive_script.clone(),
        task,
        snapshot,
        removal,
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
    let mut store = Store::open(home)?;
    let mut task = store.task(&to_canon(&repo.local_path), id)?;
    if task.status == TaskStatus::Archived {
        return Err(GitError::command("task archive", "already archived"));
    }
    let active = active_repo(registry, &repo, &task)?;
    let lock = lock_for_repo(&active);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let snapshot = checkpoint::task_snapshot(&active, id)?;
    task.snapshot = Some(snapshot.clone());
    store.put(task.clone())?;
    let removal = worktree::remove(registry, &task.root, &task.path, force, workspace)?;
    if removal.removed {
        task.status = TaskStatus::Archived;
        store.put(task.clone())?;
    }
    Ok(TaskArchive {
        archive_script: task.archive_script.clone(),
        task,
        snapshot,
        removal,
    })
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
    let mut store = Store::open(home)?;
    let mut task = store.task(&to_canon(&repo.local_path), id)?;
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
    task.port = store.allocate(
        &Ports {
            base: config.ports.base,
            per_task: task.port_count,
        },
        Some(task.port),
    )?;
    task.branch = choose_branch(&repo, &task.branch)?;
    let target = project_config::location(&config.worktree, &repo.local_path, home, &task.name)?;
    task.path = to_canon(claim(&target)?);
    task.status = TaskStatus::Creating;
    if let Err(error) = store.put(task.clone()) {
        let _ = std::fs::remove_dir(&task.path);
        return Err(error);
    }
    materialize(
        registry,
        &repo,
        &mut store,
        task,
        &snapshot.parent,
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
