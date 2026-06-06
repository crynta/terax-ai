use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::Deserialize;
use serde_json::{json, Value};
use tempfile::NamedTempFile;

use crate::modules::fs::safety::{is_sensitive_path, PathPolicy};
use crate::modules::fs::to_canon;
use crate::modules::shell;
use crate::modules::workspace::WorkspaceEnv;

use super::{
    mcp_tools, NativeToolResult, ToolInput, DEFAULT_BASH_TIMEOUT_SECS, DEFAULT_FIND_LIMIT,
    DEFAULT_GREP_LIMIT, DEFAULT_LS_LIMIT, FILE_SIZE_CAP, HARD_BASH_TIMEOUT_SECS, HARD_LS_LIMIT,
    HARD_SEARCH_LIMIT, MAX_OUTPUT_BYTES, MAX_READ_BYTES,
};

pub(super) fn canonical_workspace(cwd: &str) -> Result<PathBuf, String> {
    let workspace =
        fs::canonicalize(cwd).map_err(|error| format!("cwd not accessible: {error}"))?;
    if !workspace.is_dir() {
        return Err(format!("cwd is not a directory: {}", workspace.display()));
    }
    Ok(workspace)
}

fn path_policy(workspace: &Path) -> PathPolicy {
    PathPolicy::native_pi_tool(workspace)
}

fn resolve_existing_path(workspace: &Path, raw_path: &str) -> Result<PathBuf, String> {
    path_policy(workspace).resolve_existing(raw_path)
}

fn resolve_target_path(workspace: &Path, raw_path: &str) -> Result<PathBuf, String> {
    path_policy(workspace).resolve_target(raw_path)
}

fn truncate_text(text: &str) -> (String, Value) {
    if text.len() <= MAX_OUTPUT_BYTES {
        return (
            text.to_string(),
            json!({ "truncation": { "truncated": false } }),
        );
    }
    let mut end = MAX_OUTPUT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (
        format!(
            "{}\n\n[Output truncated at {} bytes]",
            &text[..end],
            MAX_OUTPUT_BYTES
        ),
        json!({
            "truncation": {
                "truncated": true,
                "maxBytes": MAX_OUTPUT_BYTES,
                "originalBytes": text.len()
            }
        }),
    )
}

pub(super) fn execute_read(
    workspace: &Path,
    input: ToolInput<'_>,
) -> Result<NativeToolResult, String> {
    let raw_path = input.string("path")?;
    let path = resolve_existing_path(workspace, &raw_path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("not a file: {raw_path}"));
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "file is too large to read through Pi tools: {} bytes (limit {})",
            metadata.len(),
            MAX_READ_BYTES
        ));
    }
    let bytes = fs::read(&path).map_err(|error| format!("failed to read {raw_path}: {error}"))?;
    if bytes.iter().take(8 * 1024).any(|byte| *byte == 0) {
        return Ok(NativeToolResult::text(
            format!(
                "Read binary file [{} bytes]. Binary content omitted.",
                bytes.len()
            ),
            json!({ "path": to_canon(&path), "size": bytes.len(), "binary": true }),
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| format!("file is not valid UTF-8 text: {raw_path}"))?;
    let total_lines = content.lines().count();
    let offset = input.optional_usize("offset")?.unwrap_or(1).max(1);
    let limit = input.optional_usize("limit")?;
    let selected = content
        .lines()
        .skip(offset - 1)
        .take(limit.unwrap_or(usize::MAX))
        .collect::<Vec<_>>()
        .join("\n");
    let (text, truncation) = truncate_text(&selected);
    Ok(NativeToolResult::text(
        text,
        mcp_tools::merge_details(
            json!({
                "path": to_canon(&path),
                "size": metadata.len(),
                "totalLines": total_lines,
                "offset": offset,
                "limit": limit,
                "mediatedBy": "rust"
            }),
            truncation,
        ),
    ))
}

pub(super) fn execute_ls(
    workspace: &Path,
    input: ToolInput<'_>,
) -> Result<NativeToolResult, String> {
    let raw_path = input
        .optional_string("path")?
        .unwrap_or_else(|| ".".to_string());
    let path = resolve_existing_path(workspace, &raw_path)?;
    if !path.is_dir() {
        return Err(format!("not a directory: {raw_path}"));
    }
    let limit = input
        .optional_usize("limit")?
        .unwrap_or(DEFAULT_LS_LIMIT)
        .clamp(1, HARD_LS_LIMIT);
    let mut entries = fs::read_dir(&path)
        .map_err(|error| format!("failed to list {raw_path}: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if is_sensitive_path(Path::new(&name)) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let is_dir = metadata.is_dir();
            Some((name, is_dir))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|(left, left_dir), (right, right_dir)| {
        right_dir
            .cmp(left_dir)
            .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    let truncated = entries.len() > limit;
    let output = entries
        .iter()
        .take(limit)
        .map(|(name, is_dir)| {
            if *is_dir {
                format!("{name}/")
            } else {
                name.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let (text, truncation) = truncate_text(&output);
    Ok(NativeToolResult::text(
        text,
        mcp_tools::merge_details(
            json!({
                "path": to_canon(&path),
                "entries": entries.len(),
                "entryLimitReached": if truncated { limit } else { 0 },
                "mediatedBy": "rust"
            }),
            truncation,
        ),
    ))
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|error| format!("bad glob {pattern:?}: {error}"))?);
    }
    Ok(Some(builder.build().map_err(|error| {
        format!("globset build failed: {error}")
    })?))
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(to_canon)
        .unwrap_or_else(|_| to_canon(path))
}

fn is_sensitive_child_path(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .map(is_sensitive_path)
        .unwrap_or_else(|_| is_sensitive_path(path))
}

fn search_file(
    matcher: &grep_regex::RegexMatcher,
    root: &Path,
    path: &Path,
    lines: &mut Vec<String>,
    limit: usize,
) -> Result<bool, String> {
    if is_sensitive_child_path(root, path) {
        return Ok(false);
    }
    if fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        > FILE_SIZE_CAP
    {
        return Ok(false);
    }
    let rel = relative_display(root, path);
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();
    searcher
        .search_path(
            matcher,
            path,
            UTF8(|line_number, text| {
                if lines.len() >= limit {
                    return Ok(false);
                }
                lines.push(format!(
                    "{}:{}:{}",
                    rel,
                    line_number,
                    text.trim_end_matches('\n')
                ));
                Ok(true)
            }),
        )
        .map_err(|error| format!("grep search failed: {error}"))?;
    Ok(lines.len() >= limit)
}

pub(super) fn execute_grep(
    workspace: &Path,
    input: ToolInput<'_>,
) -> Result<NativeToolResult, String> {
    let mut pattern = input.string("pattern")?;
    if input.optional_bool("literal")? {
        pattern = escape_regex_literal(&pattern);
    }
    let raw_path = input
        .optional_string("path")?
        .unwrap_or_else(|| ".".to_string());
    let path = resolve_existing_path(workspace, &raw_path)?;
    let requested_glob = input.optional_string("glob")?;
    let limit = input
        .optional_usize("limit")?
        .unwrap_or(DEFAULT_GREP_LIMIT)
        .clamp(1, HARD_SEARCH_LIMIT);
    let case_insensitive = input.optional_bool("ignoreCase")?;
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|error| format!("bad regex: {error}"))?;

    let mut lines = Vec::new();
    let mut files_scanned = 0usize;
    let mut truncated = false;
    if path.is_file() {
        let root = path
            .parent()
            .ok_or_else(|| format!("file has no parent: {}", path.display()))?;
        files_scanned += 1;
        truncated = search_file(&matcher, root, &path, &mut lines, limit)?;
    } else {
        let globset = build_globset(&requested_glob.into_iter().collect::<Vec<_>>())?;
        for entry in WalkBuilder::new(&path)
            .hidden(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .ignore(true)
            .parents(true)
            .follow_links(false)
            .build()
            .flatten()
        {
            if lines.len() >= limit {
                truncated = true;
                break;
            }
            if !entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
            {
                continue;
            }
            let file_path = entry.path();
            if is_sensitive_child_path(&path, file_path) {
                continue;
            }
            let rel = relative_display(&path, file_path);
            if globset
                .as_ref()
                .is_some_and(|globset| !globset.is_match(&rel))
            {
                continue;
            }
            files_scanned += 1;
            truncated = search_file(&matcher, &path, file_path, &mut lines, limit)?;
        }
    }

    let output = lines.join("\n");
    let (text, truncation) = truncate_text(&output);
    Ok(NativeToolResult::text(
        text,
        mcp_tools::merge_details(
            json!({
                "matches": lines.len(),
                "filesScanned": files_scanned,
                "matchLimitReached": if truncated { limit } else { 0 },
                "mediatedBy": "rust"
            }),
            truncation,
        ),
    ))
}

pub(super) fn execute_find(
    workspace: &Path,
    input: ToolInput<'_>,
) -> Result<NativeToolResult, String> {
    let pattern = input.string("pattern")?;
    let raw_path = input
        .optional_string("path")?
        .unwrap_or_else(|| ".".to_string());
    let path = resolve_existing_path(workspace, &raw_path)?;
    if !path.is_dir() {
        return Err(format!("not a directory: {raw_path}"));
    }
    let limit = input
        .optional_usize("limit")?
        .unwrap_or(DEFAULT_FIND_LIMIT)
        .clamp(1, HARD_SEARCH_LIMIT);
    let globset = build_globset(&[pattern])?
        .ok_or_else(|| "find requires a non-empty pattern".to_string())?;
    let mut hits = Vec::new();
    let mut truncated = false;
    for entry in WalkBuilder::new(&path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build()
        .flatten()
    {
        if hits.len() >= limit {
            truncated = true;
            break;
        }
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        let file_path = entry.path();
        if is_sensitive_child_path(&path, file_path) {
            continue;
        }
        let rel = relative_display(&path, file_path);
        if globset.is_match(&rel) {
            hits.push(rel);
        }
    }
    let output = hits.join("\n");
    let (text, truncation) = truncate_text(&output);
    Ok(NativeToolResult::text(
        text,
        mcp_tools::merge_details(
            json!({
                "matches": hits.len(),
                "resultLimitReached": if truncated { limit } else { 0 },
                "mediatedBy": "rust"
            }),
            truncation,
        ),
    ))
}

pub(super) fn execute_bash(
    workspace: &Path,
    input: ToolInput<'_>,
    workspace_env: &WorkspaceEnv,
) -> Result<NativeToolResult, String> {
    if workspace_env.is_wsl() {
        return Err(
            "Pi bash is disabled for WSL workspaces until Terax routes commands through WSL"
                .to_string(),
        );
    }

    let command = input.string("command")?;
    let timeout = input
        .optional_u64("timeout")?
        .unwrap_or(DEFAULT_BASH_TIMEOUT_SECS)
        .clamp(1, HARD_BASH_TIMEOUT_SECS);
    let output = shell::run_blocking_inner(
        command,
        Some(to_canon(workspace)),
        workspace_env.clone(),
        Duration::from_secs(timeout),
    )?;
    let mut text = output.stdout;
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str("stderr:\n");
        text.push_str(&output.stderr);
    }
    let (text, truncation) = truncate_text(if text.is_empty() {
        "(no output)"
    } else {
        &text
    });
    let details = mcp_tools::merge_details(
        json!({
            "exitCode": output.exit_code,
            "timedOut": output.timed_out,
            "outputTruncated": output.truncated,
            "mediatedBy": "rust"
        }),
        truncation,
    );
    if output.timed_out {
        return Err(format!(
            "{text}\n\nCommand timed out after {timeout} seconds"
        ));
    }
    if !matches!(output.exit_code, Some(0)) {
        return Err(format!(
            "{}\n\nCommand exited with code {}",
            text,
            output
                .exit_code
                .map_or_else(|| "unknown".to_string(), |code| code.to_string())
        ));
    }
    Ok(NativeToolResult::text(text, details))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditInput {
    path: String,
    edits: Vec<ReplaceEdit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceEdit {
    old_text: String,
    new_text: String,
}

pub(super) fn execute_edit(
    workspace: &Path,
    input: ToolInput<'_>,
) -> Result<NativeToolResult, String> {
    let input: EditInput = serde_json::from_value(input.value.clone())
        .map_err(|error| format!("invalid edit input: {error}"))?;
    if input.edits.is_empty() {
        return Err("edit requires at least one replacement".to_string());
    }
    let path = resolve_existing_path(workspace, &input.path)?;
    let original = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", input.path))?;

    let mut replacements = Vec::with_capacity(input.edits.len());
    for edit in input.edits {
        if edit.old_text.is_empty() {
            return Err("edit oldText must not be empty".to_string());
        }
        let matches = original.match_indices(&edit.old_text).collect::<Vec<_>>();
        if matches.is_empty() {
            return Err("edit oldText did not match the file".to_string());
        }
        if matches.len() > 1 {
            return Err("edit oldText matched more than once".to_string());
        }
        let start = matches[0].0;
        let end = start + edit.old_text.len();
        replacements.push((start, end, edit.new_text));
    }
    replacements.sort_by_key(|replacement| replacement.0);
    for pair in replacements.windows(2) {
        if pair[0].1 > pair[1].0 {
            return Err("edit replacements overlap".to_string());
        }
    }

    let mut next = String::with_capacity(original.len());
    let mut cursor = 0;
    for (start, end, new_text) in &replacements {
        next.push_str(&original[cursor..*start]);
        next.push_str(new_text);
        cursor = *end;
    }
    next.push_str(&original[cursor..]);
    write_atomic(&path, next.as_bytes())?;
    Ok(NativeToolResult::text(
        format!(
            "Edited {} ({} replacement{} applied).",
            to_canon(&path),
            replacements.len(),
            if replacements.len() == 1 { "" } else { "s" }
        ),
        json!({
            "path": to_canon(&path),
            "replacements": replacements.len(),
            "mediatedBy": "rust"
        }),
    ))
}

#[derive(Deserialize)]
struct WriteInput {
    path: String,
    content: String,
}

pub(super) fn execute_write(
    workspace: &Path,
    input: ToolInput<'_>,
) -> Result<NativeToolResult, String> {
    let input: WriteInput = serde_json::from_value(input.value.clone())
        .map_err(|error| format!("invalid write input: {error}"))?;
    let path = resolve_target_path(workspace, &input.path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create parent directory: {error}"))?;
    }
    write_atomic(&path, input.content.as_bytes())?;
    Ok(NativeToolResult::text(
        format!("Wrote {} ({} bytes).", to_canon(&path), input.content.len()),
        json!({
            "path": to_canon(&path),
            "bytes": input.content.len(),
            "mediatedBy": "rust"
        }),
    ))
}

fn write_atomic(target: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "target path has no parent".to_string())?;
    let mut tmp = NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    tmp.as_file_mut()
        .write_all(content)
        .map_err(|error| error.to_string())?;
    tmp.as_file_mut()
        .sync_all()
        .map_err(|error| error.to_string())?;
    tmp.persist(target)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

fn escape_regex_literal(pattern: &str) -> String {
    let mut escaped = String::with_capacity(pattern.len());
    for ch in pattern.chars() {
        if matches!(
            ch,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}
