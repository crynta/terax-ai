use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use globset::{Glob, GlobSetBuilder};
use ignore::WalkBuilder;
use regex::{RegexBuilder, RegexSetBuilder};
use serde::Deserialize;
use tauri::Manager;

use super::file::ReadResult;
use super::grep::{GlobHit, GlobResponse, GrepHit, GrepResponse};
use super::tree::DirEntry;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathPolicy {
    secret_basenames: Vec<String>,
    protected_dirs: Vec<String>,
}

fn readable(path: &Path) -> Result<(), String> {
    static POLICY: OnceLock<(regex::RegexSet, Vec<String>)> = OnceLock::new();
    let (patterns, directories) = POLICY.get_or_init(|| {
        let policy: PathPolicy = serde_json::from_str(include_str!(
            "../../../../src/modules/ai/lib/pathPolicy.json"
        ))
        .expect("valid path policy");
        (
            RegexSetBuilder::new(policy.secret_basenames)
                .case_insensitive(true)
                .build()
                .expect("valid secret patterns"),
            policy.protected_dirs,
        )
    });
    let path = path.to_string_lossy();
    if path.is_empty() || path.chars().any(|c| c < ' ') {
        return Err("refused invalid AI path".into());
    }
    let normalized = path.replace('\\', "/");
    let basename = normalized.rsplit('/').next().unwrap_or("");
    if patterns.is_match(basename) {
        return Err("refused sensitive AI file".into());
    }
    let comparison = normalized
        .split('/')
        .map(|part| {
            part.split(':')
                .next()
                .unwrap_or("")
                .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
                .to_lowercase()
        })
        .collect::<Vec<_>>()
        .join("/");
    let comparison = format!("{comparison}/");
    if directories
        .iter()
        .any(|dir| comparison.contains(&format!("{dir}/")))
    {
        return Err("refused protected AI directory".into());
    }
    Ok(())
}

fn authorized(registry: &WorkspaceRegistry, path: &Path) -> Result<PathBuf, String> {
    readable(path)?;
    let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
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

pub fn read_file(
    registry: &WorkspaceRegistry,
    path: &Path,
    limit: u64,
) -> Result<ReadResult, String> {
    let path = authorized(registry, path)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
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
            if !entry.file_type().is_some_and(|kind| kind.is_file())
                || authorized(&registry, entry.path()).is_err()
            {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&root_path) else {
                continue;
            };
            if !matcher.is_match(rel) {
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
            for (line, text) in content.split('\n').enumerate() {
                if !matcher.is_match(text) {
                    continue;
                }
                if hits.len() == cap {
                    truncated = true;
                    break 'files;
                }
                hits.push(GrepHit {
                    path: super::display_path(entry.path(), &root_path, &root, &workspace),
                    rel: super::to_canon(rel),
                    line: (line + 1) as u64,
                    text: text.into(),
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
