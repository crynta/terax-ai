use std::path::Path;
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
        let original = fs::metadata(&target).ok();
        write_atomic(&target, content.as_bytes()).map_err(|e| {
            log::warn!("fs_write_file({}) failed: {e}", target.display());
            e.to_string()
        })?;

        if let Some(perms) = original.as_ref().map(|m| m.permissions()) {
            let _ = fs::set_permissions(&target, perms);
        }
        if original.is_none() {
            note_changed(&index, &target);
        }
        let mtime = fs::metadata(&target).map(|m| mtime_millis(&m)).unwrap_or(0);
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
    local_only: Option<bool>,
) -> Result<String, String> {
    validate_link_path(&path, local_only)?;
    blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        #[cfg(windows)]
        if local_only == Some(true) {
            let canon =
                super::local_file::canonicalize(&super::local_file::open(&path, &workspace)?)?;
            return match &workspace {
                WorkspaceEnv::Wsl { distro } => canonical_wsl_path(&canon, distro),
                WorkspaceEnv::Local => Ok(canon),
            };
        }
        let p = resolve_path(&path, &workspace);
        let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
        let canon = super::to_canon(&canon);
        #[cfg(windows)]
        if let WorkspaceEnv::Wsl { distro } = &workspace {
            return canonical_wsl_path(&canon, distro);
        }
        Ok(canon)
    })
    .await
}

#[tauri::command]
pub async fn fs_stat(
    path: String,
    workspace: Option<WorkspaceEnv>,
    local_only: Option<bool>,
) -> Result<FileStat, String> {
    validate_link_path(&path, local_only)?;
    blocking(move || {
        #[cfg(windows)]
        if local_only == Some(true) {
            let file = super::local_file::open(&path, &WorkspaceEnv::from_option(workspace))?;
            let meta = file.metadata().map_err(|e| e.to_string())?;
            return Ok(FileStat {
                size: meta.len(),
                mtime: mtime_millis(&meta),
                kind: if meta.is_dir() {
                    StatKind::Dir
                } else {
                    StatKind::File
                },
            });
        }
        stat_path(path, workspace)
    })
    .await
}

#[cfg(any(windows, test))]
fn canonical_wsl_path(path: &str, distro: &str) -> Result<String, String> {
    for host in ["wsl.localhost", "wsl$"] {
        let prefix = format!("//{host}/{distro}");
        if path
            .get(..prefix.len())
            .is_some_and(|p| p.eq_ignore_ascii_case(&prefix))
        {
            let tail = &path[prefix.len()..];
            if tail.is_empty() {
                return Ok("/".into());
            }
            if tail.starts_with('/') {
                return Ok(tail.into());
            }
        }
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && &bytes[1..3] == b":/" {
        return Ok(format!(
            "/mnt/{}/{}",
            (bytes[0] as char).to_ascii_lowercase(),
            &path[3..]
        ));
    }
    Err("canonical path is outside the workspace's WSL namespace".into())
}

fn validate_link_path(path: &str, local_only: Option<bool>) -> Result<(), String> {
    if local_only == Some(true)
        && path
            .as_bytes()
            .get(..2)
            .is_some_and(|prefix| prefix.iter().all(|byte| matches!(byte, b'/' | b'\\')))
    {
        return Err("network and device paths are not local file links".into());
    }
    Ok(())
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
    fn canonical_wsl_paths_keep_the_distro_namespace() {
        assert_eq!(
            canonical_wsl_path("//wsl.localhost/Ubuntu/home/me/target", "Ubuntu").unwrap(),
            "/home/me/target"
        );
        assert_eq!(
            canonical_wsl_path("//wsl$/Ubuntu/home/Target", "Ubuntu").unwrap(),
            "/home/Target"
        );
        assert_eq!(
            canonical_wsl_path("C:/work/target", "Ubuntu").unwrap(),
            "/mnt/c/work/target"
        );
        assert_eq!(
            canonical_wsl_path("//wsl.localhost/Ubuntu", "Ubuntu").unwrap(),
            "/"
        );
        assert!(canonical_wsl_path("//wsl.localhost/Ubuntu-other/file", "Ubuntu").is_err());
        assert!(canonical_wsl_path("//remote/share/file", "Ubuntu").is_err());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn local_file_links_reject_leaf_and_parent_reparse_points() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("file"), "safe").unwrap();
        let local = dir.path().join("local-link");
        std::os::windows::fs::symlink_dir(&target, &local).unwrap();
        let remote = dir.path().join("remote-link");
        std::os::windows::fs::symlink_dir(r"\\terax-unreachable.invalid\share", &remote).unwrap();
        for path in [&local, &local.join("file"), &remote, &remote.join("file")] {
            let path = super::super::to_canon(path);
            assert!(fs_stat(path.clone(), None, Some(true))
                .await
                .err()
                .unwrap()
                .contains("reparse"));
            assert!(fs_canonicalize(path, None, Some(true))
                .await
                .err()
                .unwrap()
                .contains("reparse"));
        }
        let plain = super::super::to_canon(target.join("file"));
        assert_eq!(
            fs_stat(plain.clone(), None, Some(true)).await.unwrap().size,
            4
        );
        assert_eq!(
            fs_canonicalize(plain.clone(), None, Some(true))
                .await
                .unwrap(),
            plain
        );
    }

    #[tokio::test]
    async fn local_file_links_reject_network_paths_before_filesystem_access() {
        for path in [
            r"\\server\share\file",
            "//server/share/file",
            r"/\server/share/file",
            r"\/server\share\file",
            r"\\?\C:\file",
            r"\\.\pipe\name",
            r"/\?\UNC\server\share",
            r"\/.\pipe\name",
        ] {
            let expected = "network and device paths are not local file links";
            assert_eq!(
                fs_stat(path.into(), None, Some(true)).await.err().unwrap(),
                expected
            );
            assert_eq!(
                fs_canonicalize(path.into(), None, Some(true))
                    .await
                    .unwrap_err(),
                expected
            );
            assert!(validate_link_path(path, None).is_ok());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn link_parent_segments_resolve_after_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        let external = dir.path().join("external");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(external.join("build")).unwrap();
        std::fs::write(external.join("main.ts"), "outside").unwrap();
        std::fs::write(workspace.join("main.ts"), "inside").unwrap();
        std::os::unix::fs::symlink(external.join("build"), workspace.join("build")).unwrap();
        let path = workspace
            .join("build/../main.ts")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            fs_stat(path.clone(), None, Some(true)).await.unwrap().size,
            7
        );
        assert_eq!(
            fs_canonicalize(path, None, Some(true)).await.unwrap(),
            super::super::to_canon(std::fs::canonicalize(external.join("main.ts")).unwrap())
        );
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
