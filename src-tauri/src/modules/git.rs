use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 120;
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub is_detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub status_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub changed_files: Vec<GitChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub diff_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffContentResult {
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub fallback_patch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub commit_sha: String,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub pushed: bool,
}

struct GitOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<i32>,
    timed_out: bool,
}

enum TextSource {
    Missing,
    Binary,
    Text(String),
}

impl TextSource {
    fn into_text(self) -> String {
        match self {
            TextSource::Text(text) => text,
            TextSource::Missing | TextSource::Binary => String::new(),
        }
    }
}

#[tauri::command]
pub async fn git_resolve_repo(cwd: String) -> Result<Option<GitRepoInfo>, String> {
    let cwd = canonical_dir(&cwd)?;
    match repo_info_from_cwd(&cwd)? {
        Some(info) => Ok(Some(info)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn git_status(repo_root: String) -> Result<GitStatusSnapshot, String> {
    let repo_root = canonical_dir(&repo_root)?;
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
    let mut files = Vec::new();
    let mut i = 1usize;
    while i < fields.len() {
      let entry = fields[i];
      if entry.len() < 3 {
          i += 1;
          continue;
      }
      let xy = &entry[..2];
      let path_part = &entry[3..];
      let index_status = xy.chars().next().unwrap_or(' ');
      let worktree_status = xy.chars().nth(1).unwrap_or(' ');
      let original_path = if matches!(index_status, 'R' | 'C') {
          let prev = fields.get(i + 1).map(|s| (*s).to_string());
          i += 1;
          prev
      } else {
          None
      };
      files.push(GitChangedFile {
          path: path_part.to_string(),
          original_path,
          index_status: index_status.to_string(),
          worktree_status: worktree_status.to_string(),
          staged: is_staged(index_status, worktree_status),
          unstaged: is_unstaged(index_status, worktree_status),
          untracked: index_status == '?' && worktree_status == '?',
          status_label: status_label(index_status, worktree_status),
      });
      i += 1;
    }

    Ok(GitStatusSnapshot {
        repo_root: display_path(&repo_root),
        branch,
        upstream,
        ahead,
        behind,
        is_detached,
        changed_files: files,
    })
}

#[tauri::command]
pub async fn git_diff(
    repo_root: String,
    path: Option<String>,
    staged: bool,
) -> Result<GitDiffResult, String> {
    let repo_root = canonical_dir(&repo_root)?;
    ensure_git_available()?;

    let mut args: Vec<&str> = vec!["diff", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    if let Some(path) = path.as_deref().filter(|p| !p.is_empty()) {
        args.extend(["--", path]);
    }
    let output = run_git(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git diff failed")?;

    Ok(GitDiffResult {
        diff_text: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}

#[tauri::command]
pub async fn git_diff_content(
    repo_root: String,
    path: String,
    staged: bool,
) -> Result<GitDiffContentResult, String> {
    let repo_root = canonical_dir(&repo_root)?;
    ensure_git_available()?;
    let path_ref = Path::new(&path);
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
    let patch = git_diff(display_path(&repo_root), Some(path), staged)
        .await?
        .diff_text;
    let is_binary = matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch,
    })
}

#[tauri::command]
pub async fn git_stage(repo_root: String, paths: Vec<String>) -> Result<(), String> {
    let repo_root = canonical_dir(&repo_root)?;
    ensure_git_available()?;
    run_git_paths(&repo_root, "add", &paths)?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(repo_root: String, paths: Vec<String>) -> Result<(), String> {
    let repo_root = canonical_dir(&repo_root)?;
    ensure_git_available()?;
    let mut args: Vec<&OsStr> = vec![OsStr::new("reset"), OsStr::new("HEAD"), OsStr::new("--")];
    for path in &paths {
        args.push(OsStr::new(path));
    }
    let output = run_git_os(Some(&repo_root), args, DEFAULT_TIMEOUT_SECS)?;
    ensure_success(&output, "git reset failed")?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit(repo_root: String, message: String) -> Result<GitCommitResult, String> {
    let repo_root = canonical_dir(&repo_root)?;
    ensure_git_available()?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message cannot be empty".into());
    }
    let output = run_git_os(
        Some(&repo_root),
        [
            OsStr::new("commit"),
            OsStr::new("-m"),
            OsStr::new(trimmed),
        ],
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

#[tauri::command]
pub async fn git_push(repo_root: String) -> Result<GitPushResult, String> {
    let repo_root = canonical_dir(&repo_root)?;
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
    let head = git_stdout_line(&repo_root, ["rev-parse", "--abbrev-ref", "HEAD"], "failed to resolve HEAD")?;
    let upstream =
        git_stdout_line_opt(&repo_root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;

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
    ensure_success(&output, &format!("git {command} failed"))?;
    Ok(())
}

fn parse_branch_header(header: &str) -> Result<(String, Option<String>, u32, u32, bool), String> {
    if !header.starts_with("## ") {
        return Err("malformed git status branch header".into());
    }
    let body = &header[3..];
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let (head_part, meta_part) = match body.split_once("...") {
        Some((head, rest)) => {
            let (upstream, meta) = match rest.split_once(' ') {
                Some((upstream, meta)) => (Some(upstream.to_string()), Some(meta)),
                None => (Some(rest.to_string()), None),
            };
            let head = head.to_string();
            if let Some(meta) = meta {
                if let Some(start) = meta.find('[') {
                    if let Some(end) = meta[start + 1..].find(']') {
                        let status = &meta[start + 1..start + 1 + end];
                        for part in status.split(',') {
                            let part = part.trim();
                            if let Some(v) = part.strip_prefix("ahead ") {
                                ahead = v.parse::<u32>().unwrap_or(0);
                            } else if let Some(v) = part.strip_prefix("behind ") {
                                behind = v.parse::<u32>().unwrap_or(0);
                            }
                        }
                    }
                }
            }
            (head, upstream)
        }
        None => {
            let head = body
                .split(' ')
                .next()
                .unwrap_or("HEAD")
                .to_string();
            (head, None)
        }
    };
    let is_detached = head_part == "HEAD" || head_part.contains("(detached");
    Ok((head_part, meta_part, ahead, behind, is_detached))
}

fn is_staged(index_status: char, worktree_status: char) -> bool {
    index_status != ' ' && !(index_status == '?' && worktree_status == '?')
}

fn is_unstaged(index_status: char, worktree_status: char) -> bool {
    worktree_status != ' ' || (index_status == '?' && worktree_status == '?')
}

fn status_label(index_status: char, worktree_status: char) -> String {
    match (index_status, worktree_status) {
        ('?', '?') => "Untracked".into(),
        ('A', _) => "Added".into(),
        ('M', _) | (_, 'M') => "Modified".into(),
        ('D', _) | (_, 'D') => "Deleted".into(),
        ('R', _) | (_, 'R') => "Renamed".into(),
        ('C', _) | (_, 'C') => "Copied".into(),
        ('U', _) | (_, 'U') => "Unmerged".into(),
        _ => "Changed".into(),
    }
}

fn split_upstream(upstream: &str) -> (Option<String>, Option<String>) {
    match upstream.split_once('/') {
        Some((remote, branch)) => (Some(remote.to_string()), Some(branch.to_string())),
        None => (None, Some(upstream.to_string())),
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn canonical_dir(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_dir() {
        return Err(format!("path is not a directory: {path}"));
    }
    std::fs::canonicalize(&candidate).map_err(|e| e.to_string())
}

fn ensure_git_available() -> Result<(), String> {
    let output = run_git(None, ["--version"], 10)?;
    ensure_success(&output, "git is not available")
}

fn git_show_text(repo_root: &Path, spec: &str) -> Result<TextSource, String> {
    let output = run_git_os(
        Some(repo_root),
        [OsStr::new("show"), OsStr::new("--no-textconv"), OsStr::new(spec)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err("git show timed out".into());
    }
    if output.exit_code != Some(0) {
        return Ok(TextSource::Missing);
    }
    decode_text(output.stdout)
}

fn read_text_file(path: &Path) -> Result<TextSource, String> {
    if !path.exists() {
        return Ok(TextSource::Missing);
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    decode_text(bytes)
}

fn decode_text(bytes: Vec<u8>) -> Result<TextSource, String> {
    let sniff_len = bytes.len().min(8192);
    if bytes[..sniff_len].contains(&0) {
        return Ok(TextSource::Binary);
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(TextSource::Text(text)),
        Err(_) => Ok(TextSource::Binary),
    }
}

fn git_stdout_line<P, I, S>(cwd: P, args: I, err_prefix: &str) -> Result<String, String>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    match git_stdout_line_opt(cwd, args)? {
        Some(v) => Ok(v),
        None => Err(err_prefix.into()),
    }
}

fn git_stdout_line_opt<P, I, S>(cwd: P, args: I) -> Result<Option<String>, String>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git_os(Some(cwd.as_ref()), args, DEFAULT_TIMEOUT_SECS)?;
    if output.timed_out {
        return Err("git command timed out".into());
    }
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        Ok(None)
    } else {
        Ok(Some(line.to_string()))
    }
}

fn ensure_success(output: &GitOutput, context: &str) -> Result<(), String> {
    if output.timed_out {
        return Err(format!("{context}: timed out"));
    }
    if output.exit_code == Some(0) {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown git error".into()
    };
    Err(format!("{context}: {detail}"))
}

fn run_git<I, S>(cwd: Option<&Path>, args: I, timeout_secs: u64) -> Result<GitOutput, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_git_os(cwd, args, timeout_secs)
}

fn run_git_os<I, S>(cwd: Option<&Path>, args: I, timeout_secs: u64) -> Result<GitOutput, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let dur = Duration::from_secs(timeout_secs.clamp(1, MAX_TIMEOUT_SECS));
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdout_pipe = child.stdout.take().ok_or("no stdout pipe")?;
    let mut stderr_pipe = child.stderr.take().ok_or("no stderr pipe")?;
    let stdout_handle = thread::spawn(move || drain(&mut stdout_pipe));
    let stderr_handle = thread::spawn(move || drain(&mut stderr_pipe));

    let started = Instant::now();
    let mut timed_out = false;
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        if started.elapsed() >= dur {
            let _ = child.kill();
            let _ = child.wait();
            timed_out = true;
            break None;
        }
        thread::sleep(POLL_INTERVAL);
    };

    let (stdout, _stdout_truncated) = stdout_handle.join().unwrap_or((Vec::new(), false));
    let (stderr, _stderr_truncated) = stderr_handle.join().unwrap_or((Vec::new(), false));

    Ok(GitOutput {
        stdout,
        stderr,
        exit_code,
        timed_out,
    })
}

fn drain<R: Read>(reader: &mut R) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= MAX_OUTPUT_BYTES {
                    truncated = true;
                    continue;
                }
                let take = (MAX_OUTPUT_BYTES - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}
