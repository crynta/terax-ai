//! Review-view backend: diff scopes, per-file summaries and structured hunks,
//! and per-hunk stage / unstage / revert. The parsing and patch building live
//! in `diff.rs` and `patch.rs`; this file only decides which git commands to run
//! and enforces the caps and the refusals.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::modules::git::checkpoint;
use crate::modules::git::diff::{
    self, count_lines, looks_binary, parse_raw_numstat_z, parse_unified, DiffFileSummary, DiffHunk,
    DiffTotals, FileStatus, LineKind, ParsedFileDiff,
};
use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::patch::{build_patch, Anchor, HunkPick, PatchError};
use crate::modules::git::plumbing::{
    empty_tree, head_commit_opt, lock_for, open_worktree, os_args, relative_spec, resolve_commit,
    resolve_commit_opt, run, run_ok, stdout_text, verify_tree,
};
use crate::modules::git::process::{
    decode_text, ensure_success, run_git_capped, run_git_with, RunOptions,
};
use crate::modules::git::types::{GitOutput, TextSource, DEFAULT_TIMEOUT_SECS, MAX_OUTPUT_BYTES};
use crate::modules::git::utils::ResolvedGitDirectory;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

const SUMMARY_CAP_BYTES: usize = 4 * 1024 * 1024;
const PATCH_CAP_BYTES: usize = MAX_OUTPUT_BYTES;
const CONTENT_CAP_BYTES: u64 = 1024 * 1024;
const UNTRACKED_LIST_CAP_BYTES: usize = 1024 * 1024;
const MAX_UNTRACKED_FILES: usize = 2000;
const UNTRACKED_COUNT_FILES: usize = 300;
const UNTRACKED_COUNT_FILE_MAX: u64 = 1024 * 1024;
const UNTRACKED_COUNT_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
/// Lines of one file's diff sent over IPC (each costs about 100 bytes of JSON),
/// for synthesized and git-produced diffs alike.
const MAX_DIFF_LINES: usize = 20_000;
const MAX_SYNTH_LINES: usize = MAX_DIFF_LINES;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CheckpointEndpoint {
    Ref {
        name: String,
    },
    /// The working tree. Without `tree` it is snapshotted now; passing the
    /// `tree` an earlier summary returned pins that snapshot, so every file
    /// diff of one review view agrees with its summary and none of them walks
    /// the whole tree again.
    Worktree {
        #[serde(default)]
        tree: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitDiffScope {
    /// HEAD to the working tree, staged and unstaged together, plus untracked.
    Uncommitted,
    /// HEAD to the index.
    Staged,
    /// The index to the working tree, plus untracked.
    Unstaged,
    /// `merge-base(base, head)` to `head`, like `base...head`.
    Range { base: String, head: String },
    /// A commit against its first parent (or the empty tree for a root commit).
    Commit { sha: String },
    /// Two checkpoints, or a checkpoint and the working tree as it is now.
    Checkpoint {
        from: CheckpointEndpoint,
        to: CheckpointEndpoint,
    },
}

/// One side of a diff, as the content fetcher needs to read it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffSide {
    Rev {
        id: String,
    },
    Index,
    /// The working tree. `tree` is set when the side was frozen into a tree
    /// object for this request (checkpoint scopes), `None` when it is live.
    Worktree {
        #[serde(skip_serializing_if = "Option::is_none")]
        tree: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct ResolvedScope {
    pub diff_args: Vec<OsString>,
    pub from: DiffSide,
    pub to: DiffSide,
    pub untracked: bool,
    pub merge_base: Option<String>,
}

pub fn resolve_scope(repo: &ResolvedGitDirectory, scope: &GitDiffScope) -> Result<ResolvedScope> {
    let rev = |id: String| DiffSide::Rev { id };
    match scope {
        GitDiffScope::Uncommitted => {
            let base = head_or_empty(repo)?;
            Ok(ResolvedScope {
                diff_args: os_args([base.as_str()]),
                from: rev(base),
                to: DiffSide::Worktree { tree: None },
                untracked: true,
                merge_base: None,
            })
        }
        GitDiffScope::Staged => {
            let base = head_or_empty(repo)?;
            Ok(ResolvedScope {
                diff_args: os_args(["--cached", base.as_str()]),
                from: rev(base),
                to: DiffSide::Index,
                untracked: false,
                merge_base: None,
            })
        }
        GitDiffScope::Unstaged => Ok(ResolvedScope {
            diff_args: Vec::new(),
            from: DiffSide::Index,
            to: DiffSide::Worktree { tree: None },
            untracked: true,
            merge_base: None,
        }),
        GitDiffScope::Range { base, head } => {
            let base_id = resolve_commit(repo, base)?;
            let head_id = resolve_commit(repo, head)?;
            let mb = merge_base_of(repo, &base_id, &head_id)?.ok_or_else(|| {
                GitError::command(
                    "git merge-base",
                    format!("{base} and {head} share no history"),
                )
            })?;
            Ok(ResolvedScope {
                diff_args: os_args([mb.as_str(), head_id.as_str()]),
                from: rev(mb.clone()),
                to: rev(head_id),
                untracked: false,
                merge_base: Some(mb),
            })
        }
        GitDiffScope::Commit { sha } => {
            let id = resolve_commit(repo, sha)?;
            let parent = resolve_commit_opt(repo, &format!("{id}^1"))?;
            let base = match parent {
                Some(parent) => parent,
                None => empty_tree(repo)?,
            };
            Ok(ResolvedScope {
                diff_args: os_args([base.as_str(), id.as_str()]),
                from: rev(base),
                to: rev(id),
                untracked: false,
                merge_base: None,
            })
        }
        GitDiffScope::Checkpoint { from, to } => {
            if matches!(from, CheckpointEndpoint::Worktree { .. })
                && matches!(to, CheckpointEndpoint::Worktree { .. })
            {
                return Err(GitError::command(
                    "git diff",
                    "both ends of the checkpoint range are the working tree",
                ));
            }
            let (from_arg, from_side) = resolve_endpoint(repo, from)?;
            let (to_arg, to_side) = resolve_endpoint(repo, to)?;
            Ok(ResolvedScope {
                diff_args: os_args([from_arg.as_str(), to_arg.as_str()]),
                from: from_side,
                to: to_side,
                untracked: false,
                merge_base: None,
            })
        }
    }
}

fn resolve_endpoint(
    repo: &ResolvedGitDirectory,
    endpoint: &CheckpointEndpoint,
) -> Result<(String, DiffSide)> {
    match endpoint {
        CheckpointEndpoint::Ref { name } => {
            let id = resolve_commit(repo, name)?;
            Ok((id.clone(), DiffSide::Rev { id }))
        }
        CheckpointEndpoint::Worktree { tree } => {
            let tree = match tree {
                Some(pinned) => {
                    verify_tree(repo, pinned)?;
                    pinned.clone()
                }
                None => checkpoint::snapshot_tree(repo, false)?.tree,
            };
            Ok((tree.clone(), DiffSide::Worktree { tree: Some(tree) }))
        }
    }
}

fn head_or_empty(repo: &ResolvedGitDirectory) -> Result<String> {
    match head_commit_opt(repo)? {
        Some(head) => Ok(head),
        None => empty_tree(repo),
    }
}

fn merge_base_of(repo: &ResolvedGitDirectory, a: &str, b: &str) -> Result<Option<String>> {
    let output = run(repo, os_args(["merge-base", a, b]))?;
    if output.timed_out {
        return Err(GitError::TimedOut("git merge-base"));
    }
    match output.exit_code {
        Some(0) => {
            let id = stdout_text(&output);
            Ok((!id.is_empty()).then_some(id))
        }
        Some(1) => Ok(None),
        _ => {
            ensure_success(&output, "git merge-base failed")?;
            Ok(None)
        }
    }
}

pub fn merge_base(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    a: &str,
    b: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<String>> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    let a = resolve_commit(&repo, a)?;
    let b = resolve_commit(&repo, b)?;
    merge_base_of(&repo, &a, &b)
}

fn diff_command(flags: &[&str], scope: &ResolvedScope, pathspecs: &[String]) -> Vec<OsString> {
    let mut args = os_args([
        "--literal-pathspecs",
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=dirty",
        "--submodule=short",
        "-M",
    ]);
    args.extend(os_args(flags));
    args.extend(scope.diff_args.iter().cloned());
    args.push("--".into());
    args.extend(os_args(pathspecs));
    args
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffSummary {
    pub files: Vec<DiffFileSummary>,
    pub totals: DiffTotals,
    /// The tracked listing hit its output cap; files past it are missing.
    pub truncated: bool,
    /// More untracked files exist than are listed.
    pub untracked_truncated: bool,
    pub from: DiffSide,
    pub to: DiffSide,
    pub merge_base: Option<String>,
}

pub fn diff_summary(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    scope: &GitDiffScope,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffSummary> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    let resolved = resolve_scope(&repo, scope)?;
    let (mut files, truncated) = tracked_summary(&repo, &resolved, &[])?;

    let mut untracked_truncated = false;
    if resolved.untracked {
        let (paths, cut) = list_untracked(&repo)?;
        untracked_truncated = cut;
        files.extend(summarize_untracked(&repo, &paths));
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let totals = diff::totals(&files);
    Ok(GitDiffSummary {
        files,
        totals,
        truncated,
        untracked_truncated,
        from: resolved.from,
        to: resolved.to,
        merge_base: resolved.merge_base,
    })
}

fn tracked_summary(
    repo: &ResolvedGitDirectory,
    scope: &ResolvedScope,
    pathspecs: &[String],
) -> Result<(Vec<DiffFileSummary>, bool)> {
    let output = run_git_capped(
        &repo.workspace,
        Some(&repo.git_path),
        diff_command(&["--raw", "--numstat", "-z"], scope, pathspecs),
        DEFAULT_TIMEOUT_SECS,
        SUMMARY_CAP_BYTES,
    )?;
    if !output.truncated {
        ensure_success(&output, "git diff failed")?;
    } else if output.timed_out {
        return Err(GitError::TimedOut("git diff"));
    }
    let mut files = parse_raw_numstat_z(&output.stdout);
    if output.truncated {
        files.pop();
    }
    Ok((files, output.truncated))
}

/// Untracked, non-ignored files from the top-level, and whether the list was cut.
fn list_untracked(repo: &ResolvedGitDirectory) -> Result<(Vec<String>, bool)> {
    let output = run_git_capped(
        &repo.workspace,
        Some(&repo.git_path),
        os_args(["ls-files", "--others", "--exclude-standard", "-z"]),
        DEFAULT_TIMEOUT_SECS,
        UNTRACKED_LIST_CAP_BYTES,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git ls-files"));
    }
    let mut paths: Vec<String> = output
        .stdout
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect();
    let mut truncated = output.truncated;
    if truncated {
        paths.pop();
    }
    if paths.len() > MAX_UNTRACKED_FILES {
        paths.truncate(MAX_UNTRACKED_FILES);
        truncated = true;
    }
    Ok((paths, truncated))
}

enum UntrackedRead {
    Missing,
    Directory,
    Symlink(String),
    Large,
    Binary,
    Text(Vec<u8>),
}

fn read_untracked(local_root: &Path, rel: &str, max: u64) -> UntrackedRead {
    let path = local_root.join(rel.trim_end_matches('/'));
    let Ok(meta) = std::fs::symlink_metadata(&path) else {
        return UntrackedRead::Missing;
    };
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&path)
            .map(|t| t.to_string_lossy().into_owned())
            .unwrap_or_default();
        return UntrackedRead::Symlink(target);
    }
    if meta.is_dir() {
        return UntrackedRead::Directory;
    }
    if !meta.is_file() {
        return UntrackedRead::Missing;
    }
    if meta.len() > max {
        // Still sniff the head so a huge binary is reported as binary.
        if let Ok(mut file) = std::fs::File::open(&path) {
            use std::io::Read;
            let mut head = vec![0u8; diff::BINARY_SNIFF_BYTES];
            if let Ok(n) = file.read(&mut head) {
                if looks_binary(&head[..n]) {
                    return UntrackedRead::Binary;
                }
            }
        }
        return UntrackedRead::Large;
    }
    match std::fs::read(&path) {
        Ok(bytes) if looks_binary(&bytes) => UntrackedRead::Binary,
        Ok(bytes) => UntrackedRead::Text(bytes),
        Err(_) => UntrackedRead::Missing,
    }
}

fn untracked_entry(path: &str) -> DiffFileSummary {
    DiffFileSummary {
        path: path.to_string(),
        old_path: None,
        status: FileStatus::Untracked,
        added: 0,
        removed: 0,
        binary: false,
        submodule: false,
        symlink: false,
        approximate: false,
    }
}

fn summarize_untracked(repo: &ResolvedGitDirectory, paths: &[String]) -> Vec<DiffFileSummary> {
    let mut budget = UNTRACKED_COUNT_TOTAL_BYTES;
    let mut counted = 0usize;
    paths
        .iter()
        .map(|path| {
            let mut entry = untracked_entry(path);
            if counted >= UNTRACKED_COUNT_FILES || budget == 0 {
                entry.approximate = true;
                return entry;
            }
            match read_untracked(&repo.local_path, path, UNTRACKED_COUNT_FILE_MAX.min(budget)) {
                UntrackedRead::Text(bytes) => {
                    counted += 1;
                    budget = budget.saturating_sub(bytes.len() as u64);
                    entry.added = count_lines(&bytes);
                }
                UntrackedRead::Binary => entry.binary = true,
                UntrackedRead::Symlink(_) => {
                    entry.symlink = true;
                    entry.added = 1;
                }
                UntrackedRead::Directory | UntrackedRead::Large => entry.approximate = true,
                UntrackedRead::Missing => entry.approximate = true,
            }
            entry
        })
        .collect()
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContentsOmitted {
    TooLarge,
    Binary,
    Submodule,
    Disabled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    pub original: String,
    pub modified: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    /// The file has no changes in this scope (a stale view asked for it).
    pub unchanged: bool,
    pub binary: bool,
    pub submodule: bool,
    pub symlink: bool,
    pub added: u32,
    pub removed: u32,
    pub hunks: Vec<DiffHunk>,
    pub fingerprint: String,
    /// The patch exceeded its cap: `hunks` holds only the complete leading
    /// hunks, `added` / `removed` still carry git's exact totals.
    pub truncated: bool,
    pub contents: Option<FileContents>,
    pub contents_omitted: Option<ContentsOmitted>,
    pub from: DiffSide,
    pub to: DiffSide,
}

enum SideContent {
    Missing,
    Binary,
    TooLarge,
    Text(String),
}

fn read_rev_side(repo: &ResolvedGitDirectory, spec: &str) -> Result<SideContent> {
    let size = run(repo, os_args(["cat-file", "-s", spec]))?;
    if size.timed_out {
        return Err(GitError::TimedOut("git cat-file"));
    }
    if size.exit_code != Some(0) {
        return Ok(SideContent::Missing);
    }
    let bytes: u64 = stdout_text(&size).parse().unwrap_or(0);
    if bytes > CONTENT_CAP_BYTES {
        return Ok(SideContent::TooLarge);
    }
    let blob = run(repo, os_args(["cat-file", "blob", spec]))?;
    if blob.exit_code != Some(0) || blob.truncated {
        return Ok(SideContent::Missing);
    }
    Ok(match decode_text(blob.stdout) {
        TextSource::Text(text) => SideContent::Text(text),
        TextSource::Binary => SideContent::Binary,
        TextSource::Missing => SideContent::Missing,
    })
}

fn read_side(repo: &ResolvedGitDirectory, side: &DiffSide, path: &str) -> Result<SideContent> {
    match side {
        DiffSide::Rev { id } => read_rev_side(repo, &format!("{id}:{path}")),
        DiffSide::Index => read_rev_side(repo, &format!(":{path}")),
        DiffSide::Worktree { tree: Some(id) } => read_rev_side(repo, &format!("{id}:{path}")),
        DiffSide::Worktree { tree: None } => Ok(
            match read_untracked(&repo.local_path, path, CONTENT_CAP_BYTES) {
                UntrackedRead::Text(bytes) => match decode_text(bytes) {
                    TextSource::Text(text) => SideContent::Text(text),
                    _ => SideContent::Missing,
                },
                UntrackedRead::Symlink(target) => SideContent::Text(target),
                UntrackedRead::Large => SideContent::TooLarge,
                UntrackedRead::Binary => SideContent::Binary,
                UntrackedRead::Missing | UntrackedRead::Directory => SideContent::Missing,
            },
        ),
    }
}

fn load_contents(
    repo: &ResolvedGitDirectory,
    scope: &ResolvedScope,
    path: &str,
    old_path: Option<&str>,
) -> Result<(Option<FileContents>, Option<ContentsOmitted>)> {
    let original = read_side(repo, &scope.from, old_path.unwrap_or(path))?;
    let modified = read_side(repo, &scope.to, path)?;
    let omitted = |reason| Ok((None, Some(reason)));
    let text = |side: SideContent| match side {
        SideContent::Text(text) => Ok(text),
        SideContent::Missing => Ok(String::new()),
        SideContent::Binary => Err(ContentsOmitted::Binary),
        SideContent::TooLarge => Err(ContentsOmitted::TooLarge),
    };
    match (text(original), text(modified)) {
        (Ok(original), Ok(modified)) => Ok((Some(FileContents { original, modified }), None)),
        (Err(reason), _) | (_, Err(reason)) => omitted(reason),
    }
}

/// Everything about one file in a scope except its contents.
struct FileFacts {
    summary: DiffFileSummary,
    untracked: bool,
}

fn file_facts(
    repo: &ResolvedGitDirectory,
    scope: &ResolvedScope,
    path: &str,
    old_path: Option<&str>,
) -> Result<Option<FileFacts>> {
    let mut specs = vec![path.to_string()];
    specs.extend(old_path.map(str::to_string));
    let (files, _) = tracked_summary(repo, scope, &specs)?;
    if let Some(summary) = files.into_iter().find(|f| f.path == path) {
        return Ok(Some(FileFacts {
            summary,
            untracked: false,
        }));
    }
    if !scope.untracked {
        return Ok(None);
    }
    let listed = run_ok(
        repo,
        os_args([
            "--literal-pathspecs",
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            path,
        ]),
        "git ls-files failed",
    )?;
    // `ls-files` lists every untracked file under a directory pathspec, so a
    // directory would otherwise pass for an untracked file. Only an entry that
    // is exactly this path counts.
    if !listed
        .stdout
        .split(|b| *b == 0)
        .any(|entry| entry == path.as_bytes())
    {
        return Ok(None);
    }
    let mut summary = untracked_entry(path);
    match read_untracked(&repo.local_path, path, UNTRACKED_COUNT_FILE_MAX) {
        UntrackedRead::Text(bytes) => summary.added = count_lines(&bytes),
        UntrackedRead::Binary => summary.binary = true,
        UntrackedRead::Symlink(_) => {
            summary.symlink = true;
            summary.added = 1;
        }
        _ => summary.approximate = true,
    }
    Ok(Some(FileFacts {
        summary,
        untracked: true,
    }))
}

fn parse_file_patch(output: &GitOutput, path: &str) -> ParsedFileDiff {
    diff::select_section(parse_unified(&output.stdout), path)
}

/// The hunks of `path` in `scope` (synthesized for an untracked file), whether
/// the patch was cut, and the parsed header.
fn fetch_parsed(
    repo: &ResolvedGitDirectory,
    scope: &ResolvedScope,
    facts: &FileFacts,
    old_path: Option<&str>,
) -> Result<(ParsedFileDiff, bool)> {
    if facts.untracked {
        return Ok(
            match read_untracked(&repo.local_path, &facts.summary.path, CONTENT_CAP_BYTES) {
                UntrackedRead::Text(bytes) => {
                    let (parsed, cut) = diff::synthesize_added_file(&bytes, MAX_SYNTH_LINES);
                    (parsed, cut)
                }
                UntrackedRead::Large => (ParsedFileDiff::default(), true),
                _ => (ParsedFileDiff::default(), false),
            },
        );
    }
    let mut specs = vec![facts.summary.path.clone()];
    specs.extend(old_path.map(str::to_string));
    let output = run_git_capped(
        &repo.workspace,
        Some(&repo.git_path),
        diff_command(&["-U3", "--patch"], scope, &specs),
        DEFAULT_TIMEOUT_SECS,
        PATCH_CAP_BYTES,
    )?;
    if !output.truncated {
        ensure_success(&output, "git diff failed")?;
    }
    let mut parsed = parse_file_patch(&output, &facts.summary.path);
    let capped = diff::cap_lines(&mut parsed.hunks, MAX_DIFF_LINES);
    let cut = output.truncated || parsed.incomplete || capped;
    if cut {
        parsed.incomplete = true;
    }
    Ok((parsed, cut))
}

pub fn diff_file(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    scope: &GitDiffScope,
    path: &str,
    old_path: Option<&str>,
    include_contents: bool,
    workspace: &WorkspaceEnv,
) -> Result<GitFileDiff> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    let rel = relative_spec(&repo, path)?;
    let old_rel = old_path
        .filter(|p| !p.is_empty())
        .map(|p| relative_spec(&repo, p))
        .transpose()?;
    let resolved = resolve_scope(&repo, scope)?;
    let Some(facts) = file_facts(&repo, &resolved, &rel, old_rel.as_deref())? else {
        return Ok(GitFileDiff {
            path: rel,
            old_path: old_rel,
            status: FileStatus::Modified,
            unchanged: true,
            binary: false,
            submodule: false,
            symlink: false,
            added: 0,
            removed: 0,
            hunks: Vec::new(),
            fingerprint: diff::fingerprint(&[]),
            truncated: false,
            contents: None,
            contents_omitted: None,
            from: resolved.from,
            to: resolved.to,
        });
    };

    let summary = &facts.summary;
    let skip_patch = summary.binary || summary.submodule;
    let (parsed, cut) = if skip_patch {
        (ParsedFileDiff::default(), false)
    } else {
        fetch_parsed(&repo, &resolved, &facts, old_rel.as_deref())?
    };
    let binary = summary.binary || parsed.binary;
    let (contents, contents_omitted) = if !include_contents {
        (None, Some(ContentsOmitted::Disabled))
    } else if binary {
        (None, Some(ContentsOmitted::Binary))
    } else if summary.submodule {
        (None, Some(ContentsOmitted::Submodule))
    } else {
        load_contents(
            &repo,
            &resolved,
            &summary.path,
            summary.old_path.as_deref().or(old_rel.as_deref()),
        )?
    };
    let (added, removed) = (summary.added, summary.removed);
    let fingerprint = diff::fingerprint(&parsed.hunks);
    Ok(GitFileDiff {
        path: summary.path.clone(),
        old_path: summary.old_path.clone(),
        status: summary.status,
        unchanged: false,
        binary,
        submodule: summary.submodule,
        symlink: summary.symlink,
        added,
        removed,
        hunks: parsed.hunks,
        fingerprint,
        truncated: cut,
        contents,
        contents_omitted,
        from: resolved.from,
        to: resolved.to,
    })
}

// ---------------------------------------------------------------- apply

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApplyMode {
    Stage,
    Unstage,
    Revert,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HunkSelection {
    pub id: String,
    /// Indices into the hunk's `lines` of the changed lines to take; omitted
    /// takes the whole hunk.
    pub lines: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApplySelection {
    /// The whole file: also the only way to act on added, deleted, renamed,
    /// binary, mode-only, symlink and submodule changes.
    File,
    Hunks {
        items: Vec<HunkSelection>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHunksRequest {
    pub scope: GitDiffScope,
    pub path: String,
    pub old_path: Option<String>,
    pub mode: ApplyMode,
    pub selection: ApplySelection,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefusalCode {
    Unchanged,
    StaleHunks,
    WholeFileOnly,
    UnsupportedScope,
    InvalidSelection,
    PatchRejected,
    NeedsSeparateScopes,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub code: RefusalCode,
    pub message: String,
    pub hunk_ids: Vec<String>,
}

/// Nothing is changed when `applied` is false.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub applied: bool,
    pub refusal: Option<Refusal>,
}

fn applied() -> ApplyOutcome {
    ApplyOutcome {
        applied: true,
        refusal: None,
    }
}

fn refused(code: RefusalCode, message: impl Into<String>, hunk_ids: Vec<String>) -> ApplyOutcome {
    ApplyOutcome {
        applied: false,
        refusal: Some(Refusal {
            code,
            message: message.into(),
            hunk_ids,
        }),
    }
}

fn scope_allows(mode: ApplyMode, scope: &GitDiffScope) -> bool {
    matches!(
        (mode, scope),
        (ApplyMode::Stage, GitDiffScope::Unstaged)
            | (ApplyMode::Unstage, GitDiffScope::Staged)
            | (ApplyMode::Revert, GitDiffScope::Unstaged)
            | (ApplyMode::Revert, GitDiffScope::Uncommitted)
    )
}

fn covers_every_change(hunk: &DiffHunk, lines: Option<&BTreeSet<usize>>) -> bool {
    match lines {
        None => true,
        Some(selected) => hunk
            .lines
            .iter()
            .enumerate()
            .all(|(i, l)| l.kind == LineKind::Context || selected.contains(&i)),
    }
}

pub fn apply_hunks(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    request: &ApplyHunksRequest,
    workspace: &WorkspaceEnv,
) -> Result<ApplyOutcome> {
    let repo = open_worktree(registry, repo_root, workspace)?;
    if !scope_allows(request.mode, &request.scope) {
        return Ok(refused(
            RefusalCode::UnsupportedScope,
            "that action does not apply to this diff scope",
            Vec::new(),
        ));
    }
    let rel = relative_spec(&repo, &request.path)?;
    let old_rel = request
        .old_path
        .as_deref()
        .filter(|p| !p.is_empty())
        .map(|p| relative_spec(&repo, p))
        .transpose()?;

    let lock = lock_for(&repo.local_path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let scope = resolve_scope(&repo, &request.scope)?;
    let Some(facts) = file_facts(&repo, &scope, &rel, old_rel.as_deref())? else {
        return Ok(refused(
            RefusalCode::Unchanged,
            "the file has no changes in this scope",
            Vec::new(),
        ));
    };
    let status = facts.summary.status;
    let whole_only = facts.untracked
        || status != FileStatus::Modified
        || facts.summary.binary
        || facts.summary.submodule
        || facts.summary.symlink;
    let old_for_ops = facts.summary.old_path.clone().or(old_rel.clone());

    let items = match &request.selection {
        ApplySelection::File => {
            whole_file(
                &repo,
                request.mode,
                &request.scope,
                &facts,
                &rel,
                old_for_ops.as_deref(),
            )?;
            return Ok(applied());
        }
        ApplySelection::Hunks { items } => items,
    };
    if items.is_empty() {
        return Ok(refused(
            RefusalCode::InvalidSelection,
            "no hunks selected",
            Vec::new(),
        ));
    }

    let (parsed, cut) = if whole_only && (facts.summary.binary || facts.summary.submodule) {
        (ParsedFileDiff::default(), false)
    } else {
        fetch_parsed(&repo, &scope, &facts, old_rel.as_deref())?
    };
    if cut {
        return Ok(refused(
            RefusalCode::WholeFileOnly,
            "the diff is too large for hunk selection; act on the whole file",
            Vec::new(),
        ));
    }
    let stale: Vec<String> = items
        .iter()
        .filter(|item| !parsed.hunks.iter().any(|h| h.id == item.id))
        .map(|item| item.id.clone())
        .collect();
    if !stale.is_empty() {
        return Ok(refused(
            RefusalCode::StaleHunks,
            "the file changed since the diff was loaded",
            stale,
        ));
    }

    let mut selections: Vec<(usize, Option<BTreeSet<usize>>)> = Vec::new();
    for item in items {
        let index = parsed
            .hunks
            .iter()
            .position(|h| h.id == item.id)
            .unwrap_or(0);
        if selections.iter().any(|(i, _)| *i == index) {
            return Ok(refused(
                RefusalCode::InvalidSelection,
                "a hunk was selected twice",
                vec![item.id.clone()],
            ));
        }
        selections.push((
            index,
            item.lines
                .as_ref()
                .map(|l| l.iter().map(|i| *i as usize).collect()),
        ));
    }
    selections.sort_by_key(|(i, _)| *i);

    let everything = selections.len() == parsed.hunks.len()
        && selections
            .iter()
            .all(|(i, lines)| covers_every_change(&parsed.hunks[*i], lines.as_ref()));
    if everything {
        whole_file(
            &repo,
            request.mode,
            &request.scope,
            &facts,
            &rel,
            old_for_ops.as_deref(),
        )?;
        return Ok(applied());
    }
    if whole_only {
        return Ok(refused(
            RefusalCode::WholeFileOnly,
            "this kind of change can only be applied to the whole file",
            Vec::new(),
        ));
    }

    let picks: Vec<HunkPick<'_>> = selections
        .iter()
        .map(|(i, lines)| HunkPick {
            hunk: &parsed.hunks[*i],
            lines: lines.as_ref(),
        })
        .collect();
    let anchor = match request.mode {
        ApplyMode::Stage => Anchor::Old,
        ApplyMode::Unstage | ApplyMode::Revert => Anchor::New,
    };
    let patch = match build_patch(&rel, &picks, anchor) {
        Ok(patch) => patch,
        Err(
            err @ (PatchError::BadLineSelection { .. } | PatchError::Empty | PatchError::Unordered),
        ) => {
            return Ok(refused(
                RefusalCode::InvalidSelection,
                err.to_string(),
                Vec::new(),
            ));
        }
        Err(err @ PatchError::NoNewlineHunk { .. }) => {
            return Ok(refused(
                RefusalCode::WholeFileOnly,
                err.to_string(),
                Vec::new(),
            ));
        }
    };

    let mut flags = vec!["apply", "--recount", "--whitespace=nowarn"];
    match (request.mode, &request.scope) {
        (ApplyMode::Stage, _) => flags.push("--cached"),
        (ApplyMode::Unstage, _) => flags.extend(["--cached", "--reverse"]),
        (ApplyMode::Revert, GitDiffScope::Uncommitted) => {
            if !index_matches_worktree(&repo, &rel)? {
                return Ok(refused(
                    RefusalCode::NeedsSeparateScopes,
                    "the file has staged and unstaged changes; unstage or revert the unstaged part first",
                    Vec::new(),
                ));
            }
            flags.extend(["--index", "--reverse"]);
        }
        (ApplyMode::Revert, _) => flags.push("--reverse"),
    }
    flags.push("-");
    let output = run_git_with(
        &repo.workspace,
        Some(&repo.git_path),
        os_args(flags),
        DEFAULT_TIMEOUT_SECS,
        RunOptions {
            stdin: Some(patch),
            ..Default::default()
        },
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git apply"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.lines().take(3).collect::<Vec<_>>().join("; ");
        return Ok(refused(RefusalCode::PatchRejected, message, Vec::new()));
    }
    Ok(applied())
}

fn index_matches_worktree(repo: &ResolvedGitDirectory, rel: &str) -> Result<bool> {
    let output = run(
        repo,
        os_args([
            "--literal-pathspecs",
            "diff",
            "--quiet",
            "--no-ext-diff",
            "--",
            rel,
        ]),
    )?;
    Ok(output.exit_code == Some(0))
}

fn paths_args(rel: &str, old: Option<&str>) -> Vec<OsString> {
    let mut args = os_args(["--", rel]);
    args.extend(old.map(OsString::from));
    args
}

fn with_prefix(prefix: &[&str], tail: Vec<OsString>) -> Vec<OsString> {
    let mut args = os_args(prefix.iter().copied());
    args.extend(tail);
    args
}

/// Reverting a staged rename puts `old` back from HEAD, which must therefore
/// be in HEAD and must not already be occupied by something else (restoring
/// over an unrelated file would destroy it).
fn ensure_rename_revertible(repo: &ResolvedGitDirectory, old: &str) -> Result<()> {
    let in_head = run(repo, os_args(["cat-file", "-e", &format!("HEAD:{old}")]))?;
    if in_head.exit_code != Some(0) {
        return Err(GitError::command(
            "git restore",
            format!("{old} is not in HEAD; nothing was changed"),
        ));
    }
    let occupied = std::fs::symlink_metadata(repo.local_path.join(old)).is_ok();
    let indexed = run(
        repo,
        os_args([
            "--literal-pathspecs",
            "ls-files",
            "--error-unmatch",
            "--",
            old,
        ]),
    )?;
    if occupied || indexed.exit_code == Some(0) {
        return Err(GitError::command(
            "git restore",
            format!("{old} exists again; nothing was changed"),
        ));
    }
    Ok(())
}

/// Whole-file stage / unstage / revert, which also covers the changes a hunk
/// patch cannot express: new, deleted, renamed, binary and mode-only files.
fn whole_file(
    repo: &ResolvedGitDirectory,
    mode: ApplyMode,
    scope: &GitDiffScope,
    facts: &FileFacts,
    rel: &str,
    old: Option<&str>,
) -> Result<()> {
    let status = facts.summary.status;
    let paths = paths_args(rel, old);
    match mode {
        ApplyMode::Stage => {
            run_ok(
                repo,
                with_prefix(&["--literal-pathspecs", "add", "-A"], paths),
                "git add failed",
            )?;
        }
        ApplyMode::Unstage => {
            if head_commit_opt(repo)?.is_some() {
                run_ok(
                    repo,
                    with_prefix(&["--literal-pathspecs", "reset", "-q", "HEAD"], paths),
                    "git reset failed",
                )?;
            } else {
                run_ok(
                    repo,
                    with_prefix(
                        &[
                            "--literal-pathspecs",
                            "rm",
                            "--cached",
                            "-q",
                            "-r",
                            "--ignore-unmatch",
                        ],
                        paths,
                    ),
                    "git rm --cached failed",
                )?;
            }
        }
        ApplyMode::Revert => {
            if facts.untracked {
                if std::fs::symlink_metadata(repo.local_path.join(rel)).is_ok_and(|m| m.is_dir()) {
                    return Err(GitError::InvalidPath(format!("{rel} is a directory")));
                }
                run_ok(
                    repo,
                    with_prefix(
                        &["--literal-pathspecs", "clean", "-f", "-q"],
                        paths_args(rel, None),
                    ),
                    "git clean failed",
                )?;
            } else if matches!(scope, GitDiffScope::Uncommitted) {
                match status {
                    FileStatus::Added => {
                        run_ok(
                            repo,
                            with_prefix(
                                &["--literal-pathspecs", "rm", "-f", "-q"],
                                paths_args(rel, None),
                            ),
                            "git rm failed",
                        )?;
                    }
                    FileStatus::Renamed | FileStatus::Copied => {
                        // Two steps, ordered so that a failure can never lose
                        // anything: every precondition is checked first, the
                        // old side is put back (it only creates a file) and
                        // only then is the new side removed.
                        let mut restored_old: Option<&str> = None;
                        if status == FileStatus::Renamed {
                            let old = old.ok_or_else(|| {
                                GitError::InvalidPath("a rename needs its old path".into())
                            })?;
                            ensure_rename_revertible(repo, old)?;
                            run_ok(
                                repo,
                                with_prefix(
                                    &[
                                        "--literal-pathspecs",
                                        "restore",
                                        "--source=HEAD",
                                        "--staged",
                                        "--worktree",
                                    ],
                                    paths_args(old, None),
                                ),
                                "git restore failed",
                            )?;
                            restored_old = Some(old);
                        }
                        let removed = run_ok(
                            repo,
                            with_prefix(
                                &["--literal-pathspecs", "rm", "-f", "-q"],
                                paths_args(rel, None),
                            ),
                            "git rm failed",
                        );
                        if let Err(error) = removed {
                            // Undo the first half: `old` was absent before (checked
                            // above), so taking it out again restores the start state.
                            if let Some(old) = restored_old {
                                let _ = run(
                                    repo,
                                    with_prefix(
                                        &["--literal-pathspecs", "rm", "-f", "-q"],
                                        paths_args(old, None),
                                    ),
                                );
                            }
                            return Err(error);
                        }
                    }
                    _ => {
                        run_ok(
                            repo,
                            with_prefix(
                                &[
                                    "--literal-pathspecs",
                                    "restore",
                                    "--source=HEAD",
                                    "--staged",
                                    "--worktree",
                                ],
                                paths_args(rel, None),
                            ),
                            "git restore failed",
                        )?;
                    }
                }
            } else {
                run_ok(
                    repo,
                    with_prefix(
                        &["--literal-pathspecs", "restore", "--worktree"],
                        paths_args(rel, None),
                    ),
                    "git restore failed",
                )?;
            }
        }
    }
    Ok(())
}
