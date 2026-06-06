use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const HOST_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SHELL",
    "PI_CODING_AGENT_DIR",
    "TERAX_PI_NODE_MODULES",
];

const HOST_TEST_FAUX_ENV_ALLOWLIST: &[&str] = &[
    "TERAX_PI_HOST_ENABLE_TEST_FAUX",
    "TERAX_PI_HOST_TEST_FAUX_RESPONSE",
    "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL",
    "TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND",
    "TERAX_PI_HOST_TEST_FAUX_REASONING",
];

pub(super) fn host_environment() -> Vec<(String, String)> {
    let mut names = HOST_ENV_ALLOWLIST.to_vec();
    if host_test_faux_enabled() {
        names.extend_from_slice(HOST_TEST_FAUX_ENV_ALLOWLIST);
    }
    names
        .iter()
        .filter_map(|name| {
            env::var(name)
                .ok()
                .map(|value| ((*name).to_string(), value))
        })
        .collect()
}

fn host_test_faux_enabled() -> bool {
    (cfg!(test) || cfg!(debug_assertions))
        && env::var("TERAX_PI_HOST_ENABLE_TEST_FAUX").as_deref() == Ok("1")
}

pub(super) fn node_binary(resource_dir: Option<&Path>) -> PathBuf {
    if let Ok(path) = env::var("TERAX_NODE_BINARY") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    select_usable_node_binary(node_binary_candidates(resource_dir))
        .unwrap_or_else(|| PathBuf::from("node"))
}

pub(super) fn select_usable_node_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file() && is_usable_node_binary(candidate))
}

fn is_usable_node_binary(candidate: &Path) -> bool {
    Command::new(candidate)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

pub(super) fn node_binary_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join(bundled_node_relative_path()));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(generated_node_relative_path()));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(generated_node_relative_path()));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("..").join(generated_node_relative_path()));
    candidates
}

pub(super) fn bundled_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/node.exe")
    } else {
        PathBuf::from("sidecars/node/bin/node")
    }
}

pub(super) fn generated_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/dist/node.exe")
    } else {
        PathBuf::from("sidecars/node/dist/bin/node")
    }
}

pub(super) fn resolve_host_path(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("TERAX_PI_HOST_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "TERAX_PI_HOST_PATH is not a file: {}",
            path.display()
        ));
    }

    for candidate in host_path_candidates(resource_dir) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err("could not find sidecars/pi-host/host.js".to_string())
}

pub(super) fn host_path_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let relative = PathBuf::from("sidecars/pi-host/host.js");
    let mut repo_candidates = Vec::new();

    if let Ok(cwd) = env::current_dir() {
        repo_candidates.push(cwd.join(&relative));
        if let Some(parent) = cwd.parent() {
            repo_candidates.push(parent.join(&relative));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    repo_candidates.push(manifest_dir.join("..").join(&relative));

    let mut candidates = Vec::new();
    if cfg!(debug_assertions) {
        candidates.extend(repo_candidates);
        if let Some(resource_dir) = resource_dir {
            candidates.push(resource_dir.join(&relative));
        }
    } else {
        if let Some(resource_dir) = resource_dir {
            candidates.push(resource_dir.join(&relative));
        }
        candidates.extend(repo_candidates);
    }
    candidates
}
