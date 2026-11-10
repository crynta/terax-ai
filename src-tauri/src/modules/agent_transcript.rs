//! Reads Claude Code session transcripts (`~/.claude/projects/*/<id>.jsonl`)
//! for the Session Reader.
//!
//! The frontend only ever names a session by its UUID (learned from the
//! agent's hook via the PTY, which is untrusted); this module resolves the file
//! itself and never opens a caller-supplied path. Reads are line-aligned windows
//! projected to compact entries: bookkeeping lines (API request blobs, file
//! snapshots, cost state) are skipped before parsing, and long text is capped.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;

/// First read: the last 2 MiB, enough for the recent turns of a long session.
const TAIL_BYTES: u64 = 2 * 1024 * 1024;
/// Every later forward or backward page.
const PAGE_BYTES: u64 = 1024 * 1024;
const TEXT_CAP: usize = 64 * 1024;
const RESULT_CAP: usize = 16 * 1024;
const INPUT_CAP: usize = 16 * 1024;
const SYSTEM_CAP: usize = 4 * 1024;

/// Top-level line types whose JSON starts with their `type` key and that the
/// reader never shows; matched on raw bytes so megabyte blobs are never parsed.
const LEADING_TYPE: &[u8] = b"{\"type\":\"";
const KEEP_LEADING: &[&[u8]] = &[b"ai-title\""];

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
    /// A pasted image; `index` is its ordinal among the entry's images, for
    /// fetching the pixels later with `agent_transcript_image`.
    Image {
        index: usize,
    },
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUseResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub interrupted: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// `user`, `assistant`, `system` or `title`.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_sidechain: bool,
    /// Injected context (reminders, command output) rather than a real prompt.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_meta: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<Block>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_result: Option<ToolUseResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_duration_ms: Option<u64>,
    /// `system` subtype, or the session title for `title`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Byte offset of this entry's line, set only when it carries images.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_offset: Option<u64>,
    /// The model that wrote an assistant message, e.g. `claude-opus-5-5`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Token counts of an assistant message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
}

fn usage(message: Option<&Value>) -> Option<Usage> {
    let usage = message?.get("usage")?;
    let n = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
    Some(Usage {
        input_tokens: n("input_tokens"),
        output_tokens: n("output_tokens"),
        cache_read_input_tokens: n("cache_read_input_tokens"),
        cache_creation_input_tokens: n("cache_creation_input_tokens"),
    })
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub entries: Vec<Entry>,
    /// Byte offset where this page's first complete line starts.
    pub start_offset: u64,
    /// Byte offset just past this page's last complete line.
    pub next_offset: u64,
    pub size: u64,
    /// The file shrank or was replaced; the caller should drop what it has.
    pub reset: bool,
}

/// A canonical 8-4-4-4-12 hex UUID, the only form a session id may take.
pub fn is_session_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// Claude's project folder name for a cwd: every non-alphanumeric byte is `-`.
pub fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn projects_root() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".claude")
        .join("projects"))
}

fn path_cache() -> &'static Mutex<HashMap<String, PathBuf>> {
    static CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Finds `<root>/<project>/<id>.jsonl` as a regular file inside `root`.
fn resolve_in(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_session_id(id) {
        return Err("invalid session id".into());
    }
    let canonical_root =
        std::fs::canonicalize(root).map_err(|e| format!("open {}: {e}", root.display()))?;
    let file_name = format!("{id}.jsonl");
    let entries =
        std::fs::read_dir(&canonical_root).map_err(|e| format!("read {}: {e}", root.display()))?;
    for entry in entries.flatten() {
        let candidate = entry.path().join(&file_name);
        let Ok(meta) = std::fs::symlink_metadata(&candidate) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let Ok(real) = std::fs::canonicalize(&candidate) else {
            continue;
        };
        if real.starts_with(&canonical_root) {
            return Ok(real);
        }
    }
    Err(format!("no transcript for session {id}"))
}

fn resolve(id: &str) -> Result<PathBuf, String> {
    if let Some(path) = path_cache().lock().unwrap().get(id) {
        if path.is_file() {
            return Ok(path.clone());
        }
    }
    let path = resolve_in(&projects_root()?, id)?;
    path_cache()
        .lock()
        .unwrap()
        .insert(id.to_string(), path.clone());
    Ok(path)
}

/// The newest transcript in `cwd`'s project folder modified at or after
/// `since_ms` (Unix epoch milliseconds), skipping `exclude` (sessions other
/// panes already own); for sessions whose hooks never reported an id.
fn find_latest_in(root: &Path, cwd: &str, since_ms: u64, exclude: &[String]) -> Option<String> {
    let dir = root.join(encode_project_dir(cwd));
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_session_id(id) || exclude.iter().any(|e| e == id) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else {
            continue;
        };
        let modified_ms = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        if modified_ms < since_ms {
            continue;
        }
        if best.as_ref().is_none_or(|(t, _)| modified > *t) {
            best = Some((modified, id.to_string()));
        }
    }
    best.map(|(_, id)| id)
}

/// Reads one page of `path`. `offset` continues forward from a previous
/// `next_offset`; `before` pages backwards from a previous `start_offset`;
/// neither reads the tail.
fn read_page(
    path: &Path,
    offset: Option<u64>,
    before: Option<u64>,
) -> Result<TranscriptPage, String> {
    let mut file = File::open(path).map_err(|e| format!("open transcript: {e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("stat transcript: {e}"))?
        .len();
    let mut reset = false;
    let (start, end, aligned_start) = match (offset, before) {
        (_, Some(before)) => {
            let before = before.min(size);
            (
                before.saturating_sub(PAGE_BYTES),
                before,
                before <= PAGE_BYTES,
            )
        }
        (Some(offset), None) if offset <= size => (offset, (offset + PAGE_BYTES).min(size), true),
        (Some(_), None) => {
            reset = true;
            (size.saturating_sub(TAIL_BYTES), size, size <= TAIL_BYTES)
        }
        (None, None) => (size.saturating_sub(TAIL_BYTES), size, size <= TAIL_BYTES),
    };
    let mut buf = vec![0; (end - start) as usize];
    file.seek(SeekFrom::Start(start))
        .and_then(|_| file.read_exact(&mut buf))
        .map_err(|e| format!("read transcript: {e}"))?;

    // A window that starts mid-line drops the partial first line.
    let first = if aligned_start {
        0
    } else {
        memchr::memchr(b'\n', &buf).map_or(buf.len(), |i| i + 1)
    };
    // Only complete lines count; the tail of a line still being written waits.
    let last = match memchr::memrchr(b'\n', &buf) {
        Some(i) if i + 1 >= first => i + 1,
        _ => first,
    };
    let mut entries = Vec::new();
    let mut line_start = start + first as u64;
    for line in buf[first..last].split(|&b| b == b'\n') {
        if let Some(mut entry) = parse_line(line) {
            if entry
                .blocks
                .iter()
                .any(|b| matches!(b, Block::Image { .. }))
            {
                entry.line_offset = Some(line_start);
            }
            entries.push(entry);
        }
        line_start += line.len() as u64 + 1;
    }
    let mut start_offset = start + first as u64;
    let mut next_offset = start + last as u64;
    // The window lies inside one line longer than a page (a prompt carrying
    // pasted screenshots): read that line on its own instead of dropping it.
    if last == first && !buf.is_empty() {
        match (offset, before) {
            (_, Some(before)) if start > 0 => {
                let line_start = line_start_before(&mut file, before)?;
                entries.extend(read_long_line(&mut file, line_start, before)?);
                start_offset = line_start;
            }
            (Some(_), None) => {
                // Forward offsets are line starts; a line still being written
                // has no newline yet and is retried on the next poll.
                if let Some(line_end) = find_line_end(&mut file, start, size)? {
                    entries.extend(read_long_line(&mut file, start, line_end)?);
                    next_offset = line_end;
                }
            }
            (None, None) if start > 0 => {
                if let Some(i) = memchr::memrchr(b'\n', &buf) {
                    let line_end = start + i as u64 + 1;
                    let line_start = line_start_before(&mut file, line_end)?;
                    entries.extend(read_long_line(&mut file, line_start, line_end)?);
                    start_offset = line_start;
                    next_offset = line_end;
                } else {
                    // Only an unfinished line: start before it and wait.
                    let line_start = line_start_before(&mut file, start + 1)?;
                    start_offset = line_start;
                    next_offset = line_start;
                }
            }
            _ => {}
        }
    }
    Ok(TranscriptPage {
        entries,
        start_offset,
        next_offset: if before.is_some() { end } else { next_offset },
        size,
        reset,
    })
}

/// Offset just past the next newline at or after `from`, or `size`.
fn skip_line(file: &mut File, from: u64, size: u64) -> Result<u64, String> {
    Ok(find_line_end(file, from, size)?.unwrap_or(size))
}

/// Offset just past the next newline at or after `from`, or `None` while the
/// line is still being written.
fn find_line_end(file: &mut File, from: u64, size: u64) -> Result<Option<u64>, String> {
    let mut pos = from;
    let mut chunk = vec![0; 64 * 1024];
    file.seek(SeekFrom::Start(pos))
        .map_err(|e| format!("seek transcript: {e}"))?;
    while pos < size {
        let n = file
            .read(&mut chunk)
            .map_err(|e| format!("read transcript: {e}"))?;
        if n == 0 {
            break;
        }
        if let Some(i) = memchr::memchr(b'\n', &chunk[..n]) {
            return Ok(Some(pos + i as u64 + 1));
        }
        pos += n as u64;
    }
    Ok(None)
}

/// Start of the line that ends at `line_end` (just past its newline): the
/// offset after the previous newline, or 0.
fn line_start_before(file: &mut File, line_end: u64) -> Result<u64, String> {
    // Skip the line's own terminating newline.
    let mut pos = line_end.saturating_sub(1);
    let mut chunk = vec![0; 64 * 1024];
    while pos > 0 {
        let from = pos.saturating_sub(chunk.len() as u64);
        let len = (pos - from) as usize;
        file.seek(SeekFrom::Start(from))
            .and_then(|_| file.read_exact(&mut chunk[..len]))
            .map_err(|e| format!("read transcript: {e}"))?;
        if let Some(i) = memchr::memrchr(b'\n', &chunk[..len]) {
            return Ok(from + i as u64 + 1);
        }
        pos = from;
    }
    Ok(0)
}

/// The entry of the single line `[line_start, line_end)`, read whole only
/// when it is a shown type within `IMAGE_LINE_CAP`; bookkeeping blobs are
/// judged on their first bytes and never read in full.
fn read_long_line(
    file: &mut File,
    line_start: u64,
    line_end: u64,
) -> Result<Option<Entry>, String> {
    let len = line_end.saturating_sub(line_start);
    if len == 0 || len > IMAGE_LINE_CAP {
        return Ok(None);
    }
    let mut head = [0u8; 64];
    let head_len = (len as usize).min(head.len());
    file.seek(SeekFrom::Start(line_start))
        .and_then(|_| file.read_exact(&mut head[..head_len]))
        .map_err(|e| format!("read transcript: {e}"))?;
    if let Some(rest) = head[..head_len].strip_prefix(LEADING_TYPE) {
        if !KEEP_LEADING.iter().any(|keep| rest.starts_with(keep)) {
            return Ok(None);
        }
    }
    let mut line = vec![0; len as usize];
    file.seek(SeekFrom::Start(line_start))
        .and_then(|_| file.read_exact(&mut line))
        .map_err(|e| format!("read transcript: {e}"))?;
    let Some(mut entry) = parse_line(line.trim_ascii_end()) else {
        return Ok(None);
    };
    if entry
        .blocks
        .iter()
        .any(|b| matches!(b, Block::Image { .. }))
    {
        entry.line_offset = Some(line_start);
    }
    Ok(Some(entry))
}

fn parse_line(line: &[u8]) -> Option<Entry> {
    if line.is_empty() {
        return None;
    }
    if let Some(rest) = line.strip_prefix(LEADING_TYPE) {
        if !KEEP_LEADING.iter().any(|keep| rest.starts_with(keep)) {
            return None;
        }
    }
    let value: Value = serde_json::from_slice(line).ok()?;
    let kind = match value.get("type")?.as_str()? {
        "user" => "user",
        "assistant" => "assistant",
        "system" => "system",
        "ai-title" => {
            let title = value.get("aiTitle")?.as_str()?;
            return Some(Entry {
                kind: "title",
                text: Some(cap(title, SYSTEM_CAP)),
                ..empty_entry("title")
            });
        }
        _ => return None,
    };
    let mut entry = Entry {
        uuid: str_field(&value, "uuid"),
        parent_uuid: str_field(&value, "parentUuid"),
        timestamp: str_field(&value, "timestamp"),
        is_sidechain: value.get("isSidechain").and_then(Value::as_bool) == Some(true),
        is_meta: value.get("isMeta").and_then(Value::as_bool) == Some(true),
        ..empty_entry(kind)
    };
    match kind {
        "system" => {
            entry.subtype = str_field(&value, "subtype");
            entry.text = value
                .get("content")
                .and_then(Value::as_str)
                .map(|s| cap(s, SYSTEM_CAP));
        }
        _ => {
            entry.blocks = blocks(value.get("message").and_then(|m| m.get("content")));
            entry.thinking_duration_ms = value.get("thinkingDurationMs").and_then(Value::as_u64);
            entry.tool_use_result = value.get("toolUseResult").and_then(tool_use_result);
            if kind == "assistant" {
                let message = value.get("message");
                entry.model = message
                    .and_then(|m| m.get("model"))
                    .and_then(Value::as_str)
                    .filter(|m| m.len() <= 80 && *m != "<synthetic>")
                    .map(str::to_string);
                entry.usage = usage(message);
            }
        }
    }
    Some(entry)
}

fn empty_entry(kind: &'static str) -> Entry {
    Entry {
        kind,
        uuid: None,
        parent_uuid: None,
        timestamp: None,
        is_sidechain: false,
        is_meta: false,
        blocks: Vec::new(),
        tool_use_result: None,
        thinking_duration_ms: None,
        subtype: None,
        text: None,
        line_offset: None,
        model: None,
        usage: None,
    }
}

fn str_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn blocks(content: Option<&Value>) -> Vec<Block> {
    match content {
        Some(Value::String(text)) => vec![Block::Text {
            text: cap(text, TEXT_CAP),
        }],
        Some(Value::Array(items)) => {
            let mut images = 0;
            items
                .iter()
                .filter_map(|item| block(item, &mut images))
                .collect()
        }
        _ => Vec::new(),
    }
}

fn block(item: &Value, images: &mut usize) -> Option<Block> {
    match item.get("type")?.as_str()? {
        "text" => Some(Block::Text {
            text: cap(item.get("text")?.as_str()?, TEXT_CAP),
        }),
        "thinking" => Some(Block::Thinking {
            text: cap(
                item.get("thinking").and_then(Value::as_str).unwrap_or(""),
                TEXT_CAP,
            ),
        }),
        "tool_use" => Some(Block::ToolUse {
            id: item.get("id")?.as_str()?.to_string(),
            name: item.get("name")?.as_str()?.to_string(),
            input: cap_value(item.get("input").cloned().unwrap_or(Value::Null), INPUT_CAP),
        }),
        "tool_result" => Some(Block::ToolResult {
            tool_use_id: item.get("tool_use_id")?.as_str()?.to_string(),
            content: cap(&result_text(item.get("content")), RESULT_CAP),
            is_error: item.get("is_error").and_then(Value::as_bool) == Some(true),
        }),
        "image" => {
            let index = *images;
            *images += 1;
            Some(Block::Image { index })
        }
        _ => None,
    }
}

/// A tool result's text: a plain string, or the text parts of a block list.
fn result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn tool_use_result(value: &Value) -> Option<ToolUseResult> {
    let obj = value.as_object()?;
    let get = |key: &str, limit: usize| obj.get(key).and_then(Value::as_str).map(|s| cap(s, limit));
    let file_path = get("filePath", SYSTEM_CAP).or_else(|| {
        obj.get("file")
            .and_then(|f| f.get("filePath"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let result = ToolUseResult {
        file_path,
        old_string: get("oldString", TEXT_CAP),
        new_string: get("newString", TEXT_CAP),
        stdout: get("stdout", RESULT_CAP),
        stderr: get("stderr", RESULT_CAP),
        interrupted: obj.get("interrupted").and_then(Value::as_bool) == Some(true),
    };
    (result != ToolUseResult::default()).then_some(result)
}

/// `s` cut to at most `max` bytes on a char boundary, marked when cut.
fn cap(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

/// Caps every string inside a tool input so one huge argument (a whole file
/// passed to Write) cannot blow up the page.
fn cap_value(value: Value, max: usize) -> Value {
    match value {
        Value::String(s) => Value::String(cap(&s, max)),
        Value::Array(items) => Value::Array(items.into_iter().map(|v| cap_value(v, max)).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, cap_value(v, max)))
                .collect(),
        ),
        other => other,
    }
}

#[tauri::command]
pub async fn agent_transcript_open(session_id: String) -> Result<u64, String> {
    super::fs::blocking(move || {
        let path = resolve(&session_id)?;
        std::fs::metadata(path)
            .map(|m| m.len())
            .map_err(|e| format!("stat transcript: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn agent_transcript_read(
    session_id: String,
    offset: Option<u64>,
    before: Option<u64>,
) -> Result<TranscriptPage, String> {
    super::fs::blocking(move || read_page(&resolve(&session_id)?, offset, before)).await
}

#[tauri::command]
pub async fn agent_transcript_find(
    cwd: String,
    since_ms: u64,
    exclude: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let exclude = exclude.unwrap_or_default();
    super::fs::blocking(move || Ok(find_latest_in(&projects_root()?, &cwd, since_ms, &exclude))).await
}

/// Longest transcript line an image is read from (pasted screenshots are
/// base64 inside the prompt's line).
const IMAGE_LINE_CAP: u64 = 24 * 1024 * 1024;
/// Largest base64 payload returned (about 9 MiB of image).
const IMAGE_DATA_CAP: usize = 12 * 1024 * 1024;
const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptImage {
    pub media_type: String,
    /// Base64 pixels, checked to hold only base64 characters.
    pub data: String,
}

/// The `index`-th image of the line starting at `offset` (a `line_offset`
/// from a previous page).
fn read_image(path: &Path, offset: u64, index: usize) -> Result<TranscriptImage, String> {
    let mut file = File::open(path).map_err(|e| format!("open transcript: {e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("stat transcript: {e}"))?
        .len();
    if offset >= size {
        return Err("image line is past the end of the transcript".into());
    }
    let end = skip_line(&mut file, offset, size)?;
    if end - offset > IMAGE_LINE_CAP {
        return Err("image line is too large".into());
    }
    let mut buf = vec![0; (end - offset) as usize];
    file.seek(SeekFrom::Start(offset))
        .and_then(|_| file.read_exact(&mut buf))
        .map_err(|e| format!("read transcript: {e}"))?;
    let value: Value = serde_json::from_slice(buf.trim_ascii_end())
        .map_err(|_| "not a transcript line".to_string())?;
    let source = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("image"))
                .nth(index)
        })
        .and_then(|item| item.get("source"))
        .ok_or_else(|| "no such image".to_string())?;
    if source.get("type").and_then(Value::as_str) != Some("base64") {
        return Err("image is not embedded".into());
    }
    let media_type = source
        .get("media_type")
        .and_then(Value::as_str)
        .filter(|t| IMAGE_TYPES.contains(t))
        .ok_or_else(|| "unsupported image type".to_string())?;
    let data = source
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| "image has no data".to_string())?;
    if data.len() > IMAGE_DATA_CAP {
        return Err("image is too large".into());
    }
    if !data
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
    {
        return Err("image data is not base64".into());
    }
    Ok(TranscriptImage {
        media_type: media_type.to_string(),
        data: data.to_string(),
    })
}

#[tauri::command]
pub async fn agent_transcript_image(
    session_id: String,
    offset: u64,
    index: usize,
) -> Result<TranscriptImage, String> {
    super::fs::blocking(move || read_image(&resolve(&session_id)?, offset, index)).await
}

/// Largest image the Reader's composer may save for a prompt.
const PASTED_IMAGE_CAP: usize = 12 * 1024 * 1024;
/// Pasted images older than this are removed whenever a new one is saved.
const PASTED_IMAGE_TTL: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

/// The file extension for `media_type` when `bytes` really are that format.
fn pasted_image_extension(media_type: &str, bytes: &[u8]) -> Option<&'static str> {
    let (ext, ok) = match media_type {
        "image/png" => ("png", bytes.starts_with(b"\x89PNG\r\n\x1a\n")),
        "image/jpeg" => ("jpg", bytes.starts_with(b"\xff\xd8\xff")),
        "image/gif" => (
            "gif",
            bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        ),
        "image/webp" => (
            "webp",
            bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        ),
        _ => return None,
    };
    ok.then_some(ext)
}

/// Writes a pasted image under `dir` with a random name and returns its path;
/// expired images in `dir` are removed first.
fn save_pasted_image_in(dir: &Path, media_type: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > PASTED_IMAGE_CAP {
        return Err("image must be between 1 byte and 12 MiB".into());
    }
    let ext = pasted_image_extension(media_type, bytes)
        .ok_or_else(|| "only PNG, JPEG, GIF and WebP images can be attached".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create image folder: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("secure image folder: {e}"))?;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let expired = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > PASTED_IMAGE_TTL);
            if expired {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).map_err(|e| format!("name image: {e}"))?;
    let name: String = id.iter().map(|b| format!("{b:02x}")).collect();
    let path = dir.join(format!("{name}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| format!("save image: {e}"))?;
    Ok(path)
}

/// Saves an image pasted into the Reader's composer and returns its absolute
/// path, which the prompt then names so Claude Code attaches the image. The
/// pixels arrive as the raw request body and the type in `x-terax-image-type`.
#[tauri::command]
pub async fn agent_save_pasted_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let media_type = request
        .headers()
        .get("x-terax-image-type")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 32)
        .ok_or("missing image type")?
        .to_string();
    let bytes = super::ipc_body::bytes_of(
        request.body(),
        PASTED_IMAGE_CAP,
        super::ipc_body::JSON_FALLBACK_MAX_BYTES,
    )?
    .into_owned();
    let dir = dirs::cache_dir()
        .ok_or("could not resolve the user cache directory")?
        .join("terax")
        .join("pasted-images");
    super::fs::blocking(move || {
        save_pasted_image_in(&dir, &media_type, &bytes).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// The image type an extension claims, for the formats the composer accepts.
fn media_type_for_extension(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Copies an image file dropped on the composer into `dir` (the pasted-images
/// cache): it must be a regular file of at most 12 MiB whose extension matches
/// its actual format.
fn save_dropped_image_in(dir: &Path, source: &Path) -> Result<PathBuf, String> {
    if !source.is_absolute() {
        return Err("dropped image path must be absolute".into());
    }
    let media_type = source
        .extension()
        .and_then(|e| e.to_str())
        .and_then(media_type_for_extension)
        .ok_or_else(|| "only PNG, JPEG, GIF and WebP images can be attached".to_string())?;
    let meta = std::fs::metadata(source).map_err(|e| format!("read dropped image: {e}"))?;
    if !meta.is_file() {
        return Err("dropped image is not a regular file".into());
    }
    if meta.len() == 0 || meta.len() > PASTED_IMAGE_CAP as u64 {
        return Err("image must be between 1 byte and 12 MiB".into());
    }
    let bytes = std::fs::read(source).map_err(|e| format!("read dropped image: {e}"))?;
    if pasted_image_extension(media_type, &bytes).is_none() {
        return Err("the file's contents don't match its image type".into());
    }
    save_pasted_image_in(dir, media_type, &bytes)
}

/// Copies an image dropped on the Reader's composer into the pasted-images
/// cache and returns the cached path, so the prompt can name it like a paste.
#[tauri::command]
pub async fn agent_save_pasted_image_from_path(path: String) -> Result<String, String> {
    let dir = dirs::cache_dir()
        .ok_or("could not resolve the user cache directory")?
        .join("terax")
        .join("pasted-images");
    super::fs::blocking(move || {
        save_dropped_image_in(&dir, Path::new(&path)).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Largest context attachment written for a prompt (a capped diff or log).
const CONTEXT_CAP: usize = 256 * 1024;

/// Writes `text` to an owner-only cache file and returns its path, so a prompt
/// can point Claude at a large attachment instead of pasting it.
fn save_context_in(dir: &Path, text: &str) -> Result<PathBuf, String> {
    if text.is_empty() || text.len() > CONTEXT_CAP {
        return Err("context must be between 1 byte and 256 KiB".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("create context folder: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("secure context folder: {e}"))?;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let expired = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > PASTED_IMAGE_TTL);
            if expired {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).map_err(|e| format!("name context: {e}"))?;
    let name: String = id.iter().map(|b| format!("{b:02x}")).collect();
    let path = dir.join(format!("{name}.md"));
    std::fs::write(&path, text).map_err(|e| format!("save context: {e}"))?;
    Ok(path)
}

/// Saves a chat context attachment (a diff, terminal output or past-chat
/// summary) and returns its absolute path for the prompt to reference.
#[tauri::command]
pub async fn agent_save_context(text: String) -> Result<String, String> {
    let dir = dirs::cache_dir()
        .ok_or("could not resolve the user cache directory")?
        .join("terax")
        .join("context");
    super::fs::blocking(move || {
        save_context_in(&dir, &text).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Bytes read from a transcript's start for its first prompt, and from its end
/// for its latest title.
const SUMMARY_HEAD_BYTES: u64 = 512 * 1024;
const SUMMARY_TAIL_BYTES: u64 = 256 * 1024;
/// A line longer than this (a prompt carrying screenshots) is not parsed.
const SUMMARY_LINE_MAX: usize = 256 * 1024;
const SUMMARY_PROMPT_CHARS: usize = 200;
const LIST_MAX: usize = 100;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSummary {
    pub session_id: String,
    pub modified_ms: u64,
    pub size: u64,
    pub title: Option<String>,
    /// A name set with Claude's `/rename` (a `custom-title` line), if any.
    pub custom_title: Option<String>,
    pub first_prompt: Option<String>,
    /// Prompts typed in the session (tool results and meta lines excluded).
    pub turns: Option<u32>,
}

/// Transcripts larger than this are listed without a turn count.
const TURN_COUNT_MAX_BYTES: u64 = 128 * 1024 * 1024;

/// Turn counts by path: (size, mtime ms, turns).
type TurnCache = Mutex<HashMap<PathBuf, (u64, u64, u32)>>;

/// Turn counts by path, kept while the file's size and mtime are unchanged.
fn turn_cache() -> &'static TurnCache {
    static CACHE: OnceLock<TurnCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Whether a raw transcript line is a prompt the user typed. Lines too long to
/// parse cheaply (a prompt carrying screenshots) are judged by their markers.
fn is_prompt_line(line: &[u8]) -> bool {
    if line.is_empty() || !contains(line, b"\"type\":\"user\"") {
        return false;
    }
    if line.len() > SUMMARY_LINE_MAX {
        return !contains(line, b"\"tool_result\"") && !contains(line, b"\"isMeta\":true");
    }
    serde_json::from_slice::<Value>(line)
        .ok()
        .and_then(|v| prompt_text(&v))
        .is_some()
}

fn count_turns(path: &Path, size: u64, modified_ms: u64) -> Option<u32> {
    if size > TURN_COUNT_MAX_BYTES {
        return None;
    }
    if let Some(&(s, m, n)) = turn_cache().lock().ok()?.get(path) {
        if s == size && m == modified_ms {
            return Some(n);
        }
    }
    let mut reader = std::io::BufReader::with_capacity(1 << 20, File::open(path).ok()?);
    let mut line = Vec::new();
    let mut turns = 0u32;
    loop {
        line.clear();
        match std::io::BufRead::read_until(&mut reader, b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) => {
                if is_prompt_line(line.strip_suffix(b"\n").unwrap_or(&line)) {
                    turns += 1;
                }
            }
            Err(_) => return None,
        }
    }
    if let Ok(mut cache) = turn_cache().lock() {
        cache.insert(path.to_path_buf(), (size, modified_ms, turns));
    }
    Some(turns)
}

fn read_window(file: &mut File, start: u64, len: u64) -> Option<Vec<u8>> {
    let mut buf = vec![0; len as usize];
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut read = 0;
    while read < buf.len() {
        match file.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return None,
        }
    }
    buf.truncate(read);
    Some(buf)
}

/// `text` without the `<pasted_content id="…">` / `</pasted_content id="…">`
/// tags Claude Code wraps around pasted text; the pasted text stays.
fn strip_pasted_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let next = [rest.find("<pasted_content"), rest.find("</pasted_content")]
            .into_iter()
            .flatten()
            .min();
        let Some(at) = next else { break };
        out.push_str(&rest[..at]);
        out.push('\n');
        rest = match rest[at..].find('>') {
            Some(end) => &rest[at + end + 1..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// The trimmed text of a user prompt line, or None for tool results, meta
/// lines and slash-command plumbing. Pasted text is unwrapped, so a prompt
/// that opens with a paste still counts.
fn prompt_body(value: &Value) -> Option<String> {
    if value.get("type")?.as_str()? != "user" || value.get("isMeta") == Some(&Value::Bool(true)) {
        return None;
    }
    let text = match value.get("message")?.get("content")? {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let text = strip_pasted_tags(&text);
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') || text.starts_with("Caveat:") {
        return None;
    }
    Some(text.to_string())
}

/// A user prompt on one line, cut for a summary.
fn prompt_text(value: &Value) -> Option<String> {
    let text = prompt_body(value)?;
    let one_line: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(one_line.chars().take(SUMMARY_PROMPT_CHARS).collect())
}

fn summarize(path: &Path, session_id: String, modified_ms: u64, size: u64) -> TranscriptSummary {
    let mut summary = TranscriptSummary {
        session_id,
        modified_ms,
        size,
        title: None,
        custom_title: None,
        first_prompt: None,
        turns: count_turns(path, size, modified_ms),
    };
    let Ok(mut file) = File::open(path) else {
        return summary;
    };
    if let Some(head) = read_window(&mut file, 0, SUMMARY_HEAD_BYTES.min(size)) {
        for line in head.split(|b| *b == b'\n') {
            if line.len() > SUMMARY_LINE_MAX || line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            if let Some(text) = prompt_text(&value) {
                summary.first_prompt = Some(text);
                break;
            }
        }
    }
    let tail_start = size.saturating_sub(SUMMARY_TAIL_BYTES);
    if let Some(tail) = read_window(&mut file, tail_start, size - tail_start) {
        for line in tail.split(|b| *b == b'\n').rev() {
            if summary.title.is_some() && summary.custom_title.is_some() {
                break;
            }
            let ai = contains(line, b"\"ai-title\"");
            let custom = contains(line, b"\"custom-title\"");
            if line.len() > SUMMARY_LINE_MAX || !(ai || custom) {
                continue;
            }
            let Ok(value) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let kind = value.get("type").and_then(Value::as_str);
            let take = |field: &str| {
                value
                    .get(field)
                    .and_then(Value::as_str)
                    .map(|t| t.chars().take(SUMMARY_PROMPT_CHARS).collect::<String>())
            };
            if kind == Some("ai-title") && summary.title.is_none() {
                summary.title = take("aiTitle");
            } else if kind == Some("custom-title") && summary.custom_title.is_none() {
                summary.custom_title = take("customTitle");
            }
        }
    }
    summary
}

/// The Claude sessions recorded for `cwd`, newest first, with each one's
/// latest title and first prompt.
fn list_in(root: &Path, cwd: &str, limit: usize) -> Vec<TranscriptSummary> {
    session_files(root, cwd)
        .into_iter()
        .take(limit.clamp(1, LIST_MAX))
        .map(|(modified_ms, size, id, path)| summarize(&path, id, modified_ms, size))
        .collect()
}

/// Sessions scanned by a search, newest first, and bytes read in total.
const SEARCH_FILES_MAX: usize = 60;
const SEARCH_BYTES_MAX: u64 = 768 * 1024 * 1024;
const SNIPPET_CONTEXT_CHARS: usize = 60;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptMatch {
    pub session_id: String,
    /// The matching prompt, trimmed to the words around the match.
    pub snippet: String,
}

/// A prompt's whole text on one line, without the summary's length cap.
fn full_prompt_text(value: &Value) -> Option<String> {
    let text = prompt_body(value)?;
    Some(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// `text` cut to the words around the first case-insensitive `needle`.
fn snippet_around(text: &str, needle: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let at = lower.find(needle)?;
    // Lowercasing can change byte lengths; map back through char positions.
    let char_at = lower[..at].chars().count();
    let chars: Vec<char> = text.chars().collect();
    let start = char_at.saturating_sub(SNIPPET_CONTEXT_CHARS);
    let end = (char_at + needle.chars().count() + SNIPPET_CONTEXT_CHARS).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    if start > 0 {
        out = format!("…{}", out.trim_start());
    }
    if end < chars.len() {
        out = format!("{}…", out.trim_end());
    }
    Some(out)
}

/// The first prompt in each recent session of `cwd` containing `query`.
fn search_in(root: &Path, cwd: &str, query: &str, limit: usize) -> Vec<TranscriptMatch> {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < 2 {
        return Vec::new();
    }
    let needle_bytes = needle.as_bytes();
    let mut budget = SEARCH_BYTES_MAX;
    let mut out = Vec::new();
    for (_, size, id, path) in session_files(root, cwd).into_iter().take(SEARCH_FILES_MAX) {
        if out.len() >= limit.clamp(1, LIST_MAX) || budget < size {
            break;
        }
        budget -= size;
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let mut reader = std::io::BufReader::with_capacity(1 << 20, file);
        let mut line = Vec::new();
        loop {
            line.clear();
            match std::io::BufRead::read_until(&mut reader, b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if line.len() > SUMMARY_LINE_MAX || !contains(&line, b"\"type\":\"user\"") {
                continue;
            }
            // Cheap reject before parsing: the lowercased bytes must hold the query
            // (JSON escapes aside, which only lose matches on quoted characters).
            if !contains(&line.to_ascii_lowercase(), needle_bytes) {
                continue;
            }
            let Some(text) = serde_json::from_slice::<Value>(&line)
                .ok()
                .and_then(|v| full_prompt_text(&v))
            else {
                continue;
            };
            if let Some(snippet) = snippet_around(&text, &needle) {
                out.push(TranscriptMatch { session_id: id.clone(), snippet });
                break;
            }
        }
    }
    out
}

/// Session transcripts in the project folder of `cwd`: (modified ms, size,
/// id, path), newest first.
fn session_files(root: &Path, cwd: &str) -> Vec<(u64, u64, String, PathBuf)> {
    let dir = root.join(encode_project_dir(cwd));
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(u64, u64, String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_session_id(id) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.file_type().is_file() {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        files.push((modified_ms, meta.len(), id.to_string(), path));
    }
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.2.cmp(&b.2)));
    files
}

#[tauri::command]
pub async fn agent_transcript_list(
    cwd: String,
    limit: Option<usize>,
) -> Result<Vec<TranscriptSummary>, String> {
    super::fs::blocking(move || Ok(list_in(&projects_root()?, &cwd, limit.unwrap_or(30)))).await
}

/// Full-text search over the prompts of `cwd`'s recent sessions.
#[tauri::command]
pub async fn agent_transcript_search(
    cwd: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<TranscriptMatch>, String> {
    super::fs::blocking(move || {
        Ok(search_in(&projects_root()?, &cwd, &query, limit.unwrap_or(20)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "0b5f4c2e-9a1d-4e3b-8c7f-1234567890ab";

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("terax-transcript-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn line(value: Value) -> String {
        format!("{}\n", serde_json::to_string(&value).unwrap())
    }

    fn user(uuid: &str, text: &str) -> String {
        line(
            json!({"parentUuid": null, "isSidechain": false, "type": "user", "uuid": uuid,
            "timestamp": "2026-11-04T10:00:00Z", "message": {"role": "user", "content": text}}),
        )
    }

    fn assistant(uuid: &str, content: Value) -> String {
        line(
            json!({"parentUuid": "u1", "type": "assistant", "uuid": uuid, "thinkingDurationMs": 1200,
            "timestamp": "2026-11-04T10:00:01Z", "message": {"role": "assistant", "content": content}}),
        )
    }

    #[test]
    fn context_files_are_private_named_randomly_and_capped() {
        let dir = temp_root("context").join("context");
        let a = save_context_in(&dir, "diff --git a b").unwrap();
        let b = save_context_in(&dir, "more").unwrap();
        assert_ne!(a, b);
        assert_eq!(a.extension().and_then(|e| e.to_str()), Some("md"));
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "diff --git a b");
        assert!(save_context_in(&dir, "").is_err());
        assert!(save_context_in(&dir, &"x".repeat(CONTEXT_CAP + 1)).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
    }

    #[test]
    fn session_list_is_newest_first_with_titles_and_first_prompts() {
        let root = temp_root("list");
        let cwd = "/Users/a/proj";
        let dir = root.join(encode_project_dir(cwd));
        std::fs::create_dir_all(&dir).unwrap();
        let old = "0b5f4c2e-9a1d-4e3b-8c7f-000000000001";
        let new = "0b5f4c2e-9a1d-4e3b-8c7f-000000000002";
        let meta = line(json!({"type": "user", "isMeta": true, "uuid": "m",
            "message": {"role": "user", "content": "<local-command-caveat>x</local-command-caveat>"}}));
        std::fs::write(
            dir.join(format!("{old}.jsonl")),
            format!("{meta}{}", user("u1", "Fix   the\nflaky test")),
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(
            dir.join(format!("{new}.jsonl")),
            format!(
                "{}{}{}",
                user("u1", "Explain the storage tiers"),
                line(json!({"type": "ai-title", "aiTitle": "Old title", "sessionId": new})),
                line(json!({"type": "ai-title", "aiTitle": "Storage tiers", "sessionId": new})),
            ),
        )
        .unwrap();
        std::fs::write(dir.join("not-a-session.jsonl"), "{}\n").unwrap();
        let list = list_in(&root, cwd, 10);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].session_id, new);
        assert_eq!(list[0].title.as_deref(), Some("Storage tiers"));
        assert_eq!(list[0].first_prompt.as_deref(), Some("Explain the storage tiers"));
        assert_eq!(list[1].session_id, old);
        assert_eq!(list[1].title, None);
        assert_eq!(list[1].first_prompt.as_deref(), Some("Fix the flaky test"));
        assert_eq!(list_in(&root, cwd, 1).len(), 1);
        assert!(list_in(&root, "/nowhere", 10).is_empty());
    }

    #[test]
    fn list_counts_turns_and_reads_a_custom_title() {
        let root = temp_root("list-turns");
        let cwd = "/Users/a/turns";
        let dir = root.join(encode_project_dir(cwd));
        std::fs::create_dir_all(&dir).unwrap();
        let tool_result = line(json!({"type": "user", "uuid": "t",
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]}}));
        let huge = line(json!({"type": "user", "uuid": "big", "message": {"role": "user", "content": [
            {"type": "text", "text": "look at this"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "A".repeat(SUMMARY_LINE_MAX + 10)}}]}}));
        std::fs::write(
            dir.join(format!("{ID}.jsonl")),
            format!(
                "{}{tool_result}{}{huge}{}",
                user("u1", "first"),
                user("u2", "second"),
                line(json!({"type": "custom-title", "customTitle": "My name", "sessionId": ID})),
            ),
        )
        .unwrap();
        let list = list_in(&root, cwd, 10);
        assert_eq!(list[0].turns, Some(3));
        assert_eq!(list[0].custom_title.as_deref(), Some("My name"));
        // Cached on the second call, same answer.
        assert_eq!(list_in(&root, cwd, 10)[0].turns, Some(3));
    }

    #[test]
    fn search_finds_prompt_text_with_a_snippet() {
        let root = temp_root("search");
        let cwd = "/Users/a/search";
        let dir = root.join(encode_project_dir(cwd));
        std::fs::create_dir_all(&dir).unwrap();
        let a = "0b5f4c2e-9a1d-4e3b-8c7f-00000000000a";
        let b = "0b5f4c2e-9a1d-4e3b-8c7f-00000000000b";
        let long = format!("{} explain the Fluss tiering job please {}", "x ".repeat(80), "y ".repeat(80));
        std::fs::write(dir.join(format!("{a}.jsonl")), user("u1", &long)).unwrap();
        std::fs::write(
            dir.join(format!("{b}.jsonl")),
            format!(
                "{}{}",
                user("u1", "unrelated"),
                line(json!({"type": "assistant", "uuid": "a1",
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "fluss tiering"}]}})),
            ),
        )
        .unwrap();
        let hits = search_in(&root, cwd, "FLUSS tiering", 10);
        assert_eq!(hits.len(), 1, "assistant text is not searched");
        assert_eq!(hits[0].session_id, a);
        assert!(hits[0].snippet.contains("Fluss tiering job"));
        assert!(hits[0].snippet.starts_with('…') && hits[0].snippet.ends_with('…'));
        assert!(search_in(&root, cwd, "z", 10).is_empty(), "one-letter queries are ignored");
        assert!(search_in(&root, cwd, "nothing like this", 10).is_empty());
    }

    #[test]
    fn a_prompt_that_opens_with_a_paste_still_counts() {
        let value: Value = serde_json::from_str(&user(
            "u1",
            "\n\n<pasted_content id=\"9f5a\">\n┌──┐ Fluss\n</pasted_content id=\"9f5a\">\nwhy?",
        ))
        .unwrap();
        assert_eq!(prompt_text(&value).as_deref(), Some("┌──┐ Fluss why?"));
        assert_eq!(full_prompt_text(&value).as_deref(), Some("┌──┐ Fluss why?"));
        assert_eq!(strip_pasted_tags("a <pasted_content id=\"1\">cut"), "a \ncut");
    }

    #[test]
    fn snippets_keep_unicode_boundaries() {
        let s = snippet_around("Größe der Datei prüfen", "datei").unwrap();
        assert_eq!(s, "Größe der Datei prüfen");
    }

    #[test]
    fn session_ids_must_be_canonical_uuids() {
        assert!(is_session_id(ID));
        for bad in [
            "",
            "../x",
            &ID[..35],
            &format!("{ID}0"),
            "0b5f4c2e_9a1d_4e3b_8c7f_1234567890ab",
            "gggggggg-9a1d-4e3b-8c7f-1234567890ab",
        ] {
            assert!(!is_session_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn project_dirs_replace_every_non_alphanumeric() {
        assert_eq!(
            encode_project_dir("/Users/a/.cache/x_y"),
            "-Users-a--cache-x-y"
        );
    }

    #[test]
    fn assistant_entries_carry_their_model_and_token_usage() {
        let with = parse_line(
            line(json!({"type": "assistant", "uuid": "a1", "message": {
                "model": "claude-opus-5-5", "role": "assistant",
                "content": [{"type": "text", "text": "hi"}],
                "usage": {"input_tokens": 12, "output_tokens": 340,
                    "cache_read_input_tokens": 90_000, "cache_creation_input_tokens": 1_500}
            }}))
            .trim_end()
            .as_bytes(),
        )
        .unwrap();
        assert_eq!(with.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(
            with.usage,
            Some(Usage {
                input_tokens: 12,
                output_tokens: 340,
                cache_read_input_tokens: 90_000,
                cache_creation_input_tokens: 1_500,
            })
        );
        let synthetic = parse_line(
            line(json!({"type": "assistant", "message": {"model": "<synthetic>", "content": []}}))
                .trim_end()
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(synthetic.model, None);
        assert_eq!(synthetic.usage, None);
        let prompt = parse_line(user("u", "hi").trim_end().as_bytes()).unwrap();
        assert_eq!(prompt.model, None);
    }

    #[test]
    fn parses_prompts_text_thinking_tools_and_results() {
        let mut data = user("u1", "fix the bug");
        data += &assistant(
            "a1",
            json!([
                {"type": "thinking", "thinking": "", "signature": "sig"},
                {"type": "text", "text": "Looking."},
                {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}, "caller": {}}
            ]),
        );
        data += &line(
            json!({"type": "user", "uuid": "u2", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": "a\nb"}], "is_error": false}
        ]}, "toolUseResult": {"stdout": "a\nb", "stderr": "", "interrupted": false}}),
        );
        let entries: Vec<_> = data
            .lines()
            .filter_map(|l| parse_line(l.as_bytes()))
            .collect();
        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries[0].blocks,
            vec![Block::Text {
                text: "fix the bug".into()
            }]
        );
        assert_eq!(entries[1].thinking_duration_ms, Some(1200));
        assert_eq!(
            entries[1].blocks[0],
            Block::Thinking {
                text: String::new()
            }
        );
        assert!(matches!(&entries[1].blocks[2], Block::ToolUse { name, .. } if name == "Bash"));
        assert_eq!(
            entries[2].blocks[0],
            Block::ToolResult {
                tool_use_id: "t1".into(),
                content: "a\nb".into(),
                is_error: false
            }
        );
        assert_eq!(
            entries[2]
                .tool_use_result
                .as_ref()
                .unwrap()
                .stdout
                .as_deref(),
            Some("a\nb")
        );
    }

    #[test]
    fn keeps_edit_strings_and_the_title_and_skips_bookkeeping() {
        let edit = line(
            json!({"type": "user", "uuid": "u3", "message": {"content": []},
            "toolUseResult": {"filePath": "/r/a.ts", "oldString": "x", "newString": "y", "structuredPatch": []}}),
        );
        let parsed = parse_line(edit.trim_end().as_bytes()).unwrap();
        let tur = parsed.tool_use_result.unwrap();
        assert_eq!(
            (
                tur.file_path.as_deref(),
                tur.old_string.as_deref(),
                tur.new_string.as_deref()
            ),
            (Some("/r/a.ts"), Some("x"), Some("y"))
        );

        let title =
            parse_line(br#"{"type":"ai-title","aiTitle":"Fix the bug","sessionId":"s"}"#).unwrap();
        assert_eq!(
            (title.kind, title.text.as_deref()),
            ("title", Some("Fix the bug"))
        );

        for skipped in [
            r#"{"type":"api-request-blob","hash":"h","message":{"content":[]}}"#,
            r#"{"type":"file-history-snapshot","snapshot":{}}"#,
            r#"{"type":"cost-state","totalCostUSD":1}"#,
            r#"{"parentUuid":null,"type":"attachment","attachment":{}}"#,
            "not json",
        ] {
            assert!(parse_line(skipped.as_bytes()).is_none(), "{skipped}");
        }
    }

    #[test]
    fn caps_long_text_on_a_char_boundary() {
        let long = "é".repeat(TEXT_CAP);
        let out = cap(&long, TEXT_CAP);
        assert!(out.len() <= TEXT_CAP + "…".len());
        assert!(out.ends_with('…'));
        let input = cap_value(
            json!({"content": "x".repeat(INPUT_CAP * 2), "n": 3}),
            INPUT_CAP,
        );
        assert!(input["content"].as_str().unwrap().len() <= INPUT_CAP + 3);
        assert_eq!(input["n"], 3);
    }

    #[test]
    fn reads_complete_lines_and_continues_from_next_offset() {
        let root = temp_root("forward");
        let path = root.join("t.jsonl");
        let first = user("u1", "one");
        std::fs::write(&path, format!("{first}{}", r#"{"type":"user","uuid":"u2""#)).unwrap();

        let page = read_page(&path, None, None).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.next_offset, first.len() as u64);

        // The half-written line completes; the next read picks it up once.
        let second = user("u2", "two");
        std::fs::write(&path, format!("{first}{second}")).unwrap();
        let page = read_page(&path, Some(first.len() as u64), None).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].uuid.as_deref(), Some("u2"));
        assert_eq!(page.next_offset, (first.len() + second.len()) as u64);
        assert!(!page.reset);

        // A shrunken file resets to the tail.
        std::fs::write(&path, &first).unwrap();
        assert!(read_page(&path, Some(10_000), None).unwrap().reset);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tail_and_backward_pages_drop_partial_lines() {
        let root = temp_root("tail");
        let path = root.join("t.jsonl");
        let filler = user("f", &"x".repeat(1000));
        let mut data = String::new();
        while data.len() < (TAIL_BYTES + PAGE_BYTES) as usize {
            data += &filler;
        }
        data += &user("last", "end");
        std::fs::write(&path, &data).unwrap();

        let tail = read_page(&path, None, None).unwrap();
        assert!(tail.start_offset > 0);
        assert_eq!(tail.entries.last().unwrap().uuid.as_deref(), Some("last"));
        assert_eq!(tail.next_offset, data.len() as u64);
        // The page starts exactly at a line boundary.
        assert_eq!(&data.as_bytes()[tail.start_offset as usize - 1], &b'\n');

        let earlier = read_page(&path, None, Some(tail.start_offset)).unwrap();
        assert!(earlier.start_offset < tail.start_offset);
        assert_eq!(earlier.next_offset, tail.start_offset);
        assert!(earlier
            .entries
            .iter()
            .all(|e| e.uuid.as_deref() == Some("f")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_line_longer_than_a_page_is_read_whole_going_forward() {
        let root = temp_root("long");
        let path = root.join("t.jsonl");
        let huge = user("huge", &"x".repeat(PAGE_BYTES as usize * 2));
        let after = user("after", "ok");
        std::fs::write(&path, format!("{huge}{after}")).unwrap();
        let page = read_page(&path, Some(0), None).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].uuid.as_deref(), Some("huge"));
        assert_eq!(page.next_offset, huge.len() as u64);
        let page = read_page(&path, Some(page.next_offset), None).unwrap();
        assert_eq!(page.entries[0].uuid.as_deref(), Some("after"));
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A prompt with screenshots pasted, its base64 well past a page.
    fn big_image_prompt(uuid: &str) -> String {
        let data = "QUFB".repeat(PAGE_BYTES as usize * 3 / 8);
        line(
            json!({"type": "user", "uuid": uuid, "timestamp": "2026-11-04T10:00:00Z",
            "message": {"role": "user", "content": [
                {"type": "text", "text": "[Image #1] what is this"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
            ]}}),
        )
    }

    #[test]
    fn a_screenshot_prompt_longer_than_a_page_survives_every_read() {
        let root = temp_root("long-image");
        let path = root.join("t.jsonl");
        let before = user("before", "earlier turn");
        let big = big_image_prompt("big");
        let after = user("after", "later turn");
        assert!(big.len() as u64 > PAGE_BYTES);
        std::fs::write(&path, format!("{before}{big}{after}")).unwrap();
        let big_at = before.len() as u64;

        // Forward from the line's start.
        let page = read_page(&path, Some(big_at), None).unwrap();
        let entry = &page.entries[0];
        assert_eq!(entry.uuid.as_deref(), Some("big"));
        assert_eq!(entry.line_offset, Some(big_at));
        assert!(matches!(entry.blocks[1], Block::Image { index: 0 }));
        assert_eq!(page.next_offset, big_at + big.len() as u64);
        assert!(read_image(&path, big_at, 0).is_ok());

        // Backward from the line that follows it, then on to the start.
        let page = read_page(&path, None, Some(big_at + big.len() as u64)).unwrap();
        assert_eq!(
            page.entries
                .iter()
                .map(|e| e.uuid.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("big")]
        );
        assert_eq!(page.start_offset, big_at);
        let page = read_page(&path, None, Some(page.start_offset)).unwrap();
        assert_eq!(page.entries[0].uuid.as_deref(), Some("before"));
        assert_eq!(page.start_offset, 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_tail_keeps_a_last_line_longer_than_the_tail_window() {
        let root = temp_root("long-tail");
        let path = root.join("t.jsonl");
        let data = "QUFB".repeat(TAIL_BYTES as usize * 3 / 8);
        let big = line(
            json!({"type": "user", "uuid": "big", "message": {"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
            ]}}),
        );
        let first = user("first", "hi");
        std::fs::write(&path, format!("{first}{big}")).unwrap();
        let page = read_page(&path, None, None).unwrap();
        assert_eq!(page.entries[0].uuid.as_deref(), Some("big"));
        assert_eq!(page.start_offset, first.len() as u64);
        assert_eq!(page.next_offset, (first.len() + big.len()) as u64);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_long_line_still_being_written_is_waited_for_not_skipped() {
        let root = temp_root("long-partial");
        let path = root.join("t.jsonl");
        let big = big_image_prompt("big");
        std::fs::write(&path, &big[..big.len() - 1]).unwrap();
        let page = read_page(&path, Some(0), None).unwrap();
        assert!(page.entries.is_empty());
        assert_eq!(page.next_offset, 0);
        std::fs::write(&path, &big).unwrap();
        let page = read_page(&path, Some(0), None).unwrap();
        assert_eq!(page.entries[0].uuid.as_deref(), Some("big"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn long_bookkeeping_lines_and_lines_past_the_cap_are_not_read_whole() {
        let root = temp_root("long-blob");
        let path = root.join("t.jsonl");
        let blob = format!(
            "{{\"type\":\"api-request-blob\",\"data\":\"{}\"}}\n",
            "x".repeat(PAGE_BYTES as usize * 2)
        );
        let after = user("after", "ok");
        std::fs::write(&path, format!("{blob}{after}")).unwrap();
        let page = read_page(&path, Some(0), None).unwrap();
        assert!(page.entries.is_empty());
        assert_eq!(page.next_offset, blob.len() as u64);
        let mut file = File::open(&path).unwrap();
        assert_eq!(
            read_long_line(&mut file, 0, IMAGE_LINE_CAP + 1).unwrap(),
            None
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_only_regular_files_inside_the_root() {
        let root = temp_root("resolve");
        let project = root.join("-Users-a-repo");
        std::fs::create_dir_all(&project).unwrap();
        assert!(resolve_in(&root, ID).is_err());
        std::fs::write(project.join(format!("{ID}.jsonl")), "").unwrap();
        assert_eq!(
            resolve_in(&root, ID).unwrap(),
            std::fs::canonicalize(project.join(format!("{ID}.jsonl"))).unwrap()
        );
        assert!(resolve_in(&root, "../../etc/passwd").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_root() {
        let root = temp_root("escape");
        let outside = temp_root("escape-outside");
        let project = root.join("-p");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(outside.join("secret.jsonl"), "{}").unwrap();
        std::os::unix::fs::symlink(
            outside.join("secret.jsonl"),
            project.join(format!("{ID}.jsonl")),
        )
        .unwrap();
        assert!(resolve_in(&root, ID).is_err());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn finds_the_newest_session_for_a_cwd() {
        let root = temp_root("find");
        let dir = root.join(encode_project_dir("/r/app"));
        std::fs::create_dir_all(&dir).unwrap();
        let other = "ffffffff-0000-4000-8000-000000000000";
        std::fs::write(dir.join(format!("{other}.jsonl")), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join(format!("{ID}.jsonl")), "").unwrap();
        std::fs::write(dir.join("notes.jsonl"), "").unwrap();
        assert_eq!(find_latest_in(&root, "/r/app", 0, &[]).as_deref(), Some(ID));
        assert_eq!(find_latest_in(&root, "/r/app", u64::MAX, &[]), None);
        assert_eq!(find_latest_in(&root, "/r/missing", 0, &[]), None);
        // A session another pane already owns is never guessed for this one.
        assert_eq!(
            find_latest_in(&root, "/r/app", 0, &[ID.to_string()]).as_deref(),
            Some(other)
        );
        assert_eq!(
            find_latest_in(&root, "/r/app", 0, &[ID.to_string(), other.to_string()]),
            None
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    fn image_prompt(uuid: &str, media_type: &str, data: &str) -> String {
        line(
            json!({"type": "user", "uuid": uuid, "timestamp": "2026-11-04T10:00:00Z",
            "message": {"role": "user", "content": [
                {"type": "text", "text": "[Image #1] [Image #2] look"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}
            ]}}),
        )
    }

    #[test]
    fn image_entries_carry_their_line_offset_and_index() {
        let root = temp_root("image-offset");
        let path = root.join("t.jsonl");
        let first = user("u0", "hello");
        let data = format!("{first}{}", image_prompt("u1", "image/jpeg", "QkJC"));
        std::fs::write(&path, &data).unwrap();
        let page = read_page(&path, None, None).unwrap();
        let entry = page
            .entries
            .iter()
            .find(|e| e.uuid.as_deref() == Some("u1"))
            .unwrap();
        assert_eq!(entry.line_offset, Some(first.len() as u64));
        assert!(page.entries[0].line_offset.is_none());
        let images: Vec<_> = entry
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Image { index } => Some(*index),
                _ => None,
            })
            .collect();
        assert_eq!(images, vec![0, 1]);

        let offset = first.len() as u64;
        let second = read_image(&path, offset, 1).unwrap();
        assert_eq!(second.media_type, "image/jpeg");
        assert_eq!(second.data, "QkJC");
        assert_eq!(read_image(&path, offset, 0).unwrap().data, "AAAA");
        assert!(read_image(&path, offset, 2).is_err());
        assert!(read_image(&path, 0, 0).is_err(), "a line without images");
        assert!(read_image(&path, 3, 0).is_err(), "an offset mid-line");
        assert!(read_image(&path, data.len() as u64, 0).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pasted_images_are_saved_only_when_their_bytes_match_the_type() {
        let root = temp_root("pasted");
        let dir = root.join("pasted-images");
        let png = b"\x89PNG\r\n\x1a\nrest-of-file";
        let saved = save_pasted_image_in(&dir, "image/png", png).unwrap();
        assert_eq!(saved.extension().unwrap(), "png");
        assert_eq!(saved.parent().unwrap(), dir.as_path());
        assert_eq!(std::fs::read(&saved).unwrap(), png);
        let other = save_pasted_image_in(&dir, "image/png", png).unwrap();
        assert_ne!(saved, other, "names are random");
        let webp = b"RIFF\x00\x00\x00\x00WEBPVP8 ";
        assert_eq!(
            save_pasted_image_in(&dir, "image/webp", webp)
                .unwrap()
                .extension()
                .unwrap(),
            "webp"
        );

        for (media_type, bytes) in [
            ("image/png", &b"GIF89a-not-a-png"[..]),
            ("image/svg+xml", &b"<svg onload=alert(1)>"[..]),
            ("text/html", &b"\x89PNG\r\n\x1a\n"[..]),
            ("image/jpeg", &b""[..]),
        ] {
            assert!(
                save_pasted_image_in(&dir, media_type, bytes).is_err(),
                "{media_type}"
            );
        }
        let huge = vec![0u8; PASTED_IMAGE_CAP + 1];
        assert!(save_pasted_image_in(&dir, "image/png", &huge).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dropped_images_are_copied_only_when_they_are_real_images() {
        let root = temp_root("dropped");
        let dir = root.join("pasted-images");
        let png = b"\x89PNG\r\n\x1a\nrest-of-file";
        let good = root.join("Shot 1.PNG");
        std::fs::write(&good, png).unwrap();
        let saved = save_dropped_image_in(&dir, &good).unwrap();
        assert_eq!(saved.parent().unwrap(), dir.as_path());
        assert_eq!(saved.extension().unwrap(), "png");
        assert_eq!(std::fs::read(&saved).unwrap(), png);

        let jpeg_named_png = root.join("fake.png");
        std::fs::write(&jpeg_named_png, b"\xff\xd8\xff\xe0jpeg").unwrap();
        let text = root.join("notes.txt");
        std::fs::write(&text, b"hello").unwrap();
        let svg = root.join("x.svg");
        std::fs::write(&svg, b"<svg/>").unwrap();
        let empty = root.join("empty.gif");
        std::fs::write(&empty, b"").unwrap();
        let folder = root.join("folder.png");
        std::fs::create_dir_all(&folder).unwrap();
        for bad in [
            jpeg_named_png.as_path(),
            text.as_path(),
            svg.as_path(),
            empty.as_path(),
            folder.as_path(),
            root.join("missing.png").as_path(),
            Path::new("relative.png"),
        ] {
            assert!(save_dropped_image_in(&dir, bad).is_err(), "{}", bad.display());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn images_reject_unknown_types_and_non_base64_data() {
        let root = temp_root("image-hostile");
        let path = root.join("t.jsonl");
        for (media_type, payload) in [
            ("image/svg+xml", "PHN2Zz4="),
            ("text/html", "QUFB"),
            ("image/png", "AA\");alert(1)//"),
            ("image/png", "AA AA"),
        ] {
            std::fs::write(&path, image_prompt("u1", media_type, payload)).unwrap();
            assert!(read_image(&path, 0, 1).is_err(), "{media_type} {payload}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
