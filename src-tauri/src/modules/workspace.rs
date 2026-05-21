use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

// Short TTL keeps the auth-check TOCTOU window tight while still coalescing the
// burst of canonicalize calls within a single panel refresh (~100ms).
const CANONICAL_TTL: Duration = Duration::from_secs(1);
const CANONICAL_CACHE_CAP: usize = 256;

struct CanonicalEntry {
    canonical: PathBuf,
    inserted_at: Instant,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    roots: Mutex<HashSet<PathBuf>>,
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>,
}

impl WorkspaceRegistry {
    pub fn authorize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let canonical = std::fs::canonicalize(path.as_ref())?;
        let mut set = self.roots.lock().expect("workspace registry poisoned");
        set.insert(canonical.clone());
        Ok(canonical)
    }

    pub fn is_authorized(&self, target: &Path) -> bool {
        let set = self.roots.lock().expect("workspace registry poisoned");
        set.iter().any(|root| target.starts_with(root))
    }

    pub fn canonicalize_cached<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let key = path.as_ref().to_path_buf();
        {
            let cache = self.canonical_cache.lock().expect("canonical cache poisoned");
            if let Some(entry) = cache.get(&key) {
                if entry.inserted_at.elapsed() < CANONICAL_TTL {
                    return Ok(entry.canonical.clone());
                }
            }
        }
        let canonical = std::fs::canonicalize(&key)?;
        let mut cache = self.canonical_cache.lock().expect("canonical cache poisoned");
        if cache.len() >= CANONICAL_CACHE_CAP {
            cache.retain(|_, entry| entry.inserted_at.elapsed() < CANONICAL_TTL);
            if cache.len() >= CANONICAL_CACHE_CAP {
                cache.clear();
            }
        }
        cache.insert(
            key,
            CanonicalEntry {
                canonical: canonical.clone(),
                inserted_at: Instant::now(),
            },
        );
        Ok(canonical)
    }

}

// `None` means "use bootstrapped default". `Some` is canonicalized to defeat
// symlink/`..` traversal and must sit under an authorized root.
pub fn authorize_spawn_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = resolve_path(cwd, workspace);
    let canonical = std::fs::canonicalize(&resolved)
        .map_err(|e| format!("cwd not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("cwd is not a directory: {}", canonical.display()));
    }
    if !registry.is_authorized(&canonical) {
        return Err(format!(
            "cwd is outside the authorized workspace: {}",
            canonical.display()
        ));
    }
    Ok(Some(canonical))
}

pub fn bootstrap_registry(registry: &WorkspaceRegistry) {
    let _ = registry.authorize(resolve_launch_dir());
    if let Some(home) = dirs::home_dir() {
        let _ = registry.authorize(home);
    }
}

#[tauri::command]
pub async fn workspace_authorize(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let resolved = resolve_path(&path, &workspace);
    let canonical = registry.authorize(&resolved).map_err(|e| e.to_string())?;
    Ok(canonical.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub async fn workspace_current_dir(
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<String, String> {
    let launch = resolve_launch_dir();
    let canonical = registry.authorize(&launch).map_err(|e| e.to_string())?;
    Ok(canonical.to_string_lossy().replace('\\', "/"))
}

// Snapshotted once at app startup so the live `current_dir()` drifting later
// (file dialogs, plugin chdir) can't shift the value seen by IPC or spawn.
static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn init_launch_cwd() {
    LAUNCH_CWD.get_or_init(|| {
        std::env::current_dir()
            .ok()
            .filter(|p| is_usable_launch_dir(p))
    });
}

pub fn launch_cwd_snapshot() -> Option<PathBuf> {
    LAUNCH_CWD.get().and_then(|o| o.clone())
}

fn resolve_launch_dir() -> PathBuf {
    if let Some(cwd) = launch_cwd_snapshot() {
        return cwd;
    }
    if let Some(cwd) = std::env::current_dir().ok().filter(|p| is_usable_launch_dir(p)) {
        return cwd;
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn is_usable_launch_dir(path: &Path) -> bool {
    if !path.is_dir() || path == Path::new("/") {
        return false;
    }
    let s = path.to_string_lossy();
    if s.contains(".app/Contents/") {
        return false;
    }
    if cfg!(debug_assertions) && path.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
        return false;
    }
    true
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkspaceEnv {
    #[default]
    Local,
    Wsl {
        distro: String,
    },
}

impl WorkspaceEnv {
    pub fn from_option(workspace: Option<Self>) -> Self {
        workspace.unwrap_or_default()
    }

    pub fn is_wsl(&self) -> bool {
        matches!(self, Self::Wsl { .. })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub default: bool,
    pub running: bool,
}

#[cfg(windows)]
pub fn resolve_path(path: &str, workspace: &WorkspaceEnv) -> PathBuf {
    match workspace {
        WorkspaceEnv::Local => PathBuf::from(path),
        WorkspaceEnv::Wsl { distro } => wsl_path_to_host(distro, path),
    }
}

#[cfg(not(windows))]
pub fn resolve_path(path: &str, _workspace: &WorkspaceEnv) -> PathBuf {
    PathBuf::from(path)
}

/// True for WSL distro names safe to splice into a UNC path. Real WSL distros
/// are alphanumeric with `.`, `_`, `-` separators (e.g. `Ubuntu-22.04`). Reject
/// anything that could traverse out of the `\\wsl.localhost\<distro>\` prefix
/// (`..`, `\`, `/`, `:`, `?`, `*`, control bytes) or empty names.
#[cfg(windows)]
fn is_safe_distro_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    if name == "." || name == ".." || name.starts_with('.') {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
        && !name.contains("..")
}

#[cfg(windows)]
pub(crate) fn validate_wsl_distro_name(distro: &str) -> Result<(), String> {
    if is_safe_distro_name(distro) {
        Ok(())
    } else {
        Err(format!("unsafe WSL distro name: {distro}"))
    }
}

#[cfg(windows)]
fn wsl_drvfs_to_windows(path: &str) -> Option<PathBuf> {
    let normalized = path.replace('\\', "/");
    let rest = normalized.strip_prefix("/mnt/")?;
    let mut parts = rest.splitn(2, '/');
    let drive = parts.next()?;
    if drive.len() != 1 {
        return None;
    }
    let drive = drive.chars().next()?;
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    let suffix = parts.next().unwrap_or("").replace('/', "\\");
    let mut host = format!("{}:\\", drive.to_ascii_uppercase());
    if !suffix.is_empty() {
        host.push_str(&suffix);
    }
    Some(PathBuf::from(host))
}

#[cfg(windows)]
pub fn wsl_path_to_unc(distro: &str, path: &str) -> PathBuf {
    // Defense-in-depth: refuse to construct a UNC path with a distro name that
    // could escape the WSL share root via `..`, `\`, or other path metachars.
    // Returns a clearly-invalid path that downstream `is_dir()`/`metadata()`
    // checks will reject. The webview's distro list comes from `wsl.exe --list`
    // and is normally trustworthy, but a locally-registered malicious distro
    // can name itself with traversal characters; this filter blocks that.
    if !is_safe_distro_name(distro) {
        return PathBuf::from(r"\\wsl.localhost\__terax_invalid_distro__");
    }
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    let primary = PathBuf::from(format!(
        r"\\wsl.localhost\{}\{}",
        distro,
        trimmed.replace('/', r"\")
    ));
    if primary.exists() {
        return primary;
    }
    PathBuf::from(format!(r"\\wsl$\{}\{}", distro, trimmed.replace('/', r"\")))
}

#[cfg(windows)]
pub fn wsl_path_to_host(distro: &str, path: &str) -> PathBuf {
    // `/mnt/<drive>` is drvfs-backed Windows storage. Accessing it through the
    // WSL UNC share can return "Access is denied" on Windows even though the
    // same path is readable inside WSL. Use the native drive path instead.
    wsl_drvfs_to_windows(path).unwrap_or_else(|| wsl_path_to_unc(distro, path))
}

#[cfg(windows)]
pub fn decode_command_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || looks_utf16le(bytes) {
        let start = if bytes.starts_with(&[0xff, 0xfe]) {
            2
        } else {
            0
        };
        let units: Vec<u16> = bytes[start..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(windows)]
fn looks_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || !bytes.len().is_multiple_of(2) {
        return false;
    }
    let nul_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    nul_odd * 2 >= bytes.len() / 2
}

#[cfg(windows)]
fn run_wsl(args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("wsl.exe")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = decode_command_output(&out.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(decode_command_output(&out.stdout))
}

#[cfg(windows)]
pub(crate) fn wsl_exec_capture(
    distro: &str,
    program: &str,
    args: &[&str],
) -> Result<String, String> {
    validate_wsl_distro_name(distro)?;
    let out = std::process::Command::new("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg(program)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = decode_command_output(&out.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(decode_command_output(&out.stdout))
}

#[cfg(windows)]
fn run_wsl_sh(distro: &str, script: &str) -> Result<String, String> {
    // Probe helpers must avoid login-shell startup files. User `.profile`
    // output on stdout would corrupt the parsed value (`$HOME`, login shell).
    wsl_exec_capture(distro, "sh", &["-c", script])
}

#[cfg(windows)]
pub(crate) fn normalize_wsl_value(output: String, fallback: &str) -> String {
    let value = output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

#[cfg(windows)]
fn list_distros_blocking() -> Result<Vec<WslDistro>, String> {
    let out = run_wsl(&["--list", "--verbose"])?;
    let mut distros = Vec::new();
    for raw in out.lines().skip(1) {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let default = line.starts_with('*');
        let line = line.trim_start_matches('*').trim();
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let state_idx = parts.len() - 2;
        let name = parts[..state_idx].join(" ");
        let state = parts[state_idx];
        distros.push(WslDistro {
            name,
            default,
            running: state.eq_ignore_ascii_case("Running"),
        });
    }
    Ok(distros)
}

#[tauri::command]
pub async fn wsl_list_distros() -> Result<Vec<WslDistro>, String> {
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(list_distros_blocking)
            .await
            .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
pub async fn wsl_default_distro() -> Result<Option<String>, String> {
    #[cfg(not(windows))]
    {
        Ok(None)
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let distros = list_distros_blocking()?;
            Ok(distros
                .iter()
                .find(|d| d.default)
                .map(|d| d.name.clone())
                .or_else(|| distros.first().map(|d| d.name.clone())))
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
pub fn wsl_home(distro: String) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = distro;
        Err("WSL is only available on Windows".into())
    }
    #[cfg(windows)]
    {
        let out = run_wsl_sh(&distro, "printf %s \"$HOME\"")?;
        let home = normalize_wsl_value(out, "");
        if home.is_empty() {
            Err(format!("could not resolve WSL home for {distro}"))
        } else {
            Ok(home)
        }
    }
}

#[cfg(windows)]
pub fn wsl_login_shell(distro: String) -> Result<String, String> {
    const SCRIPT: &str = r#"uid="$(id -u 2>/dev/null || printf '')"
entry=''
if [ -n "$uid" ] && command -v getent >/dev/null 2>&1; then
  entry="$(getent passwd "$uid" 2>/dev/null || true)"
fi
if [ -z "$entry" ] && [ -n "$uid" ] && [ -r /etc/passwd ]; then
  entry="$(awk -F: -v u="$uid" '$3 == u { print; exit }' /etc/passwd 2>/dev/null)"
fi
shell=''
if [ -n "$entry" ]; then
  shell="${entry##*:}"
fi
if [ -z "$shell" ] && [ -n "$SHELL" ]; then
  shell="$SHELL"
fi
if [ -z "$shell" ]; then
  shell=/bin/sh
fi
printf %s "$shell""#;

    let out = run_wsl_sh(&distro, SCRIPT)?;
    Ok(normalize_wsl_value(out, "/bin/sh"))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn distro_validator_accepts_real_names() {
        assert!(is_safe_distro_name("Ubuntu"));
        assert!(is_safe_distro_name("Ubuntu-22.04"));
        assert!(is_safe_distro_name("Debian"));
        assert!(is_safe_distro_name("Alpine_3.18"));
        assert!(is_safe_distro_name("openSUSE-Tumbleweed"));
    }

    #[test]
    fn distro_validator_rejects_path_traversal() {
        assert!(!is_safe_distro_name(".."));
        assert!(!is_safe_distro_name("..\\..\\Windows"));
        assert!(!is_safe_distro_name("../foo"));
        assert!(!is_safe_distro_name("foo/bar"));
        assert!(!is_safe_distro_name("foo\\bar"));
        assert!(!is_safe_distro_name("foo..bar"));
    }

    #[test]
    fn distro_validator_rejects_special_chars() {
        assert!(!is_safe_distro_name("foo:bar"));
        assert!(!is_safe_distro_name("foo?bar"));
        assert!(!is_safe_distro_name("foo*bar"));
        assert!(!is_safe_distro_name("foo\0bar"));
        assert!(!is_safe_distro_name(""));
        assert!(!is_safe_distro_name(".hidden"));
    }

    #[test]
    fn wsl_path_to_unc_blocks_traversal_distro() {
        // Malicious distro name must produce a path that is_dir() will reject,
        // never escape the WSL share root.
        let p = wsl_path_to_unc("..\\..\\..\\Windows", "/etc/passwd");
        let s = p.to_string_lossy();
        assert!(s.contains("__terax_invalid_distro__"), "got: {s}");
        assert!(!s.contains("\\..\\"), "got: {s}");
    }

    #[test]
    fn wsl_path_to_unc_accepts_valid_distro() {
        let p = wsl_path_to_unc("Ubuntu", "/etc/hosts");
        let s = p.to_string_lossy();
        assert!(!s.contains("__terax_invalid_distro__"), "got: {s}");
    }

    #[test]
    fn resolve_path_keeps_local_paths_unchanged() {
        let path = r"C:\Users\vinicios\repo";
        assert_eq!(
            resolve_path(path, &WorkspaceEnv::Local),
            PathBuf::from(path)
        );
    }

    #[test]
    fn resolve_path_maps_wsl_paths_to_host() {
        let workspace = WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        };
        assert_eq!(
            resolve_path("/home/vinicios/repo", &workspace),
            wsl_path_to_host("Ubuntu", "/home/vinicios/repo")
        );
    }

    #[test]
    fn wsl_drvfs_root_maps_to_windows_drive() {
        assert_eq!(wsl_drvfs_to_windows("/mnt/c"), Some(PathBuf::from(r"C:\")));
    }

    #[test]
    fn wsl_drvfs_child_maps_to_windows_drive() {
        assert_eq!(
            wsl_drvfs_to_windows("/mnt/d/Users/vinicios/repo"),
            Some(PathBuf::from(r"D:\Users\vinicios\repo"))
        );
    }

    #[test]
    fn wsl_drvfs_rejects_non_drive_mounts() {
        assert_eq!(wsl_drvfs_to_windows("/mnt/wsl"), None);
        assert_eq!(wsl_drvfs_to_windows("/home/vinicios"), None);
    }

    #[test]
    fn normalize_wsl_value_uses_last_nonempty_line() {
        assert_eq!(
            normalize_wsl_value("banner\n  /bin/zsh \n".into(), "/bin/sh"),
            "/bin/zsh"
        );
    }

    #[test]
    fn normalize_wsl_value_falls_back_when_empty() {
        assert_eq!(normalize_wsl_value(" \n".into(), "/bin/sh"), "/bin/sh");
    }
}

#[cfg(test)]
mod auth_tests {
    use super::*;
    use std::env;
    use std::fs;

    fn tempdir(label: &str) -> PathBuf {
        let mut p = env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!("terax-auth-{label}-{nanos}-{}", std::process::id()));
        fs::create_dir_all(&p).expect("create tempdir");
        fs::canonicalize(&p).expect("canonicalize tempdir")
    }

    #[test]
    fn authorize_spawn_cwd_accepts_none() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, None, &WorkspaceEnv::Local)
            .unwrap()
            .is_none());
    }

    #[test]
    fn authorize_spawn_cwd_accepts_empty_string() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, Some("   "), &WorkspaceEnv::Local)
            .unwrap()
            .is_none());
    }

    #[test]
    fn authorize_spawn_cwd_accepts_authorized_path() {
        let dir = tempdir("ok");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).expect("authorize root");
        let s = dir.to_string_lossy().into_owned();
        let resolved = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect("authorized")
            .expect("returned canonical");
        assert_eq!(resolved, dir);
    }

    #[test]
    fn authorize_spawn_cwd_accepts_subdir_of_authorized_root() {
        let root = tempdir("subroot");
        let sub = root.join("inside");
        fs::create_dir_all(&sub).expect("subdir");
        let canonical_sub = fs::canonicalize(&sub).expect("canon sub");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&root).expect("authorize root");
        let s = canonical_sub.to_string_lossy().into_owned();
        let resolved = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect("subdir authorized")
            .expect("returned canonical");
        assert_eq!(resolved, canonical_sub);
    }

    #[test]
    fn authorize_spawn_cwd_rejects_unauthorized_path() {
        let allowed = tempdir("allowed");
        let foreign = tempdir("foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let s = foreign.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("should reject unauthorized cwd");
        assert!(err.contains("outside"), "got: {err}");
    }

    #[test]
    fn authorize_spawn_cwd_rejects_missing_path() {
        let mut missing = env::temp_dir();
        missing.push(format!(
            "terax-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("should reject missing path");
        assert!(err.contains("cwd not accessible"), "got: {err}");
    }

    #[test]
    fn authorize_spawn_cwd_blocks_symlink_escape() {
        let allowed = tempdir("symroot");
        let outside = tempdir("symtarget");
        let link = allowed.join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, &link).expect("symlink");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let s = link.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("symlink-escape must be rejected");
        assert!(err.contains("outside"), "got: {err}");
    }
}
