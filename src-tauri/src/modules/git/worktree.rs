//! Linked worktrees for tasks: listing, creating (with a collision-safe
//! default location under the app's data directory and optional copying of
//! ignored files such as `.env`), removing with an explicit dirty / unmerged
//! report, and pruning. Every worktree root that git hands back is authorized
//! only as a root derived from its parent repository.

use std::collections::HashSet;
use std::io;
use std::path::{Component, Path, PathBuf};

use globset::{GlobBuilder, GlobSetBuilder};
use serde::{Deserialize, Serialize};

use crate::modules::git::checkpoint::{ChangedPath, Skipped};
use crate::modules::git::diff::FileStatus;
use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::plumbing::{
    branch_exists, check_branch_name, common_dir, head_commit_opt, open_worktree, os_args,
    resolve_commit, run, run_ok, stdout_text,
};
use crate::modules::git::process::{ensure_success, run_git, run_git_capped};
use crate::modules::git::refs;
use crate::modules::git::types::{DEFAULT_TIMEOUT_SECS, NETWORK_TIMEOUT_SECS};
use crate::modules::git::utils::{canonical_dir, ResolvedGitDirectory};
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

const MAX_INCLUDE_PATTERNS: usize = 64;
const MAX_INCLUDE_FILES: usize = 200;
const MAX_INCLUDE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_INCLUDE_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_INCLUDE_WALK_ENTRIES: usize = 100_000;
const MAX_DIRTY_REPORTED: usize = 50;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    pub prunable: bool,
    pub prunable_reason: Option<String>,
    pub is_main: bool,
    pub exists: bool,
}

/// Parses `git worktree list --porcelain`: blank-line separated blocks of
/// `key value` lines.
pub fn parse_worktree_list(text: &str) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut current: Option<WorktreeEntry> = None;
    let flush = |entries: &mut Vec<WorktreeEntry>, current: &mut Option<WorktreeEntry>| {
        if let Some(entry) = current.take() {
            entries.push(entry);
        }
    };
    for line in text.lines() {
        if line.is_empty() {
            flush(&mut entries, &mut current);
            continue;
        }
        let (key, value) = match line.split_once(' ') {
            Some((key, value)) => (key, Some(value)),
            None => (line, None),
        };
        if key == "worktree" {
            flush(&mut entries, &mut current);
            current = Some(WorktreeEntry {
                path: value.unwrap_or_default().to_string(),
                branch: None,
                head: None,
                detached: false,
                bare: false,
                locked: false,
                lock_reason: None,
                prunable: false,
                prunable_reason: None,
                is_main: entries.is_empty(),
                exists: true,
            });
            continue;
        }
        let Some(entry) = current.as_mut() else {
            continue;
        };
        match key {
            "HEAD" => entry.head = value.map(str::to_string),
            "branch" => {
                entry.branch =
                    value.map(|v| v.strip_prefix("refs/heads/").unwrap_or(v).to_string());
            }
            "detached" => entry.detached = true,
            "bare" => entry.bare = true,
            "locked" => {
                entry.locked = true;
                entry.lock_reason = value.filter(|v| !v.is_empty()).map(str::to_string);
            }
            "prunable" => {
                entry.prunable = true;
                entry.prunable_reason = value.filter(|v| !v.is_empty()).map(str::to_string);
            }
            _ => {}
        }
    }
    flush(&mut entries, &mut current);
    entries
}

fn list_entries(repo: &ResolvedGitDirectory) -> Result<Vec<WorktreeEntry>> {
    let output = run_ok(
        repo,
        os_args(["worktree", "list", "--porcelain"]),
        "git worktree list failed",
    )?;
    let mut entries = parse_worktree_list(&String::from_utf8_lossy(&output.stdout));
    for entry in &mut entries {
        entry.exists = entry_exists(&repo.workspace, &entry.path);
    }
    Ok(entries)
}

/// Whether a path git printed exists. Git prints paths in its own environment
/// (Linux paths inside WSL), so they are mapped to the host before being
/// looked up.
fn entry_exists(workspace: &WorkspaceEnv, path: &str) -> bool {
    resolve_path(path, workspace).is_dir()
}

const WSL_WORKTREES_UNSUPPORTED: &str =
    "creating and removing worktrees is not supported in WSL workspaces yet";

/// A linked worktree is trusted only if its `.git` file points back into this
/// repository's `worktrees/` administrative area.
fn backlinks_to(worktree: &Path, common: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(worktree.join(".git")) else {
        return false;
    };
    let Some(target) = text.trim().strip_prefix("gitdir:") else {
        return false;
    };
    let target = PathBuf::from(target.trim());
    let target = std::fs::canonicalize(&target).unwrap_or(target);
    target.starts_with(common.join("worktrees"))
}

fn authorize_linked(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    common: &Path,
    entry: &WorktreeEntry,
) {
    if entry.is_main || entry.bare || !entry.exists {
        return;
    }
    let path = Path::new(&entry.path);
    if backlinks_to(path, common) {
        let _ = registry.authorize_derived(path, &repo.local_path);
    }
}

pub fn list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<WorktreeEntry>> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    let entries = list_entries(&repo)?;
    if !workspace.is_wsl() {
        let common = common_dir(&repo)?;
        for entry in &entries {
            authorize_linked(registry, &repo, &common, entry);
        }
    }
    Ok(entries)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum WorktreeBranch {
    NewBranch { name: String },
    ExistingBranch { name: String },
    Detach,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeAddRequest {
    /// Absolute location. Omitted: `<worktrees dir>/<project>/<task>`.
    pub path: Option<String>,
    /// Names the default location; ignored when `path` is given.
    pub task_slug: Option<String>,
    pub branch: WorktreeBranch,
    /// Start point for a new branch or a detached HEAD (default `HEAD`).
    pub base: Option<String>,
    /// Glob patterns (relative to the repository root) of files to copy into
    /// the new worktree even though git ignores them, e.g. `.env`.
    #[serde(default)]
    pub include: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeAdded {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub detached: bool,
    pub copied: Vec<String>,
    pub skipped: Vec<Skipped>,
    /// A copy budget (files, bytes or directory entries) ran out.
    pub include_truncated: bool,
}

fn has_glob_meta(pattern: &str) -> bool {
    pattern.contains(['*', '?', '[', '{'])
}

/// A pattern may only name something inside the repository: relative, no `..`,
/// not a negation, not git's own directory.
pub fn validate_include_pattern(pattern: &str) -> std::result::Result<(), String> {
    if pattern.is_empty() || pattern.len() > 256 {
        return Err("empty or oversized pattern".into());
    }
    if pattern.contains('\0') || pattern.chars().any(|c| c.is_control()) {
        return Err("control characters".into());
    }
    if pattern.starts_with('!') || pattern.starts_with('/') || pattern.starts_with('\\') {
        return Err("must be relative".into());
    }
    let bytes = pattern.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return Err("drive paths are not allowed".into());
    }
    if pattern.contains('\\') {
        return Err("use forward slashes".into());
    }
    let mut parts = pattern.split('/').peekable();
    while let Some(part) = parts.next() {
        if part == ".." || part == "." {
            return Err("path traversal".into());
        }
        if part.eq_ignore_ascii_case(".git") {
            return Err("git internals".into());
        }
        if part.is_empty() && parts.peek().is_some() {
            return Err("empty path component".into());
        }
    }
    Ok(())
}

/// The leading directory components of `pattern` that contain no wildcard: the
/// only subtree that needs walking.
pub fn static_prefix(pattern: &str) -> String {
    let parts: Vec<&str> = pattern.split('/').collect();
    let mut prefix: Vec<&str> = Vec::new();
    for part in &parts[..parts.len().saturating_sub(1)] {
        if has_glob_meta(part) {
            break;
        }
        prefix.push(part);
    }
    prefix.join("/")
}

fn default_location_slug(repo_path: &Path) -> String {
    let name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in repo_path.to_string_lossy().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{}-{:06x}", refs::slugify(&name, 40), hash & 0x00ff_ffff)
}

/// Atomically claims `<parent>/<name>` (or `<name>-2`, `-3`, ...) by creating
/// it; two tasks racing for one name get different directories.
pub fn claim_directory(parent: &Path, name: &str) -> io::Result<PathBuf> {
    std::fs::create_dir_all(parent)?;
    for attempt in 1..=1000u32 {
        let candidate = if attempt == 1 {
            parent.join(name)
        } else {
            parent.join(format!("{name}-{attempt}"))
        };
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no free worktree directory name",
    ))
}

/// The deepest existing ancestor of `path`, canonicalized.
fn existing_ancestor(path: &Path) -> io::Result<PathBuf> {
    let mut cursor = path;
    loop {
        match std::fs::canonicalize(cursor) {
            Ok(found) => return Ok(found),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                cursor = cursor.parent().ok_or(e)?;
            }
            Err(e) => return Err(e),
        }
    }
}

struct Target {
    path: PathBuf,
    /// We created the directory and must remove it again if git fails.
    claimed: bool,
}

fn choose_target(
    registry: &WorkspaceRegistry,
    repo: &ResolvedGitDirectory,
    main_path: &Path,
    worktrees_dir: &Path,
    request: &WorktreeAddRequest,
) -> Result<Target> {
    match request.path.as_deref().filter(|p| !p.is_empty()) {
        Some(raw) => {
            let path = PathBuf::from(raw);
            if !path.is_absolute() || path.components().any(|c| c == Component::ParentDir) {
                return Err(GitError::InvalidPath(raw.to_string()));
            }
            let ancestor = existing_ancestor(&path)?;
            if !registry.is_authorized(&ancestor) {
                return Err(GitError::PathOutsideWorkspace(ancestor));
            }
            let resolved = ancestor.join(
                path.strip_prefix(existing_prefix(&path))
                    .unwrap_or(Path::new("")),
            );
            if resolved.starts_with(&repo.local_path) || repo.local_path.starts_with(&resolved) {
                return Err(GitError::InvalidPath(format!(
                    "{raw} overlaps the repository"
                )));
            }
            if path.exists() && std::fs::read_dir(&path)?.next().is_some() {
                return Err(GitError::InvalidPath(format!("{raw} is not empty")));
            }
            Ok(Target {
                path,
                claimed: false,
            })
        }
        None => {
            let task = refs::slugify(request.task_slug.as_deref().unwrap_or("task"), 48);
            let parent = worktrees_dir.join(default_location_slug(main_path));
            let claimed = claim_directory(&parent, &task)?;
            Ok(Target {
                path: claimed,
                claimed: true,
            })
        }
    }
}

/// The longest prefix of `path` that exists on disk.
fn existing_prefix(path: &Path) -> PathBuf {
    let mut cursor = path;
    while !cursor.exists() {
        match cursor.parent() {
            Some(parent) => cursor = parent,
            None => break,
        }
    }
    cursor.to_path_buf()
}

pub fn add(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    request: &WorktreeAddRequest,
    worktrees_dir: &Path,
    workspace: &WorkspaceEnv,
) -> Result<WorktreeAdded> {
    add_inner(registry, repo_root, request, worktrees_dir, workspace, None)
}

pub(crate) fn add_claimed(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    request: &WorktreeAddRequest,
    path: PathBuf,
    workspace: &WorkspaceEnv,
) -> Result<WorktreeAdded> {
    add_inner(
        registry,
        repo_root,
        request,
        Path::new(""),
        workspace,
        Some(Target {
            path,
            claimed: true,
        }),
    )
}

fn add_inner(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    request: &WorktreeAddRequest,
    worktrees_dir: &Path,
    workspace: &WorkspaceEnv,
    claimed: Option<Target>,
) -> Result<WorktreeAdded> {
    if workspace.is_wsl() {
        return Err(GitError::Unsupported(WSL_WORKTREES_UNSUPPORTED));
    }
    let repo = open_worktree(registry, repo_root, workspace)?;
    if request.include.len() > MAX_INCLUDE_PATTERNS {
        return Err(GitError::InvalidPath("too many include patterns".into()));
    }
    for pattern in &request.include {
        validate_include_pattern(pattern)
            .map_err(|why| GitError::InvalidPath(format!("{pattern}: {why}")))?;
    }

    let base_id = match head_commit_opt(&repo)? {
        None => {
            return Err(GitError::command(
                "git worktree add",
                "the repository has no commits yet",
            ))
        }
        Some(head) => match request.base.as_deref().filter(|b| !b.is_empty()) {
            Some(base) => resolve_commit(&repo, base)?,
            None => head,
        },
    };

    let mut git_args = if claimed.is_some() {
        let hooks = super::plumbing::git_dir(&repo)?.join("terax-task-hooks");
        std::fs::create_dir_all(&hooks)?;
        super::checkpoint::plumbing_config(&hooks)
    } else {
        Vec::new()
    };
    git_args.extend(os_args(["worktree", "add"]));
    let branch_name = match &request.branch {
        WorktreeBranch::NewBranch { name } => {
            check_branch_name(&repo, name)?;
            if branch_exists(&repo, name)? {
                return Err(GitError::command(
                    "git worktree add",
                    format!("branch {name} already exists"),
                ));
            }
            git_args.extend(os_args(["-b", name.as_str()]));
            Some(name.clone())
        }
        WorktreeBranch::ExistingBranch { name } => {
            check_branch_name(&repo, name)?;
            if !branch_exists(&repo, name)? {
                return Err(GitError::command(
                    "git worktree add",
                    format!("branch {name} does not exist"),
                ));
            }
            Some(name.clone())
        }
        WorktreeBranch::Detach => {
            git_args.push("--detach".into());
            None
        }
    };

    let entries = list_entries(&repo)?;
    let main_path = entries
        .first()
        .map(|e| PathBuf::from(&e.path))
        .unwrap_or_else(|| repo.local_path.clone());
    let target = match claimed {
        Some(target) => target,
        None => choose_target(registry, &repo, &main_path, worktrees_dir, request)?,
    };
    let target_arg = crate::modules::git::utils::git_arg(&target.path);

    git_args.push("--".into());
    git_args.push(target_arg);
    match &request.branch {
        WorktreeBranch::NewBranch { .. } | WorktreeBranch::Detach => {
            git_args.push(base_id.clone().into())
        }
        WorktreeBranch::ExistingBranch { name } => git_args.push(name.clone().into()),
    }
    let output = run_git(
        &repo.workspace,
        Some(&repo.git_path),
        git_args,
        NETWORK_TIMEOUT_SECS,
    )?;
    if let Err(err) = ensure_success(&output, "git worktree add failed") {
        if target.claimed {
            let _ = std::fs::remove_dir(&target.path);
        }
        return Err(err);
    }

    let local = std::fs::canonicalize(&target.path)?;
    registry.authorize_derived(&local, &repo.local_path)?;

    let (copied, skipped, include_truncated) = if request.include.is_empty() {
        (Vec::new(), Vec::new(), false)
    } else {
        let report = copy_included(&repo.local_path, &local, &request.include);
        (report.copied, report.skipped, report.truncated)
    };

    let new_head = run_ok(
        &open_new(registry, &local, workspace)?,
        os_args(["rev-parse", "HEAD"]),
        "git rev-parse failed",
    )
    .map(|o| stdout_text(&o))
    .unwrap_or(base_id);
    Ok(WorktreeAdded {
        path: crate::modules::fs::to_canon(&local),
        detached: branch_name.is_none(),
        branch: branch_name,
        head: new_head,
        copied,
        skipped,
        include_truncated,
    })
}

fn open_new(
    registry: &WorkspaceRegistry,
    path: &Path,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    canonical_dir(registry, &path.to_string_lossy(), workspace)
}

#[derive(Debug, Default)]
pub struct CopyReport {
    pub copied: Vec<String>,
    pub skipped: Vec<Skipped>,
    pub truncated: bool,
}

fn skip(path: &str, reason: &str) -> Skipped {
    Skipped {
        path: path.to_string(),
        reason: reason.to_string(),
    }
}

fn copy_one(
    src_root: &Path,
    dst_root: &Path,
    rel: &str,
    total: &mut u64,
) -> std::result::Result<(), &'static str> {
    let src = src_root.join(rel);
    let meta = std::fs::symlink_metadata(&src).map_err(|_| "missing")?;
    if meta.file_type().is_symlink() {
        return Err("symlink");
    }
    if !meta.is_file() {
        return Err("not-a-file");
    }
    let canonical_src = std::fs::canonicalize(&src).map_err(|_| "missing")?;
    if !canonical_src.starts_with(src_root) {
        return Err("outside-repository");
    }
    if meta.len() > MAX_INCLUDE_FILE_BYTES {
        return Err("too-large");
    }
    if total.saturating_add(meta.len()) > MAX_INCLUDE_TOTAL_BYTES {
        return Err("budget-exceeded");
    }
    let dst = dst_root.join(rel);
    if std::fs::symlink_metadata(&dst).is_ok() {
        return Err("already-exists");
    }
    let parent = create_dirs_confined(dst_root, rel)?;
    let canonical_parent = std::fs::canonicalize(&parent).map_err(|_| "create-dir-failed")?;
    if !canonical_parent.starts_with(dst_root) {
        return Err("outside-worktree");
    }
    let mut input = std::fs::File::open(&src).map_err(|_| "unreadable")?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        // Created with its final mode, so a `0600` secret is never readable
        // under a looser default for the moment it takes to copy it.
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(meta.permissions().mode() & 0o7777);
    }
    let mut output = options.open(&dst).map_err(|_| "already-exists")?;
    if io::copy(&mut input, &mut output).is_err() {
        drop(output);
        let _ = std::fs::remove_file(&dst);
        return Err("copy-failed");
    }
    let _ = std::fs::set_permissions(&dst, meta.permissions());
    *total += meta.len();
    Ok(())
}

/// Creates the directories above `rel` under `root` one level at a time and
/// gives up the moment a component is not a plain directory (a symlink could
/// lead out of the worktree), so nothing is ever created outside it. Returns
/// the directory the file goes into.
pub(crate) fn create_dirs_confined(
    root: &Path,
    rel: &str,
) -> std::result::Result<PathBuf, &'static str> {
    let Some((dir, _name)) = rel.rsplit_once('/') else {
        return Ok(root.to_path_buf());
    };
    let mut current = root.to_path_buf();
    for component in dir.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err("invalid-path");
        }
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return Err("outside-worktree"),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                std::fs::create_dir(&current).map_err(|_| "create-dir-failed")?;
            }
            Err(_) => return Err("create-dir-failed"),
        }
    }
    Ok(current)
}

/// How deep below the static prefix a match can sit: a pattern without `**`
/// (or braces, which may hide a slash) names a fixed number of components.
pub fn walk_depth(pattern: &str, prefix: &str) -> Option<usize> {
    if pattern.contains("**") || pattern.contains('{') {
        return None;
    }
    let components = pattern.split('/').count();
    let skipped = if prefix.is_empty() {
        0
    } else {
        prefix.split('/').count()
    };
    Some(components.saturating_sub(skipped).max(1))
}

/// Copies the files matching `patterns` from `src_root` into `dst_root`, never
/// overwriting, never following symlinks, never leaving either root, within
/// file-count and byte budgets. Literal patterns are `stat`ed directly; only a
/// wildcard pattern walks, and only below its static directory prefix.
pub fn copy_included(src_root: &Path, dst_root: &Path, patterns: &[String]) -> CopyReport {
    copy_included_inner(src_root, dst_root, patterns, None)
        .expect("unfiltered copying has no git operations")
}

pub(crate) fn copy_ignored_included(
    repo: &ResolvedGitDirectory,
    dst: &Path,
    patterns: &[String],
) -> Result<CopyReport> {
    copy_included_inner(&repo.local_path, dst, patterns, Some(repo))
}

fn copy_included_inner(
    src_root: &Path,
    dst_root: &Path,
    patterns: &[String],
    repo: Option<&ResolvedGitDirectory>,
) -> Result<CopyReport> {
    let mut report = CopyReport::default();
    let mut candidates: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |rel: String, candidates: &mut Vec<String>| {
        if seen.insert(rel.clone()) {
            candidates.push(rel);
        }
    };

    for pattern in patterns {
        if !has_glob_meta(pattern) {
            push(pattern.trim_end_matches('/').to_string(), &mut candidates);
            continue;
        }
        // `*` stays inside one path component and only `**` crosses `/`, so
        // `apps/*/.env` is not `apps/a/b/c/.env`.
        let Ok(glob) = GlobBuilder::new(pattern).literal_separator(true).build() else {
            report.skipped.push(skip(pattern, "invalid-glob"));
            continue;
        };
        let mut builder = GlobSetBuilder::new();
        builder.add(glob);
        let Ok(set) = builder.build() else {
            report.skipped.push(skip(pattern, "invalid-glob"));
            continue;
        };
        let prefix = static_prefix(pattern);
        let start = if prefix.is_empty() {
            src_root.to_path_buf()
        } else {
            src_root.join(&prefix)
        };
        if !start.is_dir() {
            continue;
        }
        let max_depth = walk_depth(pattern, &prefix);
        let walker = ignore::WalkBuilder::new(&start)
            .standard_filters(false)
            .follow_links(false)
            .max_depth(max_depth)
            .filter_entry(|entry| {
                // The repository's own directory and dependency / cache trees
                // are never walked below the start directory: a `.env.*` found
                // only after 100k entries of `target/` would be a missed file.
                entry.depth() == 0
                    || !entry
                        .file_name()
                        .to_str()
                        .is_some_and(|name| name == ".git" || REGENERABLE.contains(&name))
            })
            .build();
        let mut visited = 0usize;
        for entry in walker.flatten() {
            visited += 1;
            if visited > MAX_INCLUDE_WALK_ENTRIES {
                report.truncated = true;
                break;
            }
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(src_root) else {
                continue;
            };
            let rel = crate::modules::git::plumbing::forward_slashes(&rel.to_string_lossy());
            if set.is_match(&rel) {
                push(rel, &mut candidates);
            }
        }
    }

    candidates.sort();
    if let Some(repo) = repo.filter(|_| !candidates.is_empty()) {
        let input = candidates
            .iter()
            .flat_map(|p| p.bytes().chain(std::iter::once(0)))
            .collect();
        let output = super::process::run_git_with(
            &repo.workspace,
            Some(&repo.git_path),
            os_args(["check-ignore", "--stdin", "-z"]),
            DEFAULT_TIMEOUT_SECS,
            super::process::RunOptions {
                stdin: Some(input),
                stdout_cap: 4 * 1024 * 1024,
                ..Default::default()
            },
        )?;
        if output.timed_out || output.truncated || !matches!(output.exit_code, Some(0 | 1)) {
            return Err(GitError::command(
                "task include",
                "could not determine ignored files",
            ));
        }
        let ignored: HashSet<_> = output
            .stdout
            .split(|b| *b == 0)
            .filter_map(|p| std::str::from_utf8(p).ok())
            .collect();
        candidates.retain(|p| ignored.contains(p.as_str()));
    }
    let mut total = 0u64;
    for rel in candidates {
        if report.copied.len() >= MAX_INCLUDE_FILES {
            report.truncated = true;
            report.skipped.push(skip(&rel, "file-limit"));
            continue;
        }
        match copy_one(src_root, dst_root, &rel, &mut total) {
            Ok(()) => report.copied.push(rel),
            Err("missing") => {}
            Err(reason) => {
                if reason == "budget-exceeded" {
                    report.truncated = true;
                }
                report.skipped.push(skip(&rel, reason));
            }
        }
    }
    Ok(report)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoveBlocker {
    Locked,
    Dirty,
    Unmerged,
    /// Ignored files that are not regenerable (`.env`, local databases...):
    /// git itself would delete them without a word.
    Ignored,
    /// A safety check could not finish (failed, timed out or was cut short), so
    /// nothing is known about what removal would lose. `inconclusive` names
    /// the checks.
    Inconclusive,
}

const MAX_IGNORED_SAMPLE: usize = 20;
const IGNORED_LISTING_CAP_BYTES: usize = 256 * 1024;

/// Size limits of the checks `remove` runs; the defaults are the real ones and
/// the tests shrink them to force an inconclusive check.
#[derive(Debug, Clone, Copy)]
pub struct RemoveLimits {
    pub ignored_listing_bytes: usize,
}

impl Default for RemoveLimits {
    fn default() -> Self {
        Self {
            ignored_listing_bytes: IGNORED_LISTING_CAP_BYTES,
        }
    }
}

/// A check's answer can be trusted only if git finished it: exit 0, in time, and
/// not cut at the output cap.
pub(crate) fn probe_conclusive(output: &crate::modules::git::types::GitOutput) -> bool {
    output.exit_code == Some(0) && !output.timed_out && !output.truncated
}

/// Ignored entries a rebuild brings back (dependency and tool caches); losing
/// them costs time, not data.
const REGENERABLE: &[&str] = &[
    "node_modules",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".gradle",
    ".pnpm-store",
    ".turbo",
    ".next",
    ".nuxt",
    ".cache",
    ".parcel-cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    ".dart_tool",
];

/// Whether an ignored entry (a file, or a directory with a trailing `/`) is
/// regenerable: its last component, or any directory above it, is a cache or
/// dependency directory.
pub fn is_regenerable(entry: &str) -> bool {
    entry
        .trim_end_matches('/')
        .split('/')
        .any(|part| REGENERABLE.contains(&part))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct IgnoredSummary {
    /// A sample of the entries that are not regenerable.
    pub sample: Vec<String>,
    /// How many entries are not regenerable and differ from the main checkout.
    pub total: u32,
    pub regenerable: u32,
    /// Entries byte-identical to the main checkout's copy (typically files
    /// that `include` copied in and nobody touched): nothing is lost with them.
    pub identical: u32,
}

const COMPARE_MAX_FILES: usize = 200;
const COMPARE_MAX_BYTES: u64 = 16 * 1024 * 1024;

fn same_bytes(a: &Path, b: &Path, budget: &mut u64) -> bool {
    use std::io::Read;
    let (Ok(ma), Ok(mb)) = (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) else {
        return false;
    };
    if ma.file_type().is_symlink() || mb.file_type().is_symlink() {
        return ma.file_type().is_symlink()
            && mb.file_type().is_symlink()
            && std::fs::read_link(a).ok() == std::fs::read_link(b).ok();
    }
    if !ma.is_file() || !mb.is_file() || ma.len() != mb.len() || ma.len() > *budget {
        return false;
    }
    *budget -= ma.len();
    let (Ok(mut fa), Ok(mut fb)) = (std::fs::File::open(a), std::fs::File::open(b)) else {
        return false;
    };
    let (mut ba, mut bb) = (vec![0u8; 16 * 1024], vec![0u8; 16 * 1024]);
    loop {
        let na = match fa.read(&mut ba) {
            Ok(n) => n,
            Err(_) => return false,
        };
        if na == 0 {
            return fb.read(&mut bb).is_ok_and(|n| n == 0);
        }
        if fb.read_exact(&mut bb[..na]).is_err() || ba[..na] != bb[..na] {
            return false;
        }
    }
}

fn same_tree(main: &Path, wt: &Path, files: &mut usize, budget: &mut u64) -> bool {
    let Ok(read) = std::fs::read_dir(wt) else {
        return false;
    };
    for entry in read.flatten() {
        let name = entry.file_name();
        let (theirs, ours) = (main.join(&name), wt.join(&name));
        let Ok(kind) = entry.file_type() else {
            return false;
        };
        if kind.is_dir() {
            if !theirs.is_dir() || !same_tree(&theirs, &ours, files, budget) {
                return false;
            }
        } else {
            *files += 1;
            if *files > COMPARE_MAX_FILES || !same_bytes(&theirs, &ours, budget) {
                return false;
            }
        }
    }
    true
}

/// Whether an ignored entry of the worktree (a file, or a directory with a
/// trailing `/`) exists in the main checkout with exactly the same bytes. A
/// comparison that outgrows its budget answers `false`: when in doubt the entry
/// counts as data.
pub fn identical_to_main(main_root: &Path, worktree_root: &Path, entry: &str) -> bool {
    let rel = entry.trim_end_matches('/');
    if rel.is_empty() || validate_include_pattern(rel).is_err() {
        return false;
    }
    let (main, worktree) = (main_root.join(rel), worktree_root.join(rel));
    let mut budget = COMPARE_MAX_BYTES;
    if entry.ends_with('/') {
        let mut files = 0;
        main.is_dir() && same_tree(&main, &worktree, &mut files, &mut budget)
    } else {
        same_bytes(&main, &worktree, &mut budget)
    }
}

/// Summarizes `git ls-files --others --ignored --exclude-standard --directory
/// -z` output; `identical` tells which entries match the main checkout.
pub fn summarize_ignored(listing: &[u8], identical: impl Fn(&str) -> bool) -> IgnoredSummary {
    let mut summary = IgnoredSummary::default();
    for raw in listing.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        let entry = String::from_utf8_lossy(raw);
        if is_regenerable(&entry) {
            summary.regenerable += 1;
        } else if identical(&entry) {
            summary.identical += 1;
        } else {
            summary.total += 1;
            if summary.sample.len() < MAX_IGNORED_SAMPLE {
                summary.sample.push(entry.into_owned());
            }
        }
    }
    summary
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveReport {
    pub removed: bool,
    pub path: String,
    pub branch: Option<String>,
    pub blockers: Vec<RemoveBlocker>,
    /// Changed tracked files (capped); untracked files are only counted.
    pub dirty_files: Vec<ChangedPath>,
    pub dirty_total: u32,
    pub untracked_count: u32,
    /// Commits on the worktree's HEAD that no other branch, remote ref or tag
    /// contains: work that exists nowhere else.
    pub unmerged_commits: u32,
    /// Ignored files that are not regenerable (a sample, and the count).
    pub ignored_files: Vec<String>,
    pub ignored_total: u32,
    /// Ignored dependency / cache entries (not blockers).
    pub ignored_regenerable: u32,
    /// Ignored entries byte-identical to the main checkout's copy (not
    /// blockers): what `include` copied in and nobody changed.
    pub ignored_identical: u32,
    /// Checks that could not finish (`ignored-files`, `unmerged-commits`);
    /// each also raises the `inconclusive` blocker.
    pub inconclusive: Vec<String>,
    pub lock_reason: Option<String>,
}

/// Parses `git status --porcelain=v1 -z` into changed tracked files and a count
/// of untracked ones.
pub fn parse_status_v1(bytes: &[u8]) -> (Vec<ChangedPath>, u32) {
    let mut changed = Vec::new();
    let mut untracked = 0u32;
    let mut tokens = bytes.split(|b| *b == 0).filter(|t| !t.is_empty());
    while let Some(token) = tokens.next() {
        if token.len() < 4 {
            continue;
        }
        let (code, path) = (
            &token[..2],
            String::from_utf8_lossy(&token[3..]).into_owned(),
        );
        if code == b"??" {
            untracked += 1;
            continue;
        }
        if code == b"!!" {
            continue;
        }
        let status = match (code[0], code[1]) {
            (b'R', _) | (_, b'R') => {
                tokens.next();
                FileStatus::Renamed
            }
            (b'C', _) | (_, b'C') => {
                tokens.next();
                FileStatus::Copied
            }
            (b'A', _) | (_, b'A') => FileStatus::Added,
            (b'D', _) | (_, b'D') => FileStatus::Deleted,
            (b'U', _) | (_, b'U') => FileStatus::Unmerged,
            (b'T', _) | (_, b'T') => FileStatus::TypeChanged,
            _ => FileStatus::Modified,
        };
        changed.push(ChangedPath { path, status });
    }
    (changed, untracked)
}

fn same_path(a: &str, b: &Path) -> bool {
    let a_canon = std::fs::canonicalize(a).unwrap_or_else(|_| PathBuf::from(a));
    let b_canon = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    a_canon == b_canon
}

pub fn remove(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    force: bool,
    workspace: &WorkspaceEnv,
) -> Result<WorktreeRemoveReport> {
    remove_with_limits(
        registry,
        repo_root,
        path,
        force,
        workspace,
        RemoveLimits::default(),
    )
}

pub fn remove_with_limits(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    force: bool,
    workspace: &WorkspaceEnv,
    limits: RemoveLimits,
) -> Result<WorktreeRemoveReport> {
    remove_inner(registry, repo_root, path, force, workspace, limits, false)
}

pub(crate) fn inspect_removal(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<WorktreeRemoveReport> {
    remove_inner(
        registry,
        repo_root,
        path,
        false,
        workspace,
        RemoveLimits::default(),
        true,
    )
}

fn remove_inner(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    force: bool,
    workspace: &WorkspaceEnv,
    limits: RemoveLimits,
    inspect: bool,
) -> Result<WorktreeRemoveReport> {
    if workspace.is_wsl() {
        return Err(GitError::Unsupported(WSL_WORKTREES_UNSUPPORTED));
    }
    let repo = open_worktree(registry, repo_root, workspace)?;
    let target = PathBuf::from(path);
    let entries = list_entries(&repo)?;
    let Some(entry) = entries
        .iter()
        .find(|e| same_path(&e.path, &target))
        .cloned()
    else {
        return Err(GitError::command(
            "git worktree remove",
            "not a worktree of this repository",
        ));
    };
    if entry.is_main {
        return Err(GitError::command(
            "git worktree remove",
            "the main worktree cannot be removed",
        ));
    }
    let main_path = entries
        .first()
        .map(|e| e.path.clone())
        .unwrap_or_else(|| repo.git_path.clone());
    let main = open_new(registry, Path::new(&main_path), workspace)?;

    let mut report = WorktreeRemoveReport {
        removed: false,
        path: entry.path.clone(),
        branch: entry.branch.clone(),
        blockers: Vec::new(),
        dirty_files: Vec::new(),
        dirty_total: 0,
        untracked_count: 0,
        unmerged_commits: 0,
        ignored_files: Vec::new(),
        ignored_total: 0,
        ignored_regenerable: 0,
        ignored_identical: 0,
        inconclusive: Vec::new(),
        lock_reason: entry.lock_reason.clone(),
    };
    if entry.locked {
        report.blockers.push(RemoveBlocker::Locked);
        return Ok(report);
    }

    if entry.exists {
        if !workspace.is_wsl() {
            // After a restart nothing has listed this worktree yet.
            authorize_linked(registry, &repo, &common_dir(&repo)?, &entry);
        }
        let worktree = open_new(registry, Path::new(&entry.path), workspace)?;
        if !registry.is_authorized(&worktree.local_path) {
            return Err(GitError::PathOutsideWorkspace(worktree.local_path));
        }
        let status = run_ok(
            &worktree,
            os_args(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
            "git status failed",
        )?;
        let (changed, untracked) = parse_status_v1(&status.stdout);
        report.dirty_total = changed.len() as u32;
        report.dirty_files = changed.into_iter().take(MAX_DIRTY_REPORTED).collect();
        report.untracked_count = untracked;
        if report.dirty_total > 0 || untracked > 0 {
            report.blockers.push(RemoveBlocker::Dirty);
        }

        // Ignored files are invisible to `status`, yet `git worktree remove`
        // deletes them like everything else: `.env` files, local databases.
        let ignored = run_git_capped(
            &worktree.workspace,
            Some(&worktree.git_path),
            os_args([
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
                "-z",
            ]),
            DEFAULT_TIMEOUT_SECS,
            limits.ignored_listing_bytes,
        )?;
        if !probe_conclusive(&ignored) {
            // What was listed may be only a part of the ignored files.
            report.inconclusive.push("ignored-files".to_string());
        }
        let summary = summarize_ignored(&ignored.stdout, |entry| {
            identical_to_main(&main.local_path, &worktree.local_path, entry)
        });
        report.ignored_files = summary.sample;
        report.ignored_total = summary.total;
        report.ignored_regenerable = summary.regenerable;
        report.ignored_identical = summary.identical;
        if summary.total > 0 {
            report.blockers.push(RemoveBlocker::Ignored);
        }
    }

    if let Some(head) = entry.head.as_deref() {
        let mut args = os_args(["rev-list", "--count", head, "--not"]);
        if let Some(branch) = entry.branch.as_deref() {
            args.push(format!("--exclude={branch}").into());
        }
        args.extend(os_args(["--branches", "--remotes", "--tags"]));
        let counted = run(&main, args)?;
        match stdout_text(&counted).parse::<u32>() {
            Ok(count) if probe_conclusive(&counted) => report.unmerged_commits = count,
            _ => report.inconclusive.push("unmerged-commits".to_string()),
        }
        if report.unmerged_commits > 0 {
            report.blockers.push(RemoveBlocker::Unmerged);
        }
    }

    // Fail closed: a check that could not finish proves nothing, and `force`
    // is how the caller overrides it.
    if !report.inconclusive.is_empty() {
        report.blockers.push(RemoveBlocker::Inconclusive);
    }

    if inspect || (!force && !report.blockers.is_empty()) {
        return Ok(report);
    }

    if entry.exists {
        let mut args = os_args(["worktree", "remove"]);
        if force {
            args.push("--force".into());
        }
        args.push(entry.path.clone().into());
        let output = run_git(
            &main.workspace,
            Some(&main.git_path),
            args,
            NETWORK_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git worktree remove failed")?;
    } else {
        // The directory is already gone (unmounted, deleted): drop this one
        // administrative entry. A repository-wide prune would also forget every
        // other stale worktree, such as one on a volume that is merely offline.
        let output = run_git(
            &main.workspace,
            Some(&main.git_path),
            os_args(["worktree", "remove", "--force", entry.path.as_str()]),
            NETWORK_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git worktree remove failed")?;
    }
    registry.revoke_derived(Path::new(&entry.path));
    report.removed = true;
    Ok(report)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub pruned: Vec<String>,
}

pub fn prune(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<PruneReport> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    let before: Vec<String> = list_entries(&repo)?
        .into_iter()
        .filter(|e| e.prunable)
        .map(|e| e.path)
        .collect();
    let output = run(&repo, os_args(["worktree", "prune"]))?;
    if output.timed_out {
        return Err(GitError::TimedOut("git worktree prune"));
    }
    ensure_success(&output, "git worktree prune failed")?;
    let after: HashSet<String> = list_entries(&repo)?.into_iter().map(|e| e.path).collect();
    let pruned: Vec<String> = before.into_iter().filter(|p| !after.contains(p)).collect();
    for path in &pruned {
        registry.revoke_derived(Path::new(path));
    }
    Ok(PruneReport { pruned })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORCELAIN: &str = "worktree /repo\nHEAD aaaaaaaa\nbranch refs/heads/main\n\nworktree /wt/feature\nHEAD bbbbbbbb\nbranch refs/heads/feature/x\nlocked in use by task\n\nworktree /wt/detached\nHEAD cccccccc\ndetached\nlocked\n\nworktree /wt/gone\nHEAD dddddddd\ndetached\nprunable gitdir file points to non-existent location\n\nworktree /bare\nbare\n";

    #[test]
    fn regenerable_means_a_dependency_or_cache_directory_anywhere_in_the_path() {
        for yes in [
            "node_modules/",
            "target/",
            ".venv/",
            "apps/web/node_modules/",
            "pkg/__pycache__/",
            ".next/",
            "node_modules/pkg/index.js",
        ] {
            assert!(is_regenerable(yes), "{yes}");
        }
        for no in [
            ".env",
            "local.sqlite",
            "data/",
            "secrets/prod.key",
            "dist/",
            "build/",
            "targets.txt",
            "my_node_modules/",
        ] {
            assert!(!is_regenerable(no), "{no}");
        }
    }

    #[test]
    fn the_ignored_summary_counts_both_kinds_and_samples_only_the_data() {
        let mut listing = Vec::new();
        listing.extend_from_slice(b".env\0node_modules/\0local.sqlite\0target/\0\0");
        for i in 0..40 {
            listing.extend_from_slice(format!("data/f{i}\0").as_bytes());
        }
        let summary = summarize_ignored(&listing, |_| false);
        assert_eq!(summary.total, 42);
        assert_eq!(summary.regenerable, 2);
        assert_eq!(summary.sample.len(), MAX_IGNORED_SAMPLE);
        assert_eq!(&summary.sample[..2], [".env", "local.sqlite"]);
        assert_eq!(summarize_ignored(b"", |_| false), IgnoredSummary::default());
    }

    #[test]
    fn existence_is_looked_up_through_the_workspace_env() {
        let dir = tempfile::tempdir().unwrap();
        let here = dir.path().to_string_lossy().into_owned();
        assert!(entry_exists(&WorkspaceEnv::Local, &here));
        assert!(!entry_exists(
            &WorkspaceEnv::Local,
            &format!("{here}/missing")
        ));
    }

    #[test]
    fn parses_every_flag_of_the_porcelain_listing() {
        let entries = parse_worktree_list(PORCELAIN);
        assert_eq!(entries.len(), 5);
        assert!(entries[0].is_main && !entries[1].is_main);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert_eq!(entries[0].head.as_deref(), Some("aaaaaaaa"));
        assert_eq!(entries[1].branch.as_deref(), Some("feature/x"));
        assert!(entries[1].locked);
        assert_eq!(entries[1].lock_reason.as_deref(), Some("in use by task"));
        assert!(entries[2].detached && entries[2].locked);
        assert_eq!(entries[2].lock_reason, None);
        assert!(entries[3].prunable);
        assert_eq!(
            entries[3].prunable_reason.as_deref(),
            Some("gitdir file points to non-existent location")
        );
        assert!(entries[4].bare);
    }

    #[test]
    fn paths_with_spaces_and_unicode_survive_parsing() {
        let entries = parse_worktree_list(
            "worktree /tmp/my repo/caf\u{e9}\nHEAD abc\nbranch refs/heads/main\n",
        );
        assert_eq!(entries[0].path, "/tmp/my repo/caf\u{e9}");
    }

    #[test]
    fn empty_listing_parses_to_nothing() {
        assert!(parse_worktree_list("").is_empty());
        assert!(parse_worktree_list("\n\n").is_empty());
    }

    #[test]
    fn include_patterns_are_confined_to_the_repository() {
        for ok in [
            ".env",
            ".env.*",
            "config/local.json",
            "apps/*/.env",
            "**/.env.local",
            "dir/",
        ] {
            assert!(validate_include_pattern(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../secret",
            "a/../../b",
            "./x",
            "!x",
            ".git/config",
            "sub/.GIT/hooks",
            "C:/Windows",
            "a\\b",
            "a//b",
            "x\0y",
        ] {
            assert!(validate_include_pattern(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn static_prefix_stops_at_the_first_wildcard_directory() {
        assert_eq!(static_prefix(".env"), "");
        assert_eq!(static_prefix("**/.env"), "");
        assert_eq!(static_prefix("apps/web/.env*"), "apps/web");
        assert_eq!(static_prefix("apps/*/.env"), "apps");
        assert_eq!(static_prefix("a/b/c/*.json"), "a/b/c");
    }

    #[test]
    fn walk_depth_counts_the_components_a_pattern_can_reach() {
        assert_eq!(walk_depth(".env.*", ""), Some(1));
        assert_eq!(walk_depth("*/.env", ""), Some(2));
        assert_eq!(walk_depth("apps/*/.env", "apps"), Some(2));
        assert_eq!(walk_depth("apps/web/.env*", "apps/web"), Some(1));
        assert_eq!(walk_depth("a/b/c/*.json", "a/b/c"), Some(1));
        assert_eq!(walk_depth("**/.env", ""), None);
        assert_eq!(walk_depth("apps/**/.env", "apps"), None);
        assert_eq!(walk_depth("{a,b/c}/.env", ""), None);
    }

    fn sources(files: &[&str]) -> (tempfile::TempDir, PathBuf, tempfile::TempDir, PathBuf) {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let src_root = std::fs::canonicalize(src.path()).unwrap();
        let dst_root = std::fs::canonicalize(dst.path()).unwrap();
        for file in files {
            let path = src_root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x\n").unwrap();
        }
        (src, src_root, dst, dst_root)
    }

    #[test]
    fn a_single_star_stays_inside_one_directory_and_a_double_star_crosses_them() {
        let files = [
            "apps/a/.env",
            "apps/a/deep/.env",
            "apps/a/deep/er/.env",
            ".env.local",
            "sub/.env.local",
            "top.local",
            "sub/nested.local",
        ];
        let (_s, src, _d, dst) = sources(&files);
        let report = copy_included(
            &src,
            &dst,
            &["apps/*/.env".into(), ".env.*".into(), "*.local".into()],
        );
        assert_eq!(
            report.copied,
            vec![".env.local", "apps/a/.env", "top.local"],
            "{report:?}"
        );

        let (_s, src, _d, dst) = sources(&files);
        let report = copy_included(&src, &dst, &["apps/**/.env".into()]);
        assert_eq!(
            report.copied,
            vec!["apps/a/.env", "apps/a/deep/.env", "apps/a/deep/er/.env"]
        );
    }

    #[test]
    fn a_wildcard_include_never_walks_the_repository_dependency_and_cache_trees() {
        let (_s, src, _d, dst) = sources(&[
            "src/.env.local",
            "target/debug/.env.local",
            "node_modules/pkg/.env.local",
            ".venv/lib/.env.local",
            ".cache/x/.env.local",
            "packages/web/.next/.env.local",
            "packages/web/.env.local",
        ]);
        let report = copy_included(&src, &dst, &["**/.env.local".into()]);
        assert_eq!(
            report.copied,
            vec!["packages/web/.env.local", "src/.env.local"],
            "{report:?}"
        );
        assert!(!dst.join("target").exists() && !dst.join(".venv").exists());
    }

    #[test]
    fn a_probe_is_conclusive_only_when_git_finished_it() {
        use crate::modules::git::types::GitOutput;
        let output = |exit_code, timed_out, truncated| GitOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            exit_code,
            timed_out,
            truncated,
        };
        assert!(probe_conclusive(&output(Some(0), false, false)));
        assert!(!probe_conclusive(&output(Some(1), false, false)));
        assert!(!probe_conclusive(&output(None, false, false)));
        assert!(!probe_conclusive(&output(Some(0), true, false)));
        assert!(!probe_conclusive(&output(Some(0), false, true)));
    }

    #[test]
    fn project_slug_is_stable_readable_and_distinguishes_same_named_repos() {
        let a = default_location_slug(Path::new("/work/one/My App"));
        let b = default_location_slug(Path::new("/work/two/My App"));
        assert!(a.starts_with("my-app-"));
        assert_ne!(a, b);
        assert_eq!(a, default_location_slug(Path::new("/work/one/My App")));
    }

    #[test]
    fn claimed_directories_never_collide() {
        let dir = tempfile::tempdir().unwrap();
        let first = claim_directory(dir.path(), "task").unwrap();
        let second = claim_directory(dir.path(), "task").unwrap();
        let third = claim_directory(dir.path(), "task").unwrap();
        assert_eq!(first.file_name().unwrap(), "task");
        assert_eq!(second.file_name().unwrap(), "task-2");
        assert_eq!(third.file_name().unwrap(), "task-3");
    }

    #[test]
    fn status_parsing_separates_changes_from_untracked_and_skips_rename_sources() {
        let bytes = b" M src/a.rs\0A  new.rs\0?? scratch.txt\0R  moved.rs\0old.rs\0 D gone.rs\0!! ignored\0UU both.rs\0";
        let (changed, untracked) = parse_status_v1(bytes);
        assert_eq!(untracked, 1);
        let paths: Vec<_> = changed
            .iter()
            .map(|c| (c.path.as_str(), c.status))
            .collect();
        assert_eq!(
            paths,
            vec![
                ("src/a.rs", FileStatus::Modified),
                ("new.rs", FileStatus::Added),
                ("moved.rs", FileStatus::Renamed),
                ("gone.rs", FileStatus::Deleted),
                ("both.rs", FileStatus::Unmerged),
            ]
        );
    }

    #[test]
    fn copying_respects_confinement_and_never_overwrites() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let src_root = std::fs::canonicalize(src.path()).unwrap();
        let dst_root = std::fs::canonicalize(dst.path()).unwrap();
        std::fs::write(src_root.join(".env"), "SECRET=1\n").unwrap();
        std::fs::create_dir_all(src_root.join("apps/web")).unwrap();
        std::fs::write(src_root.join("apps/web/.env.local"), "A=1").unwrap();
        std::fs::create_dir_all(src_root.join("node_modules/x")).unwrap();
        std::fs::write(src_root.join("node_modules/x/.env.local"), "skip me").unwrap();
        std::fs::write(dst_root.join("keep.txt"), "mine").unwrap();
        std::fs::write(src_root.join("keep.txt"), "theirs").unwrap();
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("stolen"), "x").unwrap();
            std::os::unix::fs::symlink(outside.path().join("stolen"), src_root.join("link"))
                .unwrap();
            std::os::unix::fs::symlink(outside.path(), src_root.join("dir-link")).unwrap();
            let report = copy_included(
                &src_root,
                &dst_root,
                &["link".into(), "dir-link/stolen".into()],
            );
            assert!(report.copied.is_empty());
            let reasons: Vec<_> = report.skipped.iter().map(|s| s.reason.as_str()).collect();
            assert_eq!(reasons, vec!["outside-repository", "symlink"]);
            assert!(!dst_root.join("stolen").exists());
        }
        let report = copy_included(
            &src_root,
            &dst_root,
            &[
                ".env".into(),
                "**/.env.local".into(),
                "keep.txt".into(),
                "missing".into(),
            ],
        );
        assert_eq!(report.copied, vec![".env", "apps/web/.env.local"]);
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.skipped[0].reason, "already-exists");
        assert_eq!(
            std::fs::read_to_string(dst_root.join("keep.txt")).unwrap(),
            "mine"
        );
        assert_eq!(
            std::fs::read_to_string(dst_root.join(".env")).unwrap(),
            "SECRET=1\n"
        );
        assert!(!dst_root.join("node_modules").exists());
    }
}
