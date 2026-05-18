use std::path::{Path, PathBuf};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::workspace::WorkspaceRegistry;

pub fn split_upstream(upstream: &str) -> (Option<String>, Option<String>) {
    match upstream.split_once('/') {
        Some((remote, branch)) => (Some(remote.to_string()), Some(branch.to_string())),
        None => (None, Some(upstream.to_string())),
    }
}

pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn canonical_dir(path: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(path);
    if !candidate.is_dir() {
        return Err(GitError::NotADirectory(path.to_string()));
    }
    std::fs::canonicalize(&candidate).map_err(GitError::Io)
}

pub fn authorized_repo_root(registry: &WorkspaceRegistry, path: &str) -> Result<PathBuf> {
    let canonical = canonical_dir(path)?;
    if !registry.is_authorized(&canonical) {
        return Err(GitError::PathOutsideWorkspace(canonical));
    }
    Ok(canonical)
}

pub fn resolve_within_repo(repo_root: &Path, rel: &str) -> Result<PathBuf> {
    if rel.is_empty() {
        return Err(GitError::InvalidPath(rel.into()));
    }
    let joined = repo_root.join(rel);
    let canonical = match std::fs::canonicalize(&joined) {
        Ok(p) => p,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return canonicalize_parent(repo_root, &joined, rel)
        }
        Err(e) => return Err(GitError::Io(e)),
    };
    if !canonical.starts_with(repo_root) {
        return Err(GitError::PathOutsideWorkspace(canonical));
    }
    Ok(canonical)
}

fn canonicalize_parent(repo_root: &Path, joined: &Path, rel: &str) -> Result<PathBuf> {
    let parent = joined
        .parent()
        .ok_or_else(|| GitError::InvalidPath(rel.into()))?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(GitError::Io)?;
    if !canonical_parent.starts_with(repo_root) {
        return Err(GitError::PathOutsideWorkspace(canonical_parent));
    }
    let file_name = joined
        .file_name()
        .ok_or_else(|| GitError::InvalidPath(rel.into()))?;
    Ok(canonical_parent.join(file_name))
}
