use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tempfile::NamedTempFile;

use crate::modules::fs::to_canon;
use crate::modules::shell;
use crate::modules::workspace::WorkspaceEnv;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 50 * 1024;
const DEFAULT_LS_LIMIT: usize = 500;
const HARD_LS_LIMIT: usize = 2_000;
const DEFAULT_GREP_LIMIT: usize = 100;
const DEFAULT_FIND_LIMIT: usize = 1_000;
const HARD_SEARCH_LIMIT: usize = 2_000;
const DEFAULT_BASH_TIMEOUT_SECS: u64 = 30;
const HARD_BASH_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeToolRequest {
    pub session_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub cwd: String,
    #[serde(default)]
    pub workspace_env: Option<WorkspaceEnv>,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeToolResult {
    pub content: Vec<NativeToolContent>,
    pub details: Value,
}

#[derive(Debug, Serialize)]
pub(super) struct NativeToolContent {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
}

impl NativeToolResult {
    fn text(text: impl Into<String>, details: Value) -> Self {
        Self {
            content: vec![NativeToolContent {
                kind: "text",
                text: text.into(),
            }],
            details,
        }
    }
}

pub(super) fn execute(request: NativeToolRequest) -> Result<NativeToolResult, String> {
    let workspace = canonical_workspace(&request.cwd)?;
    let workspace_env = request.workspace_env.unwrap_or_default();
    let input = ToolInput::new(&request.input);
    match request.tool_name.as_str() {
        "read" => execute_read(&workspace, input),
        "ls" => execute_ls(&workspace, input),
        "grep" => execute_grep(&workspace, input),
        "find" => execute_find(&workspace, input),
        "bash" => execute_bash(&workspace, input, &workspace_env),
        "edit" => execute_edit(&workspace, input),
        "write" => execute_write(&workspace, input),
        other => Err(format!("unsupported native Pi tool: {other}")),
    }
}

struct ToolInput<'a> {
    value: &'a Value,
}

impl<'a> ToolInput<'a> {
    fn new(value: &'a Value) -> Self {
        Self { value }
    }

    fn string(&self, key: &str) -> Result<String, String> {
        self.optional_string(key)?
            .ok_or_else(|| format!("native tool input requires `{key}`"))
    }

    fn optional_string(&self, key: &str) -> Result<Option<String>, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(value)) if !value.trim().is_empty() => Ok(Some(value.clone())),
            Some(Value::String(_)) => Err(format!("native tool input `{key}` must not be empty")),
            Some(_) => Err(format!("native tool input `{key}` must be a string")),
        }
    }

    fn optional_usize(&self, key: &str) -> Result<Option<usize>, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => value
                .as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .map(Some)
                .ok_or_else(|| format!("native tool input `{key}` must be a positive integer")),
            Some(_) => Err(format!("native tool input `{key}` must be a number")),
        }
    }

    fn optional_u64(&self, key: &str) -> Result<Option<u64>, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(value)) => value
                .as_u64()
                .map(Some)
                .ok_or_else(|| format!("native tool input `{key}` must be a positive integer")),
            Some(_) => Err(format!("native tool input `{key}` must be a number")),
        }
    }

    fn optional_bool(&self, key: &str) -> Result<bool, String> {
        match self.value.get(key) {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(value)) => Ok(*value),
            Some(_) => Err(format!("native tool input `{key}` must be a boolean")),
        }
    }
}

fn canonical_workspace(cwd: &str) -> Result<PathBuf, String> {
    let workspace =
        fs::canonicalize(cwd).map_err(|error| format!("cwd not accessible: {error}"))?;
    if !workspace.is_dir() {
        return Err(format!("cwd is not a directory: {}", workspace.display()));
    }
    Ok(workspace)
}

fn resolve_existing_path(workspace: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let candidate = if Path::new(raw_path).is_absolute() {
        PathBuf::from(raw_path)
    } else {
        workspace.join(raw_path)
    };
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| format!("path not accessible: {raw_path}: {error}"))?;
    ensure_workspace_path(workspace, &canonical)?;
    ensure_not_sensitive(workspace, raw_path, &canonical)?;
    Ok(canonical)
}

fn resolve_target_path(workspace: &Path, raw_path: &str) -> Result<PathBuf, String> {
    if raw_path.trim().is_empty() {
        return Err("path must not be empty".to_string());
    }
    let candidate = if Path::new(raw_path).is_absolute() {
        PathBuf::from(raw_path)
    } else {
        workspace.join(raw_path)
    };
    let normalized = normalize_lexical(&candidate)?;
    ensure_workspace_path(workspace, &normalized)?;
    ensure_not_sensitive(workspace, raw_path, &normalized)?;

    if normalized.exists() {
        let canonical = fs::canonicalize(&normalized)
            .map_err(|error| format!("path not accessible: {raw_path}: {error}"))?;
        ensure_workspace_path(workspace, &canonical)?;
        ensure_not_sensitive(workspace, raw_path, &canonical)?;
        return Ok(canonical);
    }

    if let Some(parent) = normalized.parent() {
        let existing_parent = nearest_existing_parent(parent)?;
        let canonical_parent = fs::canonicalize(&existing_parent).map_err(|error| {
            format!(
                "parent path not accessible: {}: {error}",
                existing_parent.display()
            )
        })?;
        ensure_workspace_path(workspace, &canonical_parent)?;
    }
    Ok(normalized)
}

fn nearest_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = path.to_path_buf();
    loop {
        if current.exists() {
            return Ok(current);
        }
        if !current.pop() {
            return Err(format!("no existing parent for path: {}", path.display()));
        }
    }
}

fn normalize_lexical(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("path escapes its root: {}", path.display()));
                }
            }
        }
    }
    Ok(normalized)
}

fn ensure_workspace_path(workspace: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(workspace) {
        Ok(())
    } else {
        Err(format!(
            "native Pi tools can only access files inside the workspace: {}",
            workspace.display()
        ))
    }
}

fn is_sensitive_component_name(name: &str) -> bool {
    let sensitive_exact = matches!(
        name,
        ".ssh"
            | ".gnupg"
            | ".aws"
            | ".env"
            | ".env.local"
            | ".env.development"
            | ".env.production"
            | ".npmrc"
            | ".netrc"
            | "id_rsa"
            | "id_dsa"
            | "id_ecdsa"
            | "id_ed25519"
    );
    let sensitive_substring = [
        "secret",
        "secrets",
        "credential",
        "credentials",
        "token",
        "tokens",
        "private-key",
    ]
    .iter()
    .any(|needle| name.contains(needle));
    sensitive_exact || sensitive_substring
}

fn is_sensitive_path(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(component, Component::Normal(_))
            && is_sensitive_component_name(&component.as_os_str().to_string_lossy().to_lowercase())
    })
}

fn is_sensitive_tool_path(workspace: &Path, raw_path: &str, path: &Path) -> bool {
    let raw = Path::new(raw_path);
    let raw_relative = if raw.is_absolute() {
        raw.strip_prefix(workspace).unwrap_or(raw)
    } else {
        raw
    };
    let canonical_relative = path.strip_prefix(workspace).unwrap_or(path);
    is_sensitive_path(raw_relative) || is_sensitive_path(canonical_relative)
}

fn ensure_not_sensitive(workspace: &Path, raw_path: &str, path: &Path) -> Result<(), String> {
    if is_sensitive_tool_path(workspace, raw_path, path) {
        return Err(format!("native Pi tool refused sensitive path: {raw_path}"));
    }
    Ok(())
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

fn merge_details(mut base: Value, extra: Value) -> Value {
    if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    base
}

fn execute_read(workspace: &Path, input: ToolInput<'_>) -> Result<NativeToolResult, String> {
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
        merge_details(
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

fn execute_ls(workspace: &Path, input: ToolInput<'_>) -> Result<NativeToolResult, String> {
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
        merge_details(
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

fn execute_grep(workspace: &Path, input: ToolInput<'_>) -> Result<NativeToolResult, String> {
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
        merge_details(
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

fn execute_find(workspace: &Path, input: ToolInput<'_>) -> Result<NativeToolResult, String> {
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
        merge_details(
            json!({
                "matches": hits.len(),
                "resultLimitReached": if truncated { limit } else { 0 },
                "mediatedBy": "rust"
            }),
            truncation,
        ),
    ))
}

fn execute_bash(
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
    let details = merge_details(
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

fn execute_edit(workspace: &Path, input: ToolInput<'_>) -> Result<NativeToolResult, String> {
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

fn execute_write(workspace: &Path, input: ToolInput<'_>) -> Result<NativeToolResult, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request(cwd: &Path, tool_name: &str, input: Value) -> NativeToolRequest {
        NativeToolRequest {
            session_id: "pi-test".to_string(),
            tool_call_id: "call-test".to_string(),
            tool_name: tool_name.to_string(),
            cwd: cwd.to_string_lossy().into_owned(),
            workspace_env: None,
            input,
        }
    }

    fn first_text(result: NativeToolResult) -> String {
        result.content.into_iter().next().unwrap().text
    }

    #[test]
    fn read_is_workspace_scoped_and_truncated_by_lines() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("note.txt"), "one\ntwo\nthree").unwrap();
        fs::write(root.path().join("note.txt"), "outside").unwrap();

        let result = execute(request(
            &workspace,
            "read",
            json!({ "path": "note.txt", "offset": 2, "limit": 1 }),
        ))
        .unwrap();

        assert_eq!(first_text(result), "two");
        let outside = execute(request(
            &workspace,
            "read",
            json!({ "path": "../note.txt" }),
        ))
        .unwrap_err();
        assert!(outside.contains("inside the workspace"), "{outside}");
    }

    #[test]
    fn read_refuses_sensitive_paths() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".env"), "TOKEN=secret").unwrap();

        let error = execute(request(dir.path(), "read", json!({ "path": ".env" }))).unwrap_err();

        assert!(error.contains("sensitive path"), "{error}");
    }

    #[test]
    fn read_refuses_sensitive_directories() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = dir.path().join("secrets");
        fs::create_dir(&secrets).unwrap();
        fs::write(secrets.join("note.txt"), "hidden").unwrap();

        let error = execute(request(
            dir.path(),
            "read",
            json!({ "path": "secrets/note.txt" }),
        ))
        .unwrap_err();

        assert!(error.contains("sensitive path"), "{error}");
    }

    #[test]
    fn ls_skips_sensitive_entries() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("public.txt"), "public").unwrap();
        fs::write(dir.path().join(".env"), "TOKEN=secret").unwrap();
        fs::create_dir(dir.path().join("credentials")).unwrap();

        let result = execute(request(dir.path(), "ls", json!({ "path": "." }))).unwrap();
        let text = first_text(result);

        assert!(text.contains("public.txt"), "{text}");
        assert!(!text.contains(".env"), "{text}");
        assert!(!text.contains("credentials"), "{text}");
    }

    #[test]
    fn grep_skips_sensitive_files_inside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("public.txt"), "needle in public").unwrap();
        fs::write(dir.path().join("tokens.json"), "needle in secret").unwrap();
        fs::create_dir(dir.path().join("secrets")).unwrap();
        fs::write(dir.path().join("secrets/note.txt"), "needle in dir").unwrap();

        let result = execute(request(
            dir.path(),
            "grep",
            json!({ "pattern": "needle", "path": "." }),
        ))
        .unwrap();
        let text = first_text(result);

        assert!(text.contains("public.txt"), "{text}");
        assert!(!text.contains("tokens.json"), "{text}");
        assert!(!text.contains("secrets/note.txt"), "{text}");
    }

    #[test]
    fn find_skips_sensitive_files_inside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("public.txt"), "public").unwrap();
        fs::write(dir.path().join("tokens.json"), "secret").unwrap();
        fs::create_dir(dir.path().join("secrets")).unwrap();
        fs::write(dir.path().join("secrets/note.txt"), "secret").unwrap();

        let result = execute(request(
            dir.path(),
            "find",
            json!({ "pattern": "*", "path": "." }),
        ))
        .unwrap();
        let text = first_text(result);

        assert!(text.contains("public.txt"), "{text}");
        assert!(!text.contains("tokens.json"), "{text}");
        assert!(!text.contains("secrets/note.txt"), "{text}");
    }

    #[test]
    fn bash_refuses_wsl_workspace_env_until_wsl_execution_is_wired() {
        let dir = tempfile::tempdir().unwrap();

        let error = execute(NativeToolRequest {
            session_id: "pi-wsl".to_string(),
            tool_call_id: "call-bash".to_string(),
            tool_name: "bash".to_string(),
            cwd: dir.path().to_string_lossy().into_owned(),
            workspace_env: Some(WorkspaceEnv::Wsl {
                distro: "Ubuntu-24.04".to_string(),
            }),
            input: json!({ "command": "pwd" }),
        })
        .unwrap_err();

        assert!(error.contains("disabled for WSL workspaces"), "{error}");
    }

    #[test]
    fn edit_applies_unique_non_overlapping_replacements() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        fs::write(&path, "alpha beta gamma").unwrap();

        execute(request(
            dir.path(),
            "edit",
            json!({
                "path": "note.txt",
                "edits": [{ "oldText": "beta", "newText": "BETA" }]
            }),
        ))
        .unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "alpha BETA gamma");
    }

    #[test]
    fn write_creates_missing_workspace_parents() {
        let dir = tempfile::tempdir().unwrap();

        execute(request(
            dir.path(),
            "write",
            json!({ "path": "nested/note.txt", "content": "hello" }),
        ))
        .unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("nested/note.txt")).unwrap(),
            "hello"
        );
    }
}
