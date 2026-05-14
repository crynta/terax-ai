use std::ffi::OsStr;
use std::path::Path;

use crate::modules::git::parser::{parse_branch_header, parse_changed_files};
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_show_text, git_stdout_line, git_stdout_line_opt,
    read_text_file, run_git, run_git_os,
};
use crate::modules::git::types::{
    GitCommitResult, GitDiffContentResult, GitDiffResult, GitPushResult, GitRepoInfo,
    GitStatusSnapshot, TextSource, DEFAULT_TIMEOUT_SECS,
};
use crate::modules::git::utils::{canonical_dir, display_path, split_upstream};

pub fn resolve_repo(cwd: &str) -> Result<Option<GitRepoInfo>, String> {
    let cwd = canonical_dir(cwd)?;
    repo_info_from_cwd(&cwd)
}

pub fn status(repo_root: &str) -> Result<GitStatusSnapshot, String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;
    let output = run_git(
        Some(&repo_root),
        [
            "status",
            "--porcelain=v1",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git status failed")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let fields: Vec<&str> = stdout.split('\0').filter(|s| !s.is_empty()).collect();
    if fields.is_empty() {
        return Err("git status returned no data".into());
    }

    let (branch, upstream, ahead, behind, is_detached) = parse_branch_header(fields[0])?;

    Ok(GitStatusSnapshot {
        repo_root: display_path(&repo_root),
        branch,
        upstream,
        ahead,
        behind,
        is_detached,
        changed_files: parse_changed_files(&fields),
    })
}

pub fn diff(repo_root: &str, path: Option<&str>, staged: bool) -> Result<GitDiffResult, String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;

    let mut args: Vec<&str> = vec!["diff", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    if let Some(path) = path.filter(|p| !p.is_empty()) {
        args.extend(["--", path]);
    }

    let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git diff failed")?;

    Ok(GitDiffResult {
        diff_text: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}

pub fn diff_content(repo_root: &str, path: &str, staged: bool) -> Result<GitDiffContentResult, String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;
    let path_ref = Path::new(path);
    let worktree_path = repo_root.join(path_ref);

    let original = if staged {
        git_show_text(&repo_root, &format!("HEAD:{path}"))?
    } else {
        git_show_text(&repo_root, &format!(":{path}"))?
    };
    let modified = if staged {
        git_show_text(&repo_root, &format!(":{path}"))?
    } else {
        read_text_file(&worktree_path)?
    };
    let patch = diff(&display_path(&repo_root), Some(path), staged)?.diff_text;
    let is_binary = matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch,
    })
}

pub fn stage(repo_root: &str, paths: &[String]) -> Result<(), String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;
    run_git_paths(&repo_root, "add", paths)
}

pub fn unstage(repo_root: &str, paths: &[String]) -> Result<(), String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;
    let mut args: Vec<&OsStr> = vec![OsStr::new("reset"), OsStr::new("HEAD"), OsStr::new("--")];
    for path in paths {
        args.push(OsStr::new(path));
    }
    let output = run_git_os(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git reset failed")
}

pub fn commit(repo_root: &str, message: &str) -> Result<GitCommitResult, String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message cannot be empty".into());
    }

    let output = run_git_os(
        Some(&repo_root),
        [OsStr::new("commit"), OsStr::new("-m"), OsStr::new(trimmed)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git commit failed")?;

    let sha = git_stdout_line(
        &repo_root,
        ["rev-parse", "HEAD"],
        "failed to resolve commit sha",
    )?;
    let summary = git_stdout_line(
        &repo_root,
        ["show", "-s", "--format=%s", "HEAD"],
        "failed to read commit summary",
    )?;

    Ok(GitCommitResult {
        commit_sha: sha,
        summary,
    })
}

pub fn push(repo_root: &str) -> Result<GitPushResult, String> {
    let repo_root = canonical_dir(repo_root)?;
    ensure_git_available()?;
    let output = run_git(Some(&repo_root), ["push"], DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git push failed")?;

    let upstream = git_stdout_line(
        &repo_root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        "failed to resolve upstream",
    )?;
    let (remote, branch) = split_upstream(&upstream);

    Ok(GitPushResult {
        remote,
        branch,
        pushed: true,
    })
}

fn repo_info_from_cwd(cwd: &Path) -> Result<Option<GitRepoInfo>, String> {
    ensure_git_available()?;
    let root = match git_stdout_line_opt(cwd, ["rev-parse", "--show-toplevel"])? {
        Some(root) => root,
        None => return Ok(None),
    };
    let repo_root = canonical_dir(&root)?;
    let head = git_stdout_line(
        &repo_root,
        ["rev-parse", "--abbrev-ref", "HEAD"],
        "failed to resolve HEAD",
    )?;
    let upstream = git_stdout_line_opt(
        &repo_root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;

    Ok(Some(GitRepoInfo {
        repo_root: display_path(&repo_root),
        branch: head.clone(),
        upstream,
        is_detached: head == "HEAD",
    }))
}

fn run_git_paths(repo_root: &Path, command: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&OsStr> = vec![OsStr::new(command), OsStr::new("--")];
    for path in paths {
        args.push(OsStr::new(path));
    }
    let output = run_git_os(Some(repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, &format!("git {command} failed"))
}
