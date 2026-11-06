use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

const MAX_BYTES: u64 = 32 * 1024;

#[tauri::command]
pub async fn fs_read_project_memory(
    root: String,
    checked_path: String,
    workspace: Option<WorkspaceEnv>,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    super::blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let root =
            std::fs::canonicalize(resolve_path(&root, &workspace)).map_err(|e| e.to_string())?;
        if !app.state::<WorkspaceRegistry>().is_authorized(&root) {
            return Err("project memory is outside the authorized workspace".into());
        }
        read_memory(&root, &resolve_path(&checked_path, &workspace))
    })
    .await
}

fn read_memory(root: &Path, checked_path: &Path) -> Result<Option<String>, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options
        .open(root.join("TERAX.md"))
        .map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("project memory must be a regular file".into());
    }
    // Validate the opened object before reading, so a link swapped after the
    // frontend secret-policy check cannot substitute a different target.
    let opened = opened_path(&file)?;
    if !lossless_paths(&[opened.as_path(), root, checked_path]) {
        return Err("project memory path cannot be represented losslessly".into());
    }
    let actual = comparison_path(&opened);
    let root = comparison_path(root);
    let checked = comparison_path(checked_path);
    if !Path::new(&actual).starts_with(&root) || actual != checked {
        return Err("project memory escaped the project or changed after its safety check".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Ok(None);
    }
    if bytes.len() > MAX_BYTES as usize {
        bytes.truncate(MAX_BYTES as usize);
        if let Err(error) = std::str::from_utf8(&bytes) {
            if error.error_len().is_none() {
                bytes.truncate(error.valid_up_to());
            }
        }
    }
    Ok(String::from_utf8(bytes).ok())
}

fn lossless_paths(paths: &[&Path]) -> bool {
    paths.iter().all(|path| path.to_str().is_some())
}

fn comparison_path(path: &Path) -> String {
    super::to_canon(path)
}

fn opened_path(file: &File) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        use std::os::unix::ffi::OsStrExt;
        let mut buffer = [0u8; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) } == -1 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let end = buffer
            .iter()
            .position(|&b| b == 0)
            .ok_or("invalid file path")?;
        Ok(PathBuf::from(std::ffi::OsStr::from_bytes(&buffer[..end])))
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        super::local_file::canonicalize(file).map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_distinct_roots_never_compare_equal() {
        let root = comparison_path(Path::new("//wsl.localhost/Ubuntu/home/me/repo"));
        let sibling = comparison_path(Path::new(
            "//wsl.localhost/Ubuntu/home/me/Repo/instructions.md",
        ));
        assert!(!Path::new(&sibling).starts_with(&root));
        assert_ne!(
            comparison_path(Path::new("C:/Repo/memory.md")),
            comparison_path(Path::new("C:/repo/memory.md"))
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn invalid_utf8_sibling_cannot_alias_an_authorized_root() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        let parent = std::fs::canonicalize(dir.path()).unwrap();
        let root = parent.join("repo�");
        let outside = parent.join(std::ffi::OsStr::from_bytes(b"repo\xff"));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let target = outside.join("instructions.md");
        std::fs::write(&target, "OUTSIDE_FIXTURE").unwrap();
        std::os::unix::fs::symlink(&target, root.join("TERAX.md")).unwrap();
        let frontend_path = PathBuf::from(target.to_string_lossy().as_ref());
        assert!(read_memory(&root, &frontend_path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn byte_distinct_paths_are_not_accepted_as_display_strings() {
        use std::os::unix::ffi::OsStrExt;
        let raw = Path::new(std::ffi::OsStr::from_bytes(b"/repo\xff/memory.md"));
        assert!(!lossless_paths(&[Path::new("/repo�"), raw]));
        assert!(lossless_paths(&[Path::new("/repo�/memory.md")]));
    }

    #[test]
    fn ordinary_memory_is_bounded_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let path = root.join("TERAX.md");
        std::fs::write(&path, "project instructions").unwrap();
        assert_eq!(
            read_memory(&root, &path).unwrap().as_deref(),
            Some("project instructions")
        );
        std::fs::write(&path, "€".repeat(MAX_BYTES as usize)).unwrap();
        assert_eq!(read_memory(&root, &path).unwrap().unwrap().len(), 32766);
    }

    #[cfg(unix)]
    #[test]
    fn links_cannot_escape_or_substitute_a_previously_checked_target() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        let memory = root.join("TERAX.md");
        std::os::unix::fs::symlink(outside.path(), &memory).unwrap();
        assert!(read_memory(&root, outside.path()).is_err());
        std::fs::remove_file(&memory).unwrap();
        let secret = root.join(".env");
        std::fs::write(&secret, "SYNTHETIC_SECRET").unwrap();
        std::os::unix::fs::symlink(&secret, &memory).unwrap();
        assert!(read_memory(&root, &memory).is_err());
        std::fs::remove_file(&memory).unwrap();
        let allowed = root.join("instructions.md");
        std::fs::write(&allowed, "allowed instructions").unwrap();
        std::os::unix::fs::symlink(&allowed, &memory).unwrap();
        assert_eq!(
            read_memory(&root, &allowed).unwrap().as_deref(),
            Some("allowed instructions")
        );
    }
}
