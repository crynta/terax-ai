use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Image,
    Pdf,
    Audio,
    Video,
}

#[derive(Serialize)]
pub struct PreviewMetadata {
    pub kind: PreviewKind,
    pub media_type: &'static str,
    pub size: u64,
}

pub fn preview_media_type_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        "pdf" => Some("application/pdf"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "ogg" | "oga" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "m4a" => Some("audio/mp4"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "mkv" => Some("video/x-matroska"),
        _ => None,
    }
}

pub fn preview_kind_for_media_type(media_type: &str) -> Option<PreviewKind> {
    if media_type.starts_with("image/") {
        return Some(PreviewKind::Image);
    }
    if media_type == "application/pdf" {
        return Some(PreviewKind::Pdf);
    }
    if media_type.starts_with("audio/") {
        return Some(PreviewKind::Audio);
    }
    if media_type.starts_with("video/") {
        return Some(PreviewKind::Video);
    }
    None
}

pub fn preview_metadata_for_path(path: &Path) -> Result<PreviewMetadata, String> {
    let media_type = preview_media_type_for_path(path)
        .ok_or_else(|| "preview not supported for this file type".to_string())?;
    let kind = preview_kind_for_media_type(media_type)
        .ok_or_else(|| "preview not supported for this file type".to_string())?;
    let meta = std::fs::metadata(path).map_err(|e| {
        log::debug!("preview metadata stat({}) failed: {e}", path.display());
        e.to_string()
    })?;
    if !meta.is_file() {
        return Err("path is not a file".to_string());
    }
    Ok(PreviewMetadata {
        kind,
        media_type,
        size: meta.len(),
    })
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

#[tauri::command]
pub fn fs_preview_metadata(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<PreviewMetadata, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    preview_metadata_for_path(&p)
}

/// Atomic write: stage into a sibling temp file, then rename over the target.
/// Prevents partial writes from leaving a half-saved file on crash/power loss.
#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let parent = target
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "path has no file name".to_string())?;

    let tmp = parent.join(format!(".{file_name}.terax.tmp"));

    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| {
            log::debug!("fs_write_file create({}) failed: {e}", tmp.display());
            e.to_string()
        })?;
        f.write_all(content.as_bytes()).map_err(|e| {
            log::debug!("fs_write_file write({}) failed: {e}", tmp.display());
            e.to_string()
        })?;
        f.sync_all().map_err(|e| e.to_string())?;
    }

    std::fs::rename(&tmp, &target).map_err(|e| {
        log::warn!(
            "fs_write_file rename({} -> {}) failed: {e}",
            tmp.display(),
            target.display()
        );
        // Best-effort cleanup of the staged temp.
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;

    Ok(())
}

#[tauri::command]
pub fn fs_canonicalize(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    // Strip the Windows `\\?\` extended-length prefix so the frontend's
    // path comparator sees the same form regardless of OS.
    let s = canon.to_string_lossy().to_string();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
    Ok(s.replace('\\', "/"))
}

#[tauri::command]
pub fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        StatKind::Dir
    } else if meta.file_type().is_symlink() {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::{preview_kind_for_media_type, preview_media_type_for_path, PreviewKind};
    use std::path::Path;

    #[test]
    fn preview_media_type_recognizes_supported_renderable_files() {
        let cases = [
            ("diagram.PNG", Some("image/png")),
            ("photo.jpeg", Some("image/jpeg")),
            ("animation.gif", Some("image/gif")),
            ("vector.svg", Some("image/svg+xml")),
            ("screen.webp", Some("image/webp")),
            ("notes.pdf", Some("application/pdf")),
            ("voice.mp3", Some("audio/mpeg")),
            ("song.flac", Some("audio/flac")),
            ("clip.mp4", Some("video/mp4")),
            ("screen.webm", Some("video/webm")),
        ];

        for (path, expected) in cases {
            assert_eq!(preview_media_type_for_path(Path::new(path)), expected);
        }
    }

    #[test]
    fn preview_media_type_rejects_non_renderable_files() {
        let cases = ["archive.zip", "program.bin", "README.md", "no-extension"];

        for path in cases {
            assert_eq!(preview_media_type_for_path(Path::new(path)), None);
        }
    }

    #[test]
    fn preview_kind_follows_media_family() {
        assert_eq!(
            preview_kind_for_media_type("image/png"),
            Some(PreviewKind::Image)
        );
        assert_eq!(
            preview_kind_for_media_type("application/pdf"),
            Some(PreviewKind::Pdf)
        );
        assert_eq!(
            preview_kind_for_media_type("audio/mpeg"),
            Some(PreviewKind::Audio)
        );
        assert_eq!(
            preview_kind_for_media_type("video/mp4"),
            Some(PreviewKind::Video)
        );
        assert_eq!(preview_kind_for_media_type("application/zip"), None);
    }
}
