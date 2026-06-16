use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
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
            let cache = self
                .canonical_cache
                .lock()
                .expect("canonical cache poisoned");
            if let Some(entry) = cache.get(&key) {
                if entry.inserted_at.elapsed() < CANONICAL_TTL {
                    return Ok(entry.canonical.clone());
                }
            }
        }
        let canonical = std::fs::canonicalize(&key)?;
        let mut cache = self
            .canonical_cache
            .lock()
            .expect("canonical cache poisoned");
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
    if workspace.is_ssh() {
        return Ok(cwd
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from));
    }
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = resolve_path(cwd, workspace);
    let canonical =
        std::fs::canonicalize(&resolved).map_err(|e| format!("cwd not accessible: {e}"))?;
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

// User-initiated terminal spawn: canonicalize, require a real dir, and register
// it as a root instead of rejecting paths outside existing roots.
pub fn authorize_user_spawn_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Option<PathBuf>, String> {
    if workspace.is_ssh() {
        return Ok(cwd
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from));
    }
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = resolve_path(cwd, workspace);
    let canonical =
        std::fs::canonicalize(&resolved).map_err(|e| format!("cwd not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("cwd is not a directory: {}", canonical.display()));
    }
    registry.authorize(&canonical).map_err(|e| e.to_string())?;
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
    if workspace.is_ssh() {
        return Ok(normalize_remote_path(&path));
    }
    let resolved = resolve_path(&path, &workspace);
    let canonical = registry.authorize(&resolved).map_err(|e| e.to_string())?;
    Ok(crate::modules::fs::to_canon(&canonical))
}

#[tauri::command]
pub async fn workspace_current_dir(
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<String, String> {
    let launch = resolve_launch_dir();
    let canonical = registry.authorize(&launch).map_err(|e| e.to_string())?;
    Ok(crate::modules::fs::to_canon(&canonical))
}

// Snapshotted once at app startup so the live `current_dir()` drifting later
// (file dialogs, plugin chdir) can't shift the value seen by IPC or spawn.
static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn init_launch_cwd(cli_dir: Option<&str>) {
    LAUNCH_CWD.get_or_init(|| resolve_launch_cwd(cli_dir, std::env::current_dir().ok()));
}

fn resolve_launch_cwd(cli_dir: Option<&str>, env_cwd: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(dir) = cli_dir {
        let p = PathBuf::from(dir);
        if p.is_dir() {
            return Some(p);
        }
    }
    env_cwd.filter(|p| is_usable_launch_dir(p))
}

pub fn launch_cwd_snapshot() -> Option<PathBuf> {
    LAUNCH_CWD.get().and_then(|o| o.clone())
}

fn resolve_launch_dir() -> PathBuf {
    if let Some(cwd) = launch_cwd_snapshot() {
        return cwd;
    }
    if let Some(cwd) = std::env::current_dir()
        .ok()
        .filter(|p| is_usable_launch_dir(p))
    {
        return cwd;
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn is_usable_launch_dir(path: &Path) -> bool {
    if !path.is_dir() || path == Path::new("/") {
        return false;
    }
    if is_executable_dir(path) {
        return false;
    }
    let s = path.to_string_lossy();
    if s.contains(".app/Contents/") {
        return false;
    }
    // The AppImage mount (/tmp/.mount_*) is not a real working directory.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPDIR").is_some_and(|appdir| path.starts_with(&appdir)) {
        return false;
    }
    if cfg!(debug_assertions) && path.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
        return false;
    }
    true
}

fn is_executable_dir(path: &Path) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe.parent() else {
        return false;
    };
    match (std::fs::canonicalize(path), std::fs::canonicalize(exe_dir)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[cfg(target_os = "linux")]
const APPIMAGE_PATH_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "PATH",
    "XDG_DATA_DIRS",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GST_PLUGIN_PATH",
    "GI_TYPELIB_PATH",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
];

#[cfg(target_os = "linux")]
const APPIMAGE_VALUE_VARS: &[&str] = &[
    "GDK_PIXBUF_MODULE_FILE",
    "LD_PRELOAD",
    "FONTCONFIG_FILE",
    "FONTCONFIG_PATH",
];

#[cfg(target_os = "linux")]
const APPIMAGE_MARKER_VARS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0"];

pub fn appimage_env_overrides() -> Vec<(&'static str, Option<OsString>)> {
    #[cfg(target_os = "linux")]
    {
        let Some(appdir) = std::env::var_os("APPDIR") else {
            return Vec::new();
        };
        compute_appimage_env_overrides(Path::new(&appdir), |k| std::env::var_os(k))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "linux")]
fn compute_appimage_env_overrides(
    appdir: &Path,
    read: impl Fn(&str) -> Option<OsString>,
) -> Vec<(&'static str, Option<OsString>)> {
    let mut out = Vec::new();

    for &key in APPIMAGE_PATH_VARS {
        let Some(val) = read(key) else { continue };
        let original: Vec<PathBuf> = std::env::split_paths(&val).collect();
        let kept: Vec<PathBuf> = original
            .iter()
            .filter(|p| !p.as_os_str().is_empty() && !p.starts_with(appdir))
            .cloned()
            .collect();
        if kept.len() == original.len() {
            continue; // nothing AppImage-injected; leave as-is
        }
        match std::env::join_paths(&kept) {
            Ok(joined) if !kept.is_empty() => out.push((key, Some(joined))),
            _ => out.push((key, None)),
        }
    }

    for &key in APPIMAGE_VALUE_VARS {
        if read(key).is_some_and(|v| Path::new(&v).starts_with(appdir)) {
            out.push((key, None));
        }
    }

    for &key in APPIMAGE_MARKER_VARS {
        if read(key).is_some() {
            out.push((key, None));
        }
    }

    out
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkspaceEnv {
    #[default]
    Local,
    Wsl {
        distro: String,
    },
    Ssh {
        host: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        user: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        port: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        root: Option<String>,
    },
}

impl WorkspaceEnv {
    pub fn from_option(workspace: Option<Self>) -> Self {
        workspace.unwrap_or_default()
    }

    pub fn is_wsl(&self) -> bool {
        matches!(self, Self::Wsl { .. })
    }

    pub fn is_ssh(&self) -> bool {
        matches!(self, Self::Ssh { .. })
    }

    pub fn ssh_root(&self) -> Option<&str> {
        match self {
            Self::Ssh { root, .. } => root.as_deref(),
            _ => None,
        }
    }
}

fn safe_ssh_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.chars().any(|c| {
            c.is_whitespace()
                || c.is_control()
                || matches!(
                    c,
                    '"' | '\'' | '`' | '$' | ';' | '&' | '|' | '<' | '>' | '(' | ')'
                )
        })
}

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return "/".into();
    }
    let mut out = trimmed.replace('\\', "/");
    while out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    if out.starts_with('/') {
        out
    } else {
        format!("/{out}")
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

const SSH_CONTROL_PATH: &str = "/tmp/terax-ssh-%C";

pub(crate) fn ssh_target(workspace: &WorkspaceEnv) -> Result<String, String> {
    let WorkspaceEnv::Ssh { host, user, .. } = workspace else {
        return Err("workspace is not SSH".into());
    };
    if !safe_ssh_component(host) {
        return Err("invalid SSH host".into());
    }
    if let Some(user) = user.as_deref() {
        if !safe_ssh_component(user) {
            return Err("invalid SSH user".into());
        }
        Ok(format!("{user}@{host}"))
    } else {
        Ok(host.clone())
    }
}

pub(crate) fn ssh_command(workspace: &WorkspaceEnv, batch_mode: bool) -> Result<Command, String> {
    let WorkspaceEnv::Ssh { port, .. } = workspace else {
        return Err("workspace is not SSH".into());
    };
    let target = ssh_target(workspace)?;
    let mut cmd = Command::new("ssh");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("ControlMaster=auto");
    cmd.arg("-o").arg("ControlPersist=1h");
    cmd.arg("-o").arg(format!("ControlPath={SSH_CONTROL_PATH}"));
    if batch_mode {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    if let Some(port) = port {
        cmd.arg("-p").arg(port.to_string());
    }
    cmd.arg(target);
    Ok(cmd)
}

fn ssh_config_user(workspace: &WorkspaceEnv) -> Result<Option<String>, String> {
    let WorkspaceEnv::Ssh { port, user, .. } = workspace else {
        return Err("workspace is not SSH".into());
    };
    if let Some(user) = user.as_deref() {
        if safe_ssh_component(user) {
            return Ok(Some(user.to_string()));
        }
    }
    let target = ssh_target(workspace)?;
    let mut cmd = Command::new("ssh");
    cmd.arg("-G");
    if let Some(port) = port {
        cmd.arg("-p").arg(port.to_string());
    }
    cmd.arg(target);
    crate::modules::proc::hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout.lines().find_map(|line| {
        let trimmed = line.trim();
        let value = trimmed
            .strip_prefix("user ")
            .or_else(|| trimmed.strip_prefix("User "))?
            .trim();
        if safe_ssh_component(value) {
            Some(value.to_string())
        } else {
            None
        }
    }))
}

fn linux_home_for_user(user: Option<String>) -> String {
    match user.as_deref() {
        Some("root") => "/root".into(),
        Some(user) if safe_ssh_component(user) => format!("/home/{user}"),
        _ => std::env::var("USER")
            .ok()
            .filter(|user| safe_ssh_component(user))
            .map(|user| format!("/home/{user}"))
            .unwrap_or_else(|| "/".into()),
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
        WorkspaceEnv::Ssh { .. } => PathBuf::from(path),
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
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.args(args);
    crate::modules::proc::hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
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
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg(program)
        .args(args);
    crate::modules::proc::hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn ssh_home(workspace: WorkspaceEnv) -> Result<String, String> {
    let root = workspace.ssh_root().map(normalize_remote_path);
    if let Some(root) = root {
        if !root.is_empty() {
            let mut cmd = ssh_command(&workspace, true)?;
            cmd.arg(format!(
                "test -d {} && printf %s {}",
                shell_quote(&root),
                shell_quote(&root)
            ));
            crate::modules::proc::hide_console(&mut cmd);
            let out = cmd.output().map_err(|e| e.to_string())?;
            if out.status.success() {
                return Ok(root);
            }
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!("SSH root is not a directory: {root}")
            } else {
                stderr
            });
        }
    }
    let mut cmd = ssh_command(&workspace, true)?;
    cmd.arg("sh").arg("-lc").arg("printf %s \"$HOME\"");
    crate::modules::proc::hide_console(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ssh home lookup failed".into()
        } else {
            stderr
        });
    }
    let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if home.is_empty() {
        Err("could not resolve SSH home".into())
    } else {
        Ok(normalize_remote_path(&home))
    }
}

#[tauri::command]
pub fn ssh_default_root(workspace: WorkspaceEnv) -> Result<String, String> {
    let WorkspaceEnv::Ssh { root, .. } = &workspace else {
        return Err("workspace is not SSH".into());
    };
    if let Some(root) = root.as_deref().map(normalize_remote_path) {
        if !root.is_empty() {
            return Ok(root);
        }
    }
    Ok(linux_home_for_user(ssh_config_user(&workspace)?))
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
    fn ssh_target_formats_user_host_portless() {
        let env = WorkspaceEnv::Ssh {
            host: "example-host".into(),
            user: Some("devuser".into()),
            port: None,
            root: Some("/home/devuser/project".into()),
        };
        assert_eq!(ssh_target(&env).unwrap(), "devuser@example-host");
    }

    #[test]
    fn ssh_target_rejects_shell_metacharacters() {
        let env = WorkspaceEnv::Ssh {
            host: "host;rm".into(),
            user: Some("devuser".into()),
            port: None,
            root: None,
        };
        assert!(ssh_target(&env).is_err());
    }

    #[test]
    fn ssh_authorize_spawn_cwd_does_not_touch_local_filesystem() {
        let reg = WorkspaceRegistry::default();
        let env = WorkspaceEnv::Ssh {
            host: "example-host".into(),
            user: Some("devuser".into()),
            port: Some(22),
            root: None,
        };
        let resolved = authorize_spawn_cwd(&reg, Some("/remote/path"), &env)
            .expect("ssh cwd accepted")
            .expect("cwd returned");
        assert_eq!(resolved, PathBuf::from("/remote/path"));
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
    fn authorize_user_spawn_cwd_registers_unauthorized_path() {
        let dir = tempdir("userspawn");
        let reg = WorkspaceRegistry::default();
        let s = dir.to_string_lossy().into_owned();
        assert!(!reg.is_authorized(&dir));
        let resolved = authorize_user_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect("user spawn allowed anywhere")
            .expect("returned canonical");
        assert_eq!(resolved, dir);
        assert!(reg.is_authorized(&dir));
    }

    #[test]
    fn authorize_user_spawn_cwd_rejects_missing_path() {
        let mut missing = env::temp_dir();
        missing.push(format!("terax-user-missing-{}", std::process::id()));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        let err = authorize_user_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("missing path must fail");
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

    #[test]
    fn resolve_launch_cwd_prefers_cli_dir_over_env() {
        let cli = tempdir("cli");
        let env = tempdir("env");
        let s = cli.to_string_lossy().into_owned();
        let resolved = resolve_launch_cwd(Some(&s), Some(env.clone()));
        assert_eq!(resolved.as_deref(), Some(cli.as_path()));
    }

    #[test]
    fn resolve_launch_cwd_falls_back_to_env_when_cli_missing() {
        let env = tempdir("envonly");
        assert_eq!(resolve_launch_cwd(None, Some(env.clone())), Some(env));
    }

    #[test]
    fn resolve_launch_cwd_ignores_nonexistent_cli_dir() {
        let env = tempdir("envfb");
        let resolved = resolve_launch_cwd(Some("/no/such/terax/dir"), Some(env.clone()));
        assert_eq!(resolved, Some(env));
    }
}

#[cfg(all(test, target_os = "linux"))]
mod appimage_tests {
    use super::*;
    use std::collections::HashMap;

    fn reader(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    fn find<'a>(
        out: &'a [(&'static str, Option<OsString>)],
        key: &str,
    ) -> Option<&'a Option<OsString>> {
        out.iter().find(|(k, _)| *k == key).map(|(_, v)| v)
    }

    #[test]
    fn strips_appdir_from_path_lists_and_unsets_when_empty() {
        let appdir = Path::new("/tmp/.mount_Terax_X");
        let env = reader(&[
            ("LD_LIBRARY_PATH", "/tmp/.mount_Terax_X/usr/lib:/usr/lib"),
            ("PATH", "/tmp/.mount_Terax_X/usr/bin:/usr/bin:/bin"),
            ("GST_PLUGIN_SYSTEM_PATH", "/tmp/.mount_Terax_X/usr/lib/gstreamer-1.0"),
            ("APPDIR", "/tmp/.mount_Terax_X"),
        ]);
        let out = compute_appimage_env_overrides(appdir, env);

        assert_eq!(find(&out, "LD_LIBRARY_PATH"), Some(&Some(OsString::from("/usr/lib"))));
        assert_eq!(find(&out, "PATH"), Some(&Some(OsString::from("/usr/bin:/bin"))));
        // Only an APPDIR entry, so the var is removed entirely.
        assert_eq!(find(&out, "GST_PLUGIN_SYSTEM_PATH"), Some(&None));
        assert_eq!(find(&out, "APPDIR"), Some(&None));
    }

    #[test]
    fn leaves_untouched_vars_alone() {
        let appdir = Path::new("/tmp/.mount_Terax_X");
        let env = reader(&[
            ("LD_LIBRARY_PATH", "/usr/lib:/usr/local/lib"),
            ("LD_PRELOAD", "/home/u/my.so"),
        ]);
        let out = compute_appimage_env_overrides(appdir, env);

        // No APPDIR component => no override emitted for these.
        assert!(find(&out, "LD_LIBRARY_PATH").is_none());
        assert!(find(&out, "LD_PRELOAD").is_none());
    }

    #[test]
    fn unsets_value_vars_only_when_pointing_into_appdir() {
        let appdir = Path::new("/tmp/.mount_Terax_X");
        let into = reader(&[("LD_PRELOAD", "/tmp/.mount_Terax_X/usr/lib/x.so")]);
        assert_eq!(find(&compute_appimage_env_overrides(appdir, into), "LD_PRELOAD"), Some(&None));

        let outside = reader(&[("FONTCONFIG_FILE", "/etc/fonts/fonts.conf")]);
        assert!(find(&compute_appimage_env_overrides(appdir, outside), "FONTCONFIG_FILE").is_none());
    }
}
