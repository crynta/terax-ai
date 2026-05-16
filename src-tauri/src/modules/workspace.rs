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
    Ssh {
        host: String,
        user: Option<String>,
        port: Option<u16>,
        key_path: Option<String>,
        password: Option<String>,
    },
}

impl WorkspaceEnv {
    pub fn from_option(workspace: Option<Self>) -> Self {
        workspace.unwrap_or_default()
    }

    pub fn is_wsl(&self) -> bool {
        matches!(self, Self::Wsl { .. })
    }

    #[allow(dead_code)]
    pub fn is_ssh(&self) -> bool {
        matches!(self, Self::Ssh { .. })
    }

    #[allow(dead_code)]
    pub fn ssh_target(&self) -> Option<String> {
        match self {
            Self::Ssh { host, user, port, .. } => {
                let mut target = String::new();
                if let Some(u) = user {
                    target.push_str(u);
                    target.push('@');
                }
                target.push_str(host);
                if let Some(p) = port {
                    target.push_str(" -p ");
                    target.push_str(&p.to_string());
                }
                Some(target)
            }
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn session_label(&self) -> String {
        match self {
            Self::Local => "Local".into(),
            Self::Wsl { distro } => format!("WSL: {distro}"),
            Self::Ssh { host, user, .. } => {
                if let Some(u) = user {
                    format!("SSH: {u}@{host}")
                } else {
                    format!("SSH: {host}")
                }
            }
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SshConnection {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub password: Option<String>,
    pub label: Option<String>,
}

#[allow(dead_code)]
impl SshConnection {
    pub fn display_name(&self) -> String {
        self.label.clone().unwrap_or_else(|| {
            let mut s = String::new();
            if let Some(ref u) = self.user {
                s.push_str(u);
                s.push('@');
            }
            s.push_str(&self.host);
            if let Some(p) = self.port {
                s.push_str(&format!(":{}", p));
            }
            s
        })
    }
}

fn sshpass_available() -> bool {
    std::process::Command::new("sshpass")
        .arg("--version")
        .output()
        .is_ok()
}

fn build_ssh_command(
    host: &str,
    user: &Option<String>,
    port: &Option<u16>,
    key_path: &Option<String>,
    password: &Option<String>,
) -> std::process::Command {
    let use_sshpass = password.is_some() && sshpass_available();

    let (program, pass_args): (&str, Vec<String>) = if use_sshpass {
        ("sshpass", vec!["-p".into(), password.as_ref().unwrap().clone(), "ssh".into()])
    } else {
        ("ssh", vec![])
    };

    let mut cmd = std::process::Command::new(program);
    for a in &pass_args {
        cmd.arg(a);
    }
    if let Some(k) = key_path {
        cmd.arg("-i").arg(k);
    }
    if let Some(p) = port {
        cmd.arg("-p").arg(p.to_string());
    }
    cmd.arg("-o").arg("ConnectTimeout=5");
    cmd.arg("-o").arg("StrictHostKeyChecking=no");
    cmd.arg("-o").arg("BatchMode=yes");

    let mut target = String::new();
    if let Some(u) = user {
        target.push_str(u);
        target.push('@');
    }
    target.push_str(host);
    cmd.arg(&target);
    cmd.arg("echo connected");
    cmd
}

#[tauri::command]
pub fn ssh_test_connection(host: String, user: Option<String>, port: Option<u16>, key_path: Option<String>, password: Option<String>) -> Result<bool, String> {
    let mut cmd = build_ssh_command(&host, &user, &port, &key_path, &password);
    let out = cmd.output().map_err(|e| format!("SSH failed: {e}"))?;
    Ok(out.status.success())
}

#[derive(Clone, Debug, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub default: bool,
    pub running: bool,
}

pub fn resolve_path(path: &str, workspace: &WorkspaceEnv) -> PathBuf {
    match workspace {
        WorkspaceEnv::Ssh { .. } => PathBuf::from(path),
        _ => resolve_local_path(path, workspace),
    }
}

#[cfg(windows)]
fn resolve_local_path(path: &str, workspace: &WorkspaceEnv) -> PathBuf {
    match workspace {
        WorkspaceEnv::Local => PathBuf::from(path),
        WorkspaceEnv::Wsl { distro } => wsl_path_to_unc(distro, path),
        WorkspaceEnv::Ssh { .. } => PathBuf::from(path),
    }
}

#[cfg(not(windows))]
fn resolve_local_path(path: &str, _workspace: &WorkspaceEnv) -> PathBuf {
    PathBuf::from(path)
}

#[cfg(windows)]
pub fn wsl_path_to_unc(distro: &str, path: &str) -> PathBuf {
    // Convert Windows drive paths (C:\foo) to WSL Linux paths (/mnt/c/foo)
    let linux_path = normalize_to_wsl_linux_path(path);
    let trimmed = linux_path.trim_start_matches('/');
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
fn normalize_to_wsl_linux_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let bytes = normalized.as_bytes();
    // Detect Windows drive letter paths e.g. C:/Users/...
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'/'
    {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        format!("/mnt/{}/{}", drive, &normalized[3..])
    } else {
        normalized
    }
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
        let out = run_wsl(&["-d", &distro, "--exec", "sh", "-lc", "printf %s \"$HOME\""])?;
        let home = out.trim().to_string();
        if home.is_empty() {
            Err(format!("could not resolve WSL home for {distro}"))
        } else {
            Ok(home)
        }
    }
}

#[tauri::command]
pub fn wsl_unregister_distro(distro: String) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = distro;
        Err("WSL is only available on Windows".into())
    }
    #[cfg(windows)]
    {
        let out = std::process::Command::new("wsl.exe")
            .args(["--unregister", &distro])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("wsl --unregister failed: {stderr}"));
        }
        Ok(())
    }
}
