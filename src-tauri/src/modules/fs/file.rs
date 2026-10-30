use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use serde::Serialize;
use tauri::Emitter;
use tempfile::NamedTempFile;

use super::blocking;
use super::index::FileIndexState;
use super::mutate::note_changed;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
/// Ceiling for explicit "open anyway"; mirrored as FORCE_READ_LIMIT in useDocument.ts.
const FORCE_MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
        mtime: u64,
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

fn mtime_millis(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn fs_read_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    force: Option<bool>,
) -> Result<ReadResult, String> {
    blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        read_file_sync(&resolve_path(&path, &workspace), force.unwrap_or(false))
    })
    .await
}

fn read_file_sync(p: &Path, force: bool) -> Result<ReadResult, String> {
    let meta = std::fs::metadata(p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    let limit = if force {
        FORCE_MAX_READ_BYTES
    } else {
        MAX_READ_BYTES
    };
    if size > limit {
        return Ok(ReadResult::TooLarge { size, limit });
    }

    let bytes = std::fs::read(p).map_err(|e| {
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
        Ok(content) => Ok(ReadResult::Text {
            content,
            size,
            mtime: mtime_millis(&meta),
        }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

/// Resolves `target` to the path the atomic rename must replace. A symlink is
/// followed to its real file so the link survives the write (dotfile managers
/// rely on it). A dangling link is an error: writing would either replace the
/// link or create a file at a location the user never named.
fn resolve_write_target(target: &Path) -> std::io::Result<PathBuf> {
    match fs::symlink_metadata(target) {
        Ok(m) if m.file_type().is_symlink() => fs::canonicalize(target).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "symlink target does not exist",
                )
            } else {
                e
            }
        }),
        _ => Ok(target.to_path_buf()),
    }
}

/// Atomic write that follows symlinks and keeps the existing file's
/// permissions. Returns the real path written and whether it already existed.
fn write_file_sync(target: &Path, content: &[u8]) -> std::io::Result<(PathBuf, bool)> {
    let real = resolve_write_target(target)?;
    let original = fs::metadata(&real).ok();
    write_atomic(&real, content)?;
    if let Some(perms) = original.as_ref().map(|m| m.permissions()) {
        let _ = fs::set_permissions(&real, perms);
    }
    Ok((real, original.is_some()))
}

/// Returns the new mtime so the editor can track disk state for conflict
/// detection without a follow-up stat.
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
    index: tauri::State<'_, FileIndexState>,
) -> Result<u64, String> {
    let index = index.inner().clone();
    let (path, mtime) = blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let (real, existed) = write_file_sync(&target, content.as_bytes()).map_err(|e| {
            log::warn!("fs_write_file({}) failed: {e}", target.display());
            e.to_string()
        })?;

        if !existed {
            note_changed(&index, &real);
        }
        let mtime = fs::metadata(&real).map(|m| mtime_millis(&m)).unwrap_or(0);
        Ok((path, mtime))
    })
    .await?;
    let _ = app.emit("fs:file-written", FileWrittenEvent { path, source });

    Ok(mtime)
}

#[tauri::command]
pub async fn fs_canonicalize(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<String, String> {
    blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let p = resolve_path(&path, &workspace);
        let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
        Ok(super::to_canon(&canon))
    })
    .await
}

#[tauri::command]
pub async fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    blocking(move || stat_path(path, workspace)).await
}

fn stat_path(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    // fs::metadata follows symlinks, so the link check needs symlink_metadata.
    let kind = if std::fs::symlink_metadata(&p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        StatKind::Symlink
    } else if meta.is_dir() {
        StatKind::Dir
    } else {
        StatKind::File
    };
    Ok(FileStat {
        size: meta.len(),
        mtime: mtime_millis(&meta),
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_new_file_creates_it() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        let (real, existed) = write_file_sync(&f, b"hi").unwrap();
        assert!(!existed);
        assert_eq!(real, f);
        assert_eq!(std::fs::read(&f).unwrap(), b"hi");
    }

    #[test]
    fn write_plain_file_replaces_content() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"old").unwrap();
        let (real, existed) = write_file_sync(&f, b"new").unwrap();
        assert!(existed);
        assert_eq!(real, f);
        assert_eq!(std::fs::read(&f).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn write_through_symlink_keeps_link_and_updates_target() {
        let dir = tempfile::tempdir().unwrap();
        let real_dir = dir.path().join("dotfiles");
        std::fs::create_dir(&real_dir).unwrap();
        let real = real_dir.join("zshrc");
        std::fs::write(&real, b"old").unwrap();
        let link = dir.path().join("zshrc");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let (written, existed) = write_file_sync(&link, b"new").unwrap();
        assert!(existed);
        assert_eq!(written, std::fs::canonicalize(&real).unwrap());
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_link(&link).unwrap(), real);
        assert_eq!(std::fs::read(&real).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn write_through_symlink_preserves_target_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.sh");
        std::fs::write(&real, b"old").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o750)).unwrap();
        let link = dir.path().join("link.sh");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        write_file_sync(&link, b"new").unwrap();
        let mode = std::fs::metadata(&real).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o750);
    }

    #[cfg(unix)]
    #[test]
    fn write_through_relative_symlink_chain_keeps_every_link() {
        use std::os::unix::fs::symlink;
        use std::path::Path;
        let dir = tempfile::tempdir().unwrap();
        let dotfiles = dir.path().join("dotfiles");
        let links = dir.path().join("links");
        std::fs::create_dir(&dotfiles).unwrap();
        std::fs::create_dir(&links).unwrap();
        let real = dotfiles.join("zshrc");
        std::fs::write(&real, b"old").unwrap();
        let link2 = links.join("link2");
        symlink("../dotfiles/zshrc", &link2).unwrap();
        let link1 = dir.path().join("link1");
        symlink("links/link2", &link1).unwrap();

        write_file_sync(&link1, b"new").unwrap();
        assert_eq!(std::fs::read(&real).unwrap(), b"new");
        assert_eq!(
            std::fs::read_link(&link1).unwrap(),
            Path::new("links/link2")
        );
        assert_eq!(
            std::fs::read_link(&link2).unwrap(),
            Path::new("../dotfiles/zshrc")
        );
        assert!(!std::fs::symlink_metadata(&real)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn write_through_symlink_to_directory_errors_without_stray_files() {
        let dir = tempfile::tempdir().unwrap();
        let target_dir = dir.path().join("sub");
        std::fs::create_dir(&target_dir).unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target_dir, &link).unwrap();

        assert!(write_file_sync(&link, b"x").is_err());
        assert_eq!(std::fs::read_link(&link).unwrap(), target_dir);
        assert!(target_dir.is_dir());
        assert_eq!(std::fs::read_dir(&target_dir).unwrap().count(), 0);
        let mut names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        names.sort();
        assert_eq!(names, ["link", "sub"]);
    }

    #[cfg(unix)]
    #[test]
    fn write_through_dangling_symlink_errors_and_keeps_link() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&missing, &link).unwrap();

        let err = write_file_sync(&link, b"x").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        assert!(err.to_string().contains("symlink target does not exist"));
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!missing.exists());
    }

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text {
                content,
                size,
                mtime,
            } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
                assert!(mtime > 0);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn force_lifts_the_default_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("big.txt");
        std::fs::write(&f, vec![b'a'; (MAX_READ_BYTES + 1) as usize]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::TooLarge { .. }
        ));
        assert!(matches!(
            read_file_sync(&f, true).unwrap(),
            ReadResult::Text { .. }
        ));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terax.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
