use std::env;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::{Command, Stdio};

use crate::modules::workspace::WorkspaceEnv;

use super::types::{PiLocalAgentBinaryStatus, PiLocalAgentsStatus};

const LOCAL_AGENT_BINS: &[&str] = &[
    "claude",
    "codex",
    "cursor-agent",
    "opencode",
    "pi",
    "gemini",
    "agy",
];

fn login_path() -> String {
    probe_login_path()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .or_else(|| env::var("PATH").ok())
        .unwrap_or_default()
}

#[cfg(unix)]
fn probe_login_path() -> Option<String> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let output = Command::new(shell)
        .arg("-lc")
        .arg("printf %s \"$PATH\"")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(windows)]
fn probe_login_path() -> Option<String> {
    None
}

#[cfg(windows)]
fn executable_exts() -> Vec<String> {
    env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string())
        .split(';')
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
        .collect()
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
}

#[cfg(windows)]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

pub(super) fn resolve_local_agent_binary_in_path(bin: &str, path: &str) -> Option<PathBuf> {
    if !LOCAL_AGENT_BINS.contains(&bin) {
        return None;
    }
    let separator = if cfg!(windows) { ';' } else { ':' };
    for dir in path.split(separator).filter(|value| !value.is_empty()) {
        let base = PathBuf::from(dir).join(bin);
        if is_executable_file(&base) {
            return Some(base);
        }
        #[cfg(windows)]
        for ext in executable_exts() {
            let candidate = PathBuf::from(dir).join(format!("{bin}.{ext}"));
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn resolve_local_agent_binary(bin: &str) -> Option<PathBuf> {
    let path = login_path();
    resolve_local_agent_binary_in_path(bin, &path)
}

#[cfg(windows)]
fn resolve_local_agent_binary_in_wsl(distro: &str, bin: &str) -> Option<String> {
    if !LOCAL_AGENT_BINS.contains(&bin) {
        return None;
    }
    let shell = crate::modules::workspace::wsl_login_shell(distro.to_string()).ok()?;
    let script = format!("command -v {bin}");
    let output =
        crate::modules::workspace::wsl_exec_capture(distro, &shell, &["-lc", &script]).ok()?;
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(not(windows))]
fn resolve_local_agent_binary_in_wsl(_distro: &str, _bin: &str) -> Option<String> {
    None
}

fn resolve_local_agent_binary_for_workspace(bin: &str, workspace: &WorkspaceEnv) -> Option<String> {
    match workspace {
        WorkspaceEnv::Local => resolve_local_agent_binary(bin).map(crate::modules::fs::to_canon),
        WorkspaceEnv::Wsl { distro } => resolve_local_agent_binary_in_wsl(distro, bin),
    }
}

pub(super) fn status(workspace: Option<WorkspaceEnv>) -> PiLocalAgentsStatus {
    let workspace = workspace.unwrap_or(WorkspaceEnv::Local);
    PiLocalAgentsStatus {
        agents: LOCAL_AGENT_BINS
            .iter()
            .map(|binary| PiLocalAgentBinaryStatus {
                binary: (*binary).to_string(),
                path: resolve_local_agent_binary_for_workspace(binary, &workspace),
            })
            .collect(),
    }
}
