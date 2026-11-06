use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use globset::{Glob, GlobSetBuilder};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use tauri::Manager;

use super::file::ReadResult;
use super::grep::{GlobHit, GlobResponse, GrepHit, GrepResponse};
use super::read_policy::readable;
use super::tree::DirEntry;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

fn path_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        // Stable IPC distinction for plan snapshots; other failures must not imply creation.
        "AI file not found".into()
    } else {
        error.to_string()
    }
}

fn authorized(registry: &WorkspaceRegistry, path: &Path) -> Result<PathBuf, String> {
    readable(path)?;
    let canonical = std::fs::canonicalize(path).map_err(path_error)?;
    readable(&canonical)?;
    if !registry.is_authorized(&canonical) {
        return Err("AI path is outside the authorized workspace".into());
    }
    Ok(canonical)
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
        use std::os::windows::ffi::OsStringExt;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
        let mut buffer = vec![0u16; 32768];
        let len = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        } as usize;
        if len == 0 || len >= buffer.len() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len])))
    }
}

#[cfg(target_os = "linux")]
fn reopen_regular(file: &File) -> Result<File, String> {
    use std::os::fd::AsRawFd;
    if !file.metadata().map_err(path_error)?.is_file() {
        return Err("AI reads require a regular file".into());
    }
    File::open(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(path_error)
}

fn open_read_file(path: &Path) -> Result<File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "linux")]
        options.custom_flags(libc::O_PATH);
        #[cfg(not(target_os = "linux"))]
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(path_error)?;
    #[cfg(target_os = "linux")]
    {
        // Pin without opening a device, then reopen that same regular inode for reading.
        reopen_regular(&file)
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(file)
    }
}

pub fn read_file(
    registry: &WorkspaceRegistry,
    path: &Path,
    limit: u64,
) -> Result<ReadResult, String> {
    let path = authorized(registry, path)?;
    let file = open_read_file(&path)?;
    let actual = opened_path(&file)?;
    readable(&actual)?;
    if !registry.is_authorized(&actual) {
        return Err("opened AI file is outside the authorized workspace".into());
    }
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("AI reads require a regular file".into());
    }
    if meta.len() > limit {
        return Ok(ReadResult::TooLarge {
            size: meta.len(),
            limit,
        });
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;
    if size > limit {
        return Ok(ReadResult::TooLarge { size, limit });
    }
    if bytes.contains(&0) {
        return Ok(ReadResult::Binary { size });
    }
    Ok(match String::from_utf8(bytes) {
        Ok(content) => ReadResult::Text {
            content,
            size,
            mtime: 0,
        },
        Err(_) => ReadResult::Binary { size },
    })
}

#[tauri::command]
pub async fn ai_read_file(
    app: tauri::AppHandle,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<ReadResult, String> {
    super::blocking(move || {
        read_file(
            &app.state::<WorkspaceRegistry>(),
            &resolve_path(&path, &WorkspaceEnv::from_option(workspace)),
            10 * 1024 * 1024,
        )
    })
    .await
}

#[tauri::command]
pub async fn ai_read_dir(
    app: tauri::AppHandle,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    super::blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let path = authorized(
            &registry,
            &resolve_path(&path, &WorkspaceEnv::from_option(workspace)),
        )?;
        let entries = super::tree::read_dir_entries(
            super::to_canon(&path),
            false,
            None,
            Some(WorkspaceEnv::Local),
        )?;
        Ok(entries
            .into_iter()
            .filter(|entry| authorized(&registry, &path.join(&entry.name)).is_ok())
            .collect())
    })
    .await
}

fn walk(registry: &WorkspaceRegistry, root: &Path) -> Result<ignore::Walk, String> {
    let root = authorized(registry, root)?;
    if !root.is_dir() {
        return Err("AI search root must be a directory".into());
    }
    Ok(WalkBuilder::new(root)
        .hidden(true)
        .follow_links(false)
        .filter_entry(|entry| readable(entry.path()).is_ok())
        .build())
}

#[tauri::command]
pub async fn ai_glob(
    app: tauri::AppHandle,
    pattern: String,
    root: String,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GlobResponse, String> {
    super::blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let workspace = WorkspaceEnv::from_option(workspace);
        let root_path = authorized(&registry, &resolve_path(&root, &workspace))?;
        let matcher = Glob::new(&pattern)
            .map_err(|e| e.to_string())?
            .compile_matcher();
        let cap = max_results.unwrap_or(500).clamp(1, 2000);
        let mut hits = Vec::new();
        let mut truncated = false;
        for entry in walk(&registry, &root_path)?.flatten() {
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root_path) else {
                continue;
            };
            if !matcher.is_match(rel) || authorized(&registry, entry.path()).is_err() {
                continue;
            }
            if hits.len() == cap {
                truncated = true;
                break;
            }
            hits.push(GlobHit {
                path: super::display_path(entry.path(), &root_path, &root, &workspace),
                rel: super::to_canon(rel),
            });
        }
        Ok(GlobResponse { hits, truncated })
    })
    .await
}

fn matching_lines<'a>(
    content: &'a str,
    matcher: &'a regex::Regex,
) -> impl Iterator<Item = (usize, &'a str)> + 'a {
    content
        .split_terminator('\n')
        .enumerate()
        .filter(|(_, text)| matcher.is_match(text))
}

fn clip_line(text: &str) -> String {
    let mut chars = text.chars();
    let prefix: String = chars.by_ref().take(160).collect();
    let remaining = chars.count();
    if remaining == 0 {
        prefix
    } else {
        format!("{prefix}…[+{remaining}]")
    }
}

#[tauri::command]
pub async fn ai_grep(
    app: tauri::AppHandle,
    pattern: String,
    root: String,
    glob: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GrepResponse, String> {
    super::blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let workspace = WorkspaceEnv::from_option(workspace);
        let root_path = authorized(&registry, &resolve_path(&root, &workspace))?;
        let matcher = RegexBuilder::new(&pattern)
            .case_insensitive(case_insensitive.unwrap_or(false))
            .build()
            .map_err(|e| e.to_string())?;
        let mut globs = GlobSetBuilder::new();
        for pattern in glob.unwrap_or_default() {
            globs.add(Glob::new(&pattern).map_err(|e| e.to_string())?);
        }
        let globs = globs.build().map_err(|e| e.to_string())?;
        let cap = max_results.unwrap_or(200).clamp(1, 2000);
        let mut hits = Vec::new();
        let mut files_scanned = 0;
        let mut truncated = false;
        'files: for entry in walk(&registry, &root_path)?.flatten() {
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root_path) else {
                continue;
            };
            if !globs.is_empty() && !globs.is_match(rel) {
                continue;
            }
            let Ok(ReadResult::Text { content, .. }) =
                read_file(&registry, entry.path(), 5 * 1024 * 1024)
            else {
                continue;
            };
            files_scanned += 1;
            for (line, text) in matching_lines(&content, &matcher) {
                if hits.len() == cap {
                    truncated = true;
                    break 'files;
                }
                hits.push(GrepHit {
                    path: super::display_path(entry.path(), &root_path, &root, &workspace),
                    rel: super::to_canon(rel),
                    line: (line + 1) as u64,
                    text: clip_line(text),
                });
            }
        }
        Ok(GrepResponse {
            hits,
            truncated,
            files_scanned,
            cancelled: false,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn special_files_are_rejected_without_a_data_open() {
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pipe");
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
        assert!(fd >= 0);
        let mut events = unsafe { File::from_raw_fd(fd) };
        assert!(
            unsafe { libc::inotify_add_watch(events.as_raw_fd(), c_path.as_ptr(), libc::IN_OPEN) }
                >= 0
        );
        let mut bytes = [0u8; 4096];
        // Positive control: the previous nonblocking read-open activates the FIFO.
        drop(
            std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NONBLOCK)
                .open(&path)
                .unwrap(),
        );
        assert!(events.read(&mut bytes).unwrap() > 0);
        let registry = WorkspaceRegistry::default();
        registry.authorize(dir.path()).unwrap();
        assert!(read_file(&registry, &path, 1024).is_err());
        assert_eq!(
            events.read(&mut bytes).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reopening_a_pinned_regular_file_does_not_follow_a_replaced_path() {
        use std::os::unix::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        std::fs::write(&path, "original").unwrap();
        let pinned = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_PATH)
            .open(&path)
            .unwrap();
        std::fs::remove_file(&path).unwrap();
        let replacement = dir.path().join("replacement.txt");
        std::fs::write(&replacement, "replacement").unwrap();
        std::os::unix::fs::symlink(&replacement, &path).unwrap();
        let mut actual = String::new();
        reopen_regular(&pinned)
            .unwrap()
            .read_to_string(&mut actual)
            .unwrap();
        assert_eq!(actual, "original");
    }

    #[test]
    fn only_missing_files_report_the_plan_creation_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        let registry = WorkspaceRegistry::default();
        assert_eq!(
            read_file(&registry, &path, 1024).err().unwrap(),
            "AI file not found"
        );
        std::fs::write(&path, "existing").unwrap();
        assert_ne!(
            read_file(&registry, &path, 1024).err().unwrap(),
            "AI file not found"
        );
        assert_ne!(
            path_error(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
            "AI file not found"
        );
        registry.authorize(dir.path()).unwrap();
        assert!(
            matches!(read_file(&registry, &path, 1024).unwrap(), ReadResult::Text { content, .. } if content == "existing")
        );
    }

    #[test]
    fn grep_has_no_phantom_lines_and_bounds_native_hit_text() {
        let empty = regex::Regex::new("^$").unwrap();
        assert_eq!(matching_lines("hello\n", &empty).count(), 0);
        assert_eq!(matching_lines("", &empty).count(), 0);
        assert_eq!(
            matching_lines("\n", &empty).collect::<Vec<_>>(),
            vec![(0, "")]
        );
        assert_eq!(clip_line("short"), "short");
        let text = "界".repeat(1_000_000);
        assert_eq!(clip_line(&text), format!("{}…[+999840]", "界".repeat(160)));
    }

    #[test]
    fn shared_policy_protects_secrets_and_control_descriptors() {
        for path in [
            "/repo/.env",
            "/repo/file.pem",
            "/repo/.git/config",
            "/Users/me/Library/Caches/terax/control.json",
            "/home/me/.cache/terax/control.json",
            "C:/Users/me/AppData/Local/terax/control.json",
            "//wsl.localhost/Ubuntu/home/me/.ssh/id_rsa",
        ] {
            assert!(readable(Path::new(path)).is_err(), "{path}");
        }
        for path in ["/repo/src/main.ts", "/repo/environment.ts", "/repo/.envoy"] {
            assert!(readable(Path::new(path)).is_ok(), "{path}");
        }
    }

    #[test]
    fn ungranted_files_and_search_roots_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("customer.csv");
        std::fs::write(&path, "SYNTHETIC_PRIVATE_DATA").unwrap();
        let registry = WorkspaceRegistry::default();
        assert!(read_file(&registry, &path, 1024).is_err());
        assert!(walk(&registry, dir.path()).is_err());
        registry.authorize(dir.path()).unwrap();
        assert!(
            matches!(read_file(&registry, &path, 1024).unwrap(), ReadResult::Text { content, .. } if content == "SYNTHETIC_PRIVATE_DATA")
        );
        let secret = dir.path().join("secret.pem");
        std::fs::write(&secret, "SYNTHETIC_SECRET").unwrap();
        assert!(read_file(&registry, &secret, 1024).is_err());
        assert!(!walk(&registry, dir.path())
            .unwrap()
            .flatten()
            .any(|entry| entry.path() == secret));
    }

    #[cfg(unix)]
    #[test]
    fn links_cannot_bypass_the_grant_or_secret_policy() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(dir.path()).unwrap();
        let link = dir.path().join("innocent.txt");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(read_file(&registry, &link, 1024).is_err());
        std::fs::remove_file(&link).unwrap();
        let secret = dir.path().join(".env");
        std::fs::write(&secret, "SYNTHETIC_SECRET").unwrap();
        std::os::unix::fs::symlink(secret, &link).unwrap();
        assert!(read_file(&registry, &link, 1024).is_err());
    }
}
