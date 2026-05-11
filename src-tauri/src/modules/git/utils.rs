use std::path::{Path, PathBuf};

pub fn split_upstream(upstream: &str) -> (Option<String>, Option<String>) {
    match upstream.split_once('/') {
        Some((remote, branch)) => (Some(remote.to_string()), Some(branch.to_string())),
        None => (None, Some(upstream.to_string())),
    }
}

pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn canonical_dir(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_dir() {
        return Err(format!("path is not a directory: {path}"));
    }
    std::fs::canonicalize(&candidate).map_err(|e| e.to_string())
}