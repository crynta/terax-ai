use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::parse_porcelain_v2;
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_show_text, git_stdout_line_opt, git_stdout_lines,
    read_text_file, run_git,
};
use crate::modules::git::types::{
    DiscardEntry, GitCommitFileChange, GitCommitResult, GitDiffContentResult, GitDiffResult,
    GitLogEntry, GitOutput, GitPanelSnapshot, GitPushResult, GitRepoInfo, GitStatusSnapshot,
    TextSource, DEFAULT_TIMEOUT_SECS, NETWORK_TIMEOUT_SECS,
};
use crate::modules::git::utils::{
    authorized_repo_root, canonical_dir, display_path, resolve_within_repo, split_upstream,
};
use crate::modules::workspace::WorkspaceRegistry;

pub fn resolve_repo(registry: &WorkspaceRegistry, cwd: &str) -> Result<Option<GitRepoInfo>> {
    let cwd = canonical_dir(cwd)?;
    if !registry.is_authorized(&cwd) {
        return Err(GitError::PathOutsideWorkspace(cwd));
    }
    ensure_git_available()?;
    resolve_repo_in_authorized(registry, &cwd)
}

fn resolve_repo_in_authorized(
    registry: &WorkspaceRegistry,
    cwd: &Path,
) -> Result<Option<GitRepoInfo>> {
    let Some(root_line) = git_stdout_line_opt(cwd, ["rev-parse", "--show-toplevel"])? else {
        return Ok(None);
    };
    let canonical_root = canonical_dir(&root_line)?;
    let _ = registry.authorize(&canonical_root);

    let basics = git_stdout_lines(
        &canonical_root,
        ["rev-parse", "--abbrev-ref", "HEAD"],
    )?;
    let head = basics
        .into_iter()
        .next()
        .ok_or(GitError::CommandFailed {
            context: "failed to resolve HEAD",
            detail: String::new(),
        })?;

    let upstream = git_stdout_line_opt(
        &canonical_root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;

    Ok(Some(GitRepoInfo {
        repo_root: display_path(&canonical_root),
        branch: head.clone(),
        upstream,
        is_detached: head == "HEAD",
    }))
}

pub fn panel_snapshot(registry: &WorkspaceRegistry, cwd: &str) -> Result<GitPanelSnapshot> {
    let cwd = canonical_dir(cwd)?;
    if !registry.is_authorized(&cwd) {
        return Err(GitError::PathOutsideWorkspace(cwd));
    }
    ensure_git_available()?;
    let Some(root_line) = git_stdout_line_opt(&cwd, ["rev-parse", "--show-toplevel"])? else {
        return Ok(GitPanelSnapshot {
            repo: None,
            status: None,
        });
    };
    let canonical_root = canonical_dir(&root_line)?;
    let _ = registry.authorize(&canonical_root);

    let status = status_inner(&canonical_root)?;
    let repo = GitRepoInfo {
        repo_root: display_path(&canonical_root),
        branch: status.branch.clone(),
        upstream: status.upstream.clone(),
        is_detached: status.is_detached,
    };
    Ok(GitPanelSnapshot {
        repo: Some(repo),
        status: Some(status),
    })
}

pub fn status(registry: &WorkspaceRegistry, repo_root: &str) -> Result<GitStatusSnapshot> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    status_inner(&repo_root)
}

fn status_inner(repo_root: &Path) -> Result<GitStatusSnapshot> {
    let output = run_git(
        Some(repo_root),
        [
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git status failed")?;

    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let parsed = parse_porcelain_v2(stdout);

    Ok(GitStatusSnapshot {
        repo_root: display_path(repo_root),
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        is_detached: parsed.is_detached,
        truncated: output.truncated,
        changed_files: parsed.files,
    })
}

pub fn diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: Option<&str>,
    staged: bool,
) -> Result<GitDiffResult> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    diff_inner(&repo_root, path, staged)
}

fn diff_inner(repo_root: &Path, path: Option<&str>, staged: bool) -> Result<GitDiffResult> {
    let mut args: Vec<&OsStr> = vec![OsStr::new("diff"), OsStr::new("--no-ext-diff")];
    if staged {
        args.push(OsStr::new("--cached"));
    }
    let resolved_path = match path.filter(|p| !p.is_empty()) {
        Some(p) => Some(resolve_within_repo(repo_root, p)?),
        None => None,
    };
    if let Some(p) = resolved_path.as_ref() {
        args.push(OsStr::new("--"));
        args.push(p.as_os_str());
    }
    let output = run_git(Some(repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git diff failed")?;

    let diff_text = match String::from_utf8(output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };
    Ok(GitDiffResult {
        diff_text,
        truncated: output.truncated,
    })
}

pub fn diff_content(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    staged: bool,
    original_path: Option<&str>,
) -> Result<GitDiffContentResult> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let worktree_path = resolve_within_repo(&repo_root, path)?;
    let rel_path = pathspec(&repo_root, &worktree_path);

    let original_rel = match original_path {
        Some(orig) if !orig.is_empty() => {
            let resolved = resolve_within_repo(&repo_root, orig)?;
            Some(pathspec(&repo_root, &resolved))
        }
        _ => None,
    };

    let original = if staged {
        let spec = original_rel.as_deref().unwrap_or(&rel_path);
        git_show_text(&repo_root, &format!("HEAD:{spec}"))?
    } else {
        git_show_text(&repo_root, &format!(":{rel_path}"))?
    };
    let modified = if staged {
        git_show_text(&repo_root, &format!(":{rel_path}"))?
    } else {
        read_text_file(&worktree_path)?
    };
    let patch = diff_inner(&repo_root, Some(&rel_path), staged)?;
    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch.diff_text,
        truncated: patch.truncated,
    })
}

pub fn stage(registry: &WorkspaceRegistry, repo_root: &str, paths: &[String]) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if paths.is_empty() {
        return Ok(());
    }
    let resolved = resolve_paths(&repo_root, paths)?;
    let mut args: Vec<&OsStr> = vec![OsStr::new("add"), OsStr::new("--")];
    for p in &resolved {
        args.push(p.as_os_str());
    }
    let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git add failed")
}

pub fn unstage(registry: &WorkspaceRegistry, repo_root: &str, paths: &[String]) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if paths.is_empty() {
        return Ok(());
    }
    let resolved = resolve_paths(&repo_root, paths)?;
    let has_head = git_stdout_line_opt(&repo_root, ["rev-parse", "--verify", "HEAD"])?.is_some();
    let mut args: Vec<&OsStr> = if has_head {
        vec![OsStr::new("reset"), OsStr::new("HEAD"), OsStr::new("--")]
    } else {
        vec![
            OsStr::new("rm"),
            OsStr::new("--cached"),
            OsStr::new("-r"),
            OsStr::new("--"),
        ]
    };
    for p in &resolved {
        args.push(p.as_os_str());
    }
    let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(
        &output,
        if has_head {
            "git reset failed"
        } else {
            "git rm --cached failed"
        },
    )
}

pub fn discard(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    entries: &[DiscardEntry],
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if entries.is_empty() {
        return Ok(());
    }

    let mut tracked: Vec<PathBuf> = Vec::with_capacity(entries.len());
    let mut untracked: Vec<PathBuf> = Vec::new();
    for entry in entries {
        let resolved = resolve_within_repo(&repo_root, &entry.path)?;
        if entry.untracked {
            untracked.push(resolved);
        } else {
            tracked.push(resolved);
        }
    }

    if !tracked.is_empty() {
        let mut args: Vec<&OsStr> = vec![
            OsStr::new("restore"),
            OsStr::new("--worktree"),
            OsStr::new("--"),
        ];
        for p in &tracked {
            args.push(p.as_os_str());
        }
        let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
        ensure_success(&output, "git restore failed")?;
    }

    if !untracked.is_empty() {
        let mut args: Vec<&OsStr> = vec![
            OsStr::new("clean"),
            OsStr::new("-f"),
            OsStr::new("-d"),
            OsStr::new("--"),
        ];
        for p in &untracked {
            args.push(p.as_os_str());
        }
        let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
        ensure_success(&output, "git clean failed")?;
    }

    Ok(())
}

pub fn commit(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    message: &str,
) -> Result<GitCommitResult> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(GitError::EmptyCommitMessage);
    }

    let output = run_git(
        Some(&repo_root),
        [OsStr::new("commit"), OsStr::new("-m"), OsStr::new(trimmed)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.exit_code != Some(0) && nothing_to_commit(&output) {
        return Err(GitError::command("git commit", "nothing staged"));
    }
    ensure_success(&output, "git commit failed")?;

    let combined = git_stdout_lines(
        &repo_root,
        ["show", "-s", "--format=%H%n%s", "HEAD"],
    )?;
    let sha = combined
        .first()
        .cloned()
        .ok_or(GitError::CommandFailed {
            context: "failed to resolve commit sha",
            detail: String::new(),
        })?;
    let summary = combined.get(1).cloned().unwrap_or_default();

    Ok(GitCommitResult {
        commit_sha: sha,
        summary,
    })
}

pub fn push(registry: &WorkspaceRegistry, repo_root: &str) -> Result<GitPushResult> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;

    let upstream = git_stdout_line_opt(
        &repo_root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;
    if upstream.is_none() {
        return Err(GitError::NoUpstream);
    }

    let output = run_git(Some(&repo_root), ["push"], NETWORK_TIMEOUT_SECS)?;
    ensure_success(&output, "git push failed")?;

    let upstream = upstream.unwrap();
    let (remote, branch) = split_upstream(&upstream);
    Ok(GitPushResult {
        remote,
        branch,
        pushed: true,
    })
}

const LOG_FORMAT: &str = "%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s";
const MAX_LOG_LIMIT: u32 = 200;

pub fn log(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    limit: u32,
    before_sha: Option<&str>,
) -> Result<Vec<GitLogEntry>> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let bounded = limit.clamp(1, MAX_LOG_LIMIT);
    let count_arg = format!("--max-count={bounded}");
    let format_arg = format!("--format={LOG_FORMAT}");
    let cursor = match before_sha {
        Some(sha) if !sha.is_empty() => {
            if !sha_is_safe(sha) {
                return Err(GitError::command("git log", "invalid cursor sha"));
            }
            Some(format!("{sha}^"))
        }
        _ => None,
    };
    let mut args: Vec<&OsStr> = vec![
        OsStr::new("log"),
        OsStr::new("--no-color"),
        OsStr::new("--shortstat"),
        OsStr::new(&count_arg),
        OsStr::new(&format_arg),
    ];
    if let Some(spec) = cursor.as_deref() {
        args.push(OsStr::new(spec));
    }
    let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    if output.timed_out {
        return Err(GitError::TimedOut("git log"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        if stderr.contains("does not have any commits yet")
            || stderr.contains("bad default revision")
            || stderr.contains("unknown revision")
            || stderr.contains("ambiguous argument 'head'")
        {
            return Ok(Vec::new());
        }
        return ensure_success(&output, "git log failed").map(|_| Vec::new());
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let mut entries: Vec<GitLogEntry> = Vec::with_capacity(bounded as usize);
    // Lines we get back interleave:
    //   <sha>\x1f<author>\x1f<email>\x1f<ts>\x1f<parents>\x1f<subject>
    //   <blank>
    //    5 files changed, 12 insertions(+), 3 deletions(-)
    // Commits without diffstats (root commits, merges with no changes) just
    // skip the shortstat line. Detect commit headers by the presence of
    // the unit-separator we put in the format.
    for raw_line in stdout.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if line.contains('\x1f') {
            let mut fields = line.splitn(6, '\x1f');
            let sha = fields.next().unwrap_or("").to_string();
            if !sha_is_safe(&sha) {
                continue;
            }
            let author = fields.next().unwrap_or("").to_string();
            let author_email = fields.next().unwrap_or("").to_string();
            let timestamp = fields.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
            let parents_raw = fields.next().unwrap_or("");
            let parents: Vec<String> = parents_raw
                .split_ascii_whitespace()
                .map(|s| s.to_string())
                .collect();
            let subject = fields.next().unwrap_or("").to_string();
            let short_sha = sha.chars().take(7).collect::<String>();
            entries.push(GitLogEntry {
                sha,
                short_sha,
                author,
                author_email,
                timestamp_secs: timestamp,
                parents,
                subject,
                files_changed: 0,
                insertions: 0,
                deletions: 0,
            });
            continue;
        }
        if let Some(current) = entries.last_mut() {
            if line.contains("file changed") || line.contains("files changed") {
                let (files, ins, del) = parse_shortstat(line);
                current.files_changed = files;
                current.insertions = ins;
                current.deletions = del;
            }
        }
    }
    Ok(entries)
}

pub fn show_commit_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
) -> Result<GitDiffResult> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git show", "invalid commit identifier"));
    }
    let output = run_git(
        Some(&repo_root),
        [
            OsStr::new("show"),
            OsStr::new("--no-color"),
            OsStr::new("--no-ext-diff"),
            OsStr::new("--patch-with-stat"),
            OsStr::new(sha),
            OsStr::new("--"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git show failed")?;
    let diff_text = match String::from_utf8(output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };
    Ok(GitDiffResult {
        diff_text,
        truncated: output.truncated,
    })
}

fn parse_shortstat(tail: &str) -> (u32, u32, u32) {
    // Looks for a line like " 5 files changed, 12 insertions(+), 3 deletions(-)"
    for line in tail.lines() {
        let trimmed = line.trim();
        if !(trimmed.contains("file changed") || trimmed.contains("files changed")) {
            continue;
        }
        let mut files = 0u32;
        let mut ins = 0u32;
        let mut del = 0u32;
        for part in trimmed.split(',') {
            let part = part.trim();
            let num_str = part.split_ascii_whitespace().next().unwrap_or("0");
            let n: u32 = num_str.parse().unwrap_or(0);
            if part.contains("file") {
                files = n;
            } else if part.contains("insertion") {
                ins = n;
            } else if part.contains("deletion") {
                del = n;
            }
        }
        return (files, ins, del);
    }
    (0, 0, 0)
}

fn sha_is_safe(sha: &str) -> bool {
    !sha.is_empty()
        && sha.len() <= 64
        && sha.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn commit_files(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
) -> Result<Vec<GitCommitFileChange>> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git diff-tree", "invalid commit sha"));
    }

    let output = run_git(
        Some(&repo_root),
        [
            OsStr::new("diff-tree"),
            OsStr::new("--no-commit-id"),
            OsStr::new("-r"),
            OsStr::new("-z"),
            OsStr::new("--name-status"),
            OsStr::new("--numstat"),
            OsStr::new(sha),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git diff-tree failed")?;

    let (name_status_bytes, numstat_bytes) = split_name_status_numstat(&output.stdout);
    let mut files = parse_diff_tree_name_status(name_status_bytes);
    apply_numstat(&mut files, numstat_bytes);
    Ok(files)
}

fn split_name_status_numstat(bytes: &[u8]) -> (&[u8], &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<(usize, &str)> = s
        .split('\0')
        .scan(0usize, |off, t| {
            let start = *off;
            *off += t.len() + 1;
            Some((start, t))
        })
        .collect();
    let mut split_at = bytes.len();
    for (idx, tok) in tokens.iter().enumerate() {
        if tok.1.contains('\t') {
            split_at = tok.0;
            // Walk back: numstat for R/C with -z emits "<a>\t<r>" then two
            // NUL-separated paths. The two trailing path tokens belong to the
            // numstat block, not name-status.
            let _ = idx;
            break;
        }
    }
    (&bytes[..split_at], &bytes[split_at..])
}

pub fn commit_file_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    path: &str,
    original_path: Option<&str>,
) -> Result<GitDiffContentResult> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git show", "invalid commit sha"));
    }
    let resolved = resolve_within_repo(&repo_root, path)?;
    let rel = resolved
        .strip_prefix(&repo_root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"));

    let original_rel = match original_path {
        Some(orig) if !orig.is_empty() => {
            let resolved_orig = resolve_within_repo(&repo_root, orig)?;
            resolved_orig
                .strip_prefix(&repo_root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| orig.replace('\\', "/"))
        }
        _ => rel.clone(),
    };

    let parent = git_stdout_line_opt(&repo_root, ["rev-parse", &format!("{sha}^")])?;
    let original = match parent.as_deref() {
        Some(p) => git_show_text(&repo_root, &format!("{p}:{original_rel}"))?,
        None => TextSource::Missing,
    };
    let modified = git_show_text(&repo_root, &format!("{sha}:{rel}"))?;

    let mut diff_args: Vec<&OsStr> = vec![
        OsStr::new("show"),
        OsStr::new("--no-color"),
        OsStr::new("--no-ext-diff"),
        OsStr::new("--format="),
        OsStr::new("-m"),
        OsStr::new("--first-parent"),
        OsStr::new(sha),
        OsStr::new("--"),
    ];
    let modified_path_os = rel.clone();
    diff_args.push(OsStr::new(&modified_path_os));
    let original_path_os;
    if original_rel != rel {
        original_path_os = original_rel.clone();
        diff_args.push(OsStr::new(&original_path_os));
    }
    let patch_output = run_git(Some(&repo_root), diff_args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&patch_output, "git show <commit> -- <path> failed")?;
    let patch_text = match String::from_utf8(patch_output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };

    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch_text,
        truncated: patch_output.truncated,
    })
}

pub fn remote_url(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
) -> Result<Option<String>> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    if name.is_empty() || name.len() > 64 || !name.chars().all(is_remote_name_char) {
        return Ok(None);
    }
    git_stdout_line_opt(
        &repo_root,
        ["config", "--get", &format!("remote.{name}.url")],
    )
}

fn is_remote_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'
}

fn parse_diff_tree_name_status(bytes: &[u8]) -> Vec<GitCommitFileChange> {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let mut tokens = s.split('\0').filter(|t| !t.is_empty());
    let mut files: Vec<GitCommitFileChange> = Vec::new();
    while let Some(status_tok) = tokens.next() {
        let status_char = status_tok.chars().next().unwrap_or(' ');
        if status_char == 'R' || status_char == 'C' {
            let original = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            let new_path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path: new_path,
                original_path: Some(original),
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        } else {
            let path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path,
                original_path: None,
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        }
    }
    files
}

fn apply_numstat(files: &mut [GitCommitFileChange], bytes: &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<&str> = s.split('\0').filter(|t| !t.is_empty()).collect();
    let mut idx = 0;
    while idx < tokens.len() {
        let header = tokens[idx];
        idx += 1;
        let mut cols = header.splitn(3, '\t');
        let added_raw = cols.next().unwrap_or("0");
        let removed_raw = cols.next().unwrap_or("0");
        let inline_path = cols.next().unwrap_or("");
        let is_binary = added_raw == "-" && removed_raw == "-";
        let added: u32 = if is_binary { 0 } else { added_raw.parse().unwrap_or(0) };
        let removed: u32 = if is_binary { 0 } else { removed_raw.parse().unwrap_or(0) };

        let (path, original) = if inline_path.is_empty() {
            let original = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            let new_path = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            (new_path, Some(original))
        } else {
            (inline_path.to_string(), None)
        };

        if path.is_empty() {
            continue;
        }
        if let Some(file) = files.iter_mut().find(|f| f.path == path) {
            file.added = added;
            file.removed = removed;
            file.is_binary = is_binary;
            if file.original_path.is_none() {
                if let Some(orig) = original {
                    if !orig.is_empty() && orig != file.path {
                        file.original_path = Some(orig);
                    }
                }
            }
        }
    }
}

fn status_label_for(c: char) -> String {
    match c {
        'A' => "Added".into(),
        'M' => "Modified".into(),
        'D' => "Deleted".into(),
        'R' => "Renamed".into(),
        'C' => "Copied".into(),
        'T' => "Type changed".into(),
        'U' => "Unmerged".into(),
        _ => format!("Status {c}"),
    }
}

pub fn fetch(registry: &WorkspaceRegistry, repo_root: &str) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let output = run_git(Some(&repo_root), ["fetch", "--prune"], NETWORK_TIMEOUT_SECS)?;
    ensure_success(&output, "git fetch failed")
}

pub fn pull_ff_only(registry: &WorkspaceRegistry, repo_root: &str) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root)?;
    ensure_git_available()?;
    let output = run_git(Some(&repo_root), ["pull", "--ff-only"], NETWORK_TIMEOUT_SECS)?;
    ensure_success(&output, "git pull --ff-only failed")
}

fn nothing_to_commit(output: &GitOutput) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    stderr.contains("nothing to commit") || stdout.contains("nothing to commit")
}

fn resolve_paths(repo_root: &Path, paths: &[String]) -> Result<Vec<PathBuf>> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        out.push(resolve_within_repo(repo_root, p)?);
    }
    Ok(out)
}

fn pathspec(repo_root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(repo_root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| absolute.to_string_lossy().replace('\\', "/"))
}
