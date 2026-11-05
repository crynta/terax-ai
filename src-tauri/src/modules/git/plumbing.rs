//! Small imperative helpers over `run_git` shared by the review, worktree,
//! checkpoint and branch operations: revision resolution, ref-name checks and
//! locating the git directories of an authorized worktree.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::process::{ensure_git_available, ensure_success, run_git};
use crate::modules::git::refs;
use crate::modules::git::types::{GitOutput, DEFAULT_TIMEOUT_SECS};
use crate::modules::git::utils::{authorized_repo_root, canonical_dir, ResolvedGitDirectory};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

/// One mutex per worktree (or git directory), so operations that read and then
/// write repository state (hunk apply, checkpoint create / restore) never
/// interleave with each other inside this process.
pub fn lock_for(path: &Path) -> Arc<Mutex<()>> {
    let mut map = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.entry(path.to_path_buf()).or_default().clone()
}

pub fn os_args<I, S>(items: I) -> Vec<OsString>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    items
        .into_iter()
        .map(|item| item.as_ref().to_os_string())
        .collect()
}

/// `git <args>` in `repo`, with the stock timeout.
pub fn run(repo: &ResolvedGitDirectory, args: Vec<OsString>) -> Result<GitOutput> {
    run_git(
        &repo.workspace,
        Some(&repo.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )
}

/// Like `run`, failing with `context` unless git exited with 0.
pub fn run_ok(
    repo: &ResolvedGitDirectory,
    args: Vec<OsString>,
    context: &'static str,
) -> Result<GitOutput> {
    let output = run(repo, args)?;
    ensure_success(&output, context)?;
    Ok(output)
}

pub fn stdout_text(output: &GitOutput) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Commit id for `rev`, or `None` when it does not name a commit. `rev` is
/// screened first so it can never be read as an option.
pub fn resolve_commit_opt(repo: &ResolvedGitDirectory, rev: &str) -> Result<Option<String>> {
    if !refs::is_safe_rev(rev) {
        return Err(GitError::InvalidRef(rev.to_string()));
    }
    let output = run(
        repo,
        os_args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{rev}^{{commit}}"),
        ]),
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git rev-parse"));
    }
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let id = stdout_text(&output);
    Ok((!id.is_empty()).then_some(id))
}

pub fn resolve_commit(repo: &ResolvedGitDirectory, rev: &str) -> Result<String> {
    resolve_commit_opt(repo, rev)?.ok_or_else(|| GitError::InvalidRef(rev.to_string()))
}

pub fn head_commit_opt(repo: &ResolvedGitDirectory) -> Result<Option<String>> {
    resolve_commit_opt(repo, "HEAD")
}

/// The empty tree of this repository's object format, the left side of a diff
/// when HEAD is unborn.
pub fn empty_tree(repo: &ResolvedGitDirectory) -> Result<String> {
    let output = run_ok(
        repo,
        os_args(["hash-object", "-t", "tree", "--stdin"]),
        "git hash-object failed",
    )?;
    Ok(stdout_text(&output))
}

/// `id` must be the hex id of an existing tree object (a snapshot an earlier
/// call returned), never a name or an expression.
pub fn verify_tree(repo: &ResolvedGitDirectory, id: &str) -> Result<()> {
    let hex = (40..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit());
    if !hex {
        return Err(GitError::InvalidRef(id.to_string()));
    }
    let output = run(repo, os_args(["cat-file", "-t", id]))?;
    if output.exit_code == Some(0) && stdout_text(&output) == "tree" {
        Ok(())
    } else {
        Err(GitError::InvalidRef(id.to_string()))
    }
}

/// `name` as a branch: screened, then judged by `git check-ref-format`.
pub fn check_branch_name(repo: &ResolvedGitDirectory, name: &str) -> Result<()> {
    if !refs::is_plausible_ref_name(name) {
        return Err(GitError::InvalidRef(name.to_string()));
    }
    let output = run(
        repo,
        os_args(["check-ref-format", &format!("refs/heads/{name}")]),
    )?;
    if output.exit_code == Some(0) {
        Ok(())
    } else {
        Err(GitError::InvalidRef(name.to_string()))
    }
}

pub fn branch_exists(repo: &ResolvedGitDirectory, name: &str) -> Result<bool> {
    let output = run(
        repo,
        os_args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ]),
    )?;
    Ok(output.exit_code == Some(0))
}

/// The authorized worktree that contains `path`, always resolved to its
/// top-level so whole-tree commands (`add -A`) cannot silently cover only a
/// subdirectory. The top-level must itself be authorized.
pub fn open_worktree(
    registry: &WorkspaceRegistry,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    let start = authorized_repo_root(registry, path, workspace)?;
    ensure_git_available(&start.workspace)?;
    let output = run(&start, os_args(["rev-parse", "--show-toplevel"]))?;
    ensure_success(&output, "not a git repository")?;
    let toplevel = stdout_text(&output);
    if toplevel.is_empty() {
        return Err(GitError::command("not a git repository", path));
    }
    let resolved = canonical_dir(registry, &toplevel, &start.workspace)?;
    if !registry.is_authorized(&resolved.local_path) {
        return Err(GitError::PathOutsideWorkspace(resolved.local_path));
    }
    Ok(resolved)
}

fn absolute_from(repo: &ResolvedGitDirectory, printed: &str) -> PathBuf {
    let path = PathBuf::from(printed);
    if path.is_absolute() {
        path
    } else {
        repo.local_path.join(path)
    }
}

/// This worktree's private git directory (`.git`, or `.git/worktrees/<name>`).
pub fn git_dir(repo: &ResolvedGitDirectory) -> Result<PathBuf> {
    let output = run_ok(
        repo,
        os_args(["rev-parse", "--absolute-git-dir"]),
        "git rev-parse failed",
    )?;
    Ok(absolute_from(repo, &stdout_text(&output)))
}

/// The git directory shared by all worktrees of the repository (refs, config).
pub fn common_dir(repo: &ResolvedGitDirectory) -> Result<PathBuf> {
    let output = run_ok(
        repo,
        os_args(["rev-parse", "--git-common-dir"]),
        "git rev-parse failed",
    )?;
    let printed = stdout_text(&output);
    let path = absolute_from(repo, &printed);
    Ok(std::fs::canonicalize(&path).unwrap_or(path))
}

/// Path relative to the worktree root with forward slashes; the form pathspecs
/// and patches use.
///
/// Only the directory part is resolved (and must stay inside the worktree); the
/// last component is kept as written, so a tracked symlink names itself and is
/// never swapped for the file it points to.
pub fn relative_spec(repo: &ResolvedGitDirectory, rel: &str) -> Result<String> {
    use crate::modules::git::utils::{is_safe_pathspec, resolve_within_repo};
    let normalized = rel.replace('\\', "/");
    if !is_safe_pathspec(&normalized) {
        return Err(GitError::InvalidPath(rel.to_string()));
    }
    let Some((dir, name)) = normalized.rsplit_once('/') else {
        return Ok(normalized);
    };
    if name.is_empty() {
        return Err(GitError::InvalidPath(rel.to_string()));
    }
    let resolved = resolve_within_repo(&repo.local_path, dir)?;
    let dir_spec = resolved
        .strip_prefix(&repo.local_path)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|_| GitError::InvalidPath(rel.to_string()))?;
    Ok(if dir_spec.is_empty() {
        name.to_string()
    } else {
        format!("{dir_spec}/{name}")
    })
}
