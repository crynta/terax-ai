use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

static ROOT: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ManifestFile {
    #[serde(default)]
    entries: HashMap<String, ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestEntry {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_local_data_dir() {
        let root = dir.join("lsp");
        let _ = fs::create_dir_all(&root);
        let _ = fs::create_dir_all(root.join("bin"));
        let _ = fs::create_dir_all(root.join("servers"));
        let _ = fs::create_dir_all(root.join("runtime"));
        let _ = ROOT.set(root);
    }
}

pub fn root() -> PathBuf {
    ROOT.get().cloned().unwrap_or_else(|| {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Terax")
            .join("lsp")
    })
}

pub fn is_under_root(path: &Path) -> bool {
    path.starts_with(root())
}

fn manifest_path() -> PathBuf {
    root().join("manifest.json")
}

fn read_manifest() -> ManifestFile {
    let path = manifest_path();
    if !path.is_file() {
        return ManifestFile::default();
    }
    let raw = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_manifest(manifest: &ManifestFile) -> Result<(), String> {
    let path = manifest_path();
    let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn set_manifest_entry(stem: &str, path: PathBuf, version: Option<String>) -> Result<(), String> {
    let mut manifest = read_manifest();
    manifest.entries.insert(
        stem.to_string(),
        ManifestEntry {
            path: path.to_string_lossy().into_owned(),
            version,
        },
    );
    write_manifest(&manifest)
}

pub fn find_local_binary(stem: &str) -> Option<PathBuf> {
    let manifest = read_manifest();
    let entry = manifest.entries.get(stem)?;
    let path = PathBuf::from(&entry.path);
    if path.is_file() {
        return Some(path);
    }
    None
}

pub fn bin_dir() -> PathBuf {
    root().join("bin")
}

pub fn servers_dir() -> PathBuf {
    root().join("servers")
}

pub fn server_prefix(id: &str) -> PathBuf {
    servers_dir().join(id)
}

pub fn node_runtime_dir() -> PathBuf {
    root().join("runtime").join("node")
}

pub fn go_runtime_dir() -> PathBuf {
    root().join("runtime").join("go")
}

pub fn go_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    let exe = go_runtime_dir().join("bin").join("go.exe");
    #[cfg(not(windows))]
    let exe = go_runtime_dir().join("bin").join("go");
    if exe.is_file() {
        Some(exe)
    } else {
        None
    }
}

pub fn node_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let exe = node_runtime_dir().join("node.exe");
        if exe.is_file() {
            return Some(exe);
        }
    }
    #[cfg(not(windows))]
    {
        let exe = node_runtime_dir().join("bin").join("node");
        if exe.is_file() {
            return Some(exe);
        }
    }
    None
}

pub fn npm_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let cmd = node_runtime_dir().join("npm.cmd");
        if cmd.is_file() {
            return Some(cmd);
        }
    }
    #[cfg(not(windows))]
    {
        let bin = node_runtime_dir().join("bin").join("npm");
        if bin.is_file() {
            return Some(bin);
        }
    }
    None
}

/// Prepend Terax-managed binaries (portable Node, native LSP bin dir) to PATH so
/// npm-based language servers work without a system Node install.
pub fn apply_lsp_environment(cmd: &mut std::process::Command) {
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Some(node) = node_executable() {
        if let Some(parent) = node.parent() {
            paths.push(parent.to_path_buf());
        }
    }
    if let Some(go) = go_executable() {
        if let Some(parent) = go.parent() {
            paths.push(parent.to_path_buf());
        }
    }
    paths.push(bin_dir());
    if let Some(path_var) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path_var));
    }
    if let Ok(joined) = std::env::join_paths(paths.iter().map(|p| p.as_os_str())) {
        cmd.env("PATH", joined);
    }
}
