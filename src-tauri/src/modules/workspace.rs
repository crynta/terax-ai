use std::path::PathBuf;

use serde::{Deserialize, Serialize};

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
        WorkspaceEnv::Wsl { distro } => wsl_path_to_unc(distro, path),
    }
}

#[cfg(not(windows))]
pub fn resolve_path(path: &str, _workspace: &WorkspaceEnv) -> PathBuf {
    PathBuf::from(path)
}

#[cfg(windows)]
pub fn wsl_path_to_unc(distro: &str, path: &str) -> PathBuf {
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

#[tauri::command]
pub fn wsl_list_distros() -> Result<Vec<WslDistro>, String> {
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
    #[cfg(windows)]
    {
        let out = run_wsl(&["--list", "--verbose"])?;
        let mut distros = Vec::new();
        for raw in out.lines().skip(1) {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            let default = line.starts_with('*');
            let line = line.trim_start_matches('*').trim();
            let mut parts = line.split_whitespace();
            let name = match parts.next() {
                Some(n) => n.to_string(),
                None => continue,
            };
            let state = parts.next().unwrap_or_default();
            distros.push(WslDistro {
                name,
                default,
                running: state.eq_ignore_ascii_case("Running"),
            });
        }
        Ok(distros)
    }
}

#[tauri::command]
pub fn wsl_default_distro() -> Result<Option<String>, String> {
    let distros = wsl_list_distros()?;
    Ok(distros
        .iter()
        .find(|d| d.default)
        .map(|d| d.name.clone())
        .or_else(|| distros.first().map(|d| d.name.clone())))
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
        let out = run_wsl(&["-d", &distro, "--exec", "sh", "-lc", "printf %s \"$HOME\""])?;
        let home = out.trim().to_string();
        if home.is_empty() {
            Err(format!("could not resolve WSL home for {distro}"))
        } else {
            Ok(home)
        }
    }
}
