use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::local::root;
use super::resolve::binary_stem;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LspBinaryLink {
    Path { path: String },
    Wsl { distro: String, command: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct LinksFile {
    #[serde(default)]
    entries: HashMap<String, LspBinaryLink>,
}

fn links_path() -> std::path::PathBuf {
    root().join("links.json")
}

fn read_links() -> LinksFile {
    let path = links_path();
    if !path.is_file() {
        return LinksFile::default();
    }
    let raw = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_links(links: &LinksFile) -> Result<(), String> {
    let path = links_path();
    let json = serde_json::to_string_pretty(links).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn get_link(stem: &str) -> Option<LspBinaryLink> {
    read_links().entries.get(stem).cloned()
}

pub fn set_link(command: &str, link: LspBinaryLink) -> Result<(), String> {
    let stem = binary_stem(command).to_string();
    let link = match link {
        LspBinaryLink::Path { path } => {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                return Err("path is empty".into());
            }
            if !Path::new(trimmed).is_file() {
                return Err(format!("file not found: {trimmed}"));
            }
            LspBinaryLink::Path {
                path: trimmed.to_string(),
            }
        }
        LspBinaryLink::Wsl { distro, command: cmd } => {
            crate::modules::workspace::validate_wsl_distro_name(&distro)?;
            let trimmed = cmd.trim();
            if trimmed.is_empty() {
                return Err("WSL command is empty".into());
            }
            #[cfg(windows)]
            let resolved = if trimmed.contains('/') {
                trimmed.to_string()
            } else {
                probe_wsl_command(&distro, trimmed)?
            };
            #[cfg(not(windows))]
            let resolved = trimmed.to_string();
            LspBinaryLink::Wsl {
                distro,
                command: resolved,
            }
        }
    };
    let mut links = read_links();
    links.entries.insert(stem, link);
    write_links(&links)
}

pub fn clear_link(command: &str) -> Result<(), String> {
    let stem = binary_stem(command).to_string();
    let mut links = read_links();
    links.entries.remove(&stem);
    write_links(&links)
}

#[cfg(windows)]
pub fn probe_wsl_command(distro: &str, command: &str) -> Result<String, String> {
    use crate::modules::workspace::{normalize_wsl_value, validate_wsl_distro_name, wsl_exec_capture};

    validate_wsl_distro_name(distro)?;
    let stem = binary_stem(command);
    let script = format!(
        "command -v {stem} 2>/dev/null || which {stem} 2>/dev/null || type -p {stem} 2>/dev/null"
    );
    let out = wsl_exec_capture(distro, "sh", &["-lc", &script])?;
    let path = normalize_wsl_value(out, "");
    if path.is_empty() {
        return Err(format!("{stem} not found in WSL ({distro})"));
    }
    Ok(path)
}

#[cfg(not(windows))]
pub fn probe_wsl_command(_distro: &str, _command: &str) -> Result<String, String> {
    Err("WSL linking is only available on Windows".into())
}
