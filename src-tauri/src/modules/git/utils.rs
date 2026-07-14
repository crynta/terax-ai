use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

#[derive(Clone, Debug)]
pub struct ResolvedGitDirectory {
    pub workspace: WorkspaceEnv,
    pub git_path: String,
    pub local_path: PathBuf,
}

pub fn split_upstream(upstream: &str) -> (Option<String>, Option<String>) {
    match upstream.split_once('/') {
        Some((remote, branch)) => (Some(remote.to_string()), Some(branch.to_string())),
        None => (None, Some(upstream.to_string())),
    }
}

pub fn display_path(path: &Path) -> String {
    crate::modules::fs::to_canon(path)
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub fn canonical_dir(
    registry: &WorkspaceRegistry,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    let candidate = resolve_path(path, workspace);
    if !candidate.is_dir() {
        return Err(GitError::NotADirectory(path.to_string()));
    }
    let local_path = registry
        .canonicalize_cached(&candidate)
        .map_err(GitError::Io)?;
    let git_path = if workspace.is_wsl() {
        normalize_git_path(path)
    } else {
        display_path(&local_path)
    };
    Ok(ResolvedGitDirectory {
        workspace: workspace.clone(),
        git_path,
        local_path,
    })
}

pub fn authorized_repo_root(
    registry: &WorkspaceRegistry,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<ResolvedGitDirectory> {
    let canonical = canonical_dir(registry, path, workspace)?;
    if !registry.is_authorized(&canonical.local_path) {
        return Err(GitError::PathOutsideWorkspace(canonical.local_path.clone()));
    }
    Ok(canonical)
}

pub fn resolve_within_repo(repo_root: &Path, rel: &str) -> Result<PathBuf> {
    if !is_safe_pathspec(rel) {
        return Err(GitError::InvalidPath(rel.into()));
    }
    let joined = repo_root.join(rel);
    match std::fs::canonicalize(&joined) {
        Ok(canonical) => {
            if !canonical.starts_with(repo_root) {
                return Err(GitError::PathOutsideWorkspace(canonical));
            }
            Ok(canonical)
        }
        // Deleted path (staging a removal): validate via nearest existing ancestor.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            resolve_deleted_within_repo(repo_root, &joined, rel)
        }
        Err(e) => Err(GitError::Io(e)),
    }
}

pub fn is_safe_pathspec(rel: &str) -> bool {
    if rel.is_empty() || rel.contains(':') || rel.contains('\0') {
        return false;
    }
    if rel.chars().any(|c| (c as u32) < 0x20) {
        return false;
    }
    // Reject `.`/`..` so the deleted-path branch can't be used to escape the repo.
    !rel.split(['/', '\\']).any(|c| c == "." || c == "..")
}

fn resolve_deleted_within_repo(repo_root: &Path, joined: &Path, rel: &str) -> Result<PathBuf> {
    let mut tail: Vec<&OsStr> = Vec::new();
    let mut cursor = joined;
    loop {
        let name = cursor
            .file_name()
            .ok_or_else(|| GitError::InvalidPath(rel.into()))?;
        let parent = cursor
            .parent()
            .ok_or_else(|| GitError::InvalidPath(rel.into()))?;
        tail.push(name);
        match std::fs::canonicalize(parent) {
            Ok(canonical_parent) => {
                if !canonical_parent.starts_with(repo_root) {
                    return Err(GitError::PathOutsideWorkspace(canonical_parent));
                }
                let mut resolved = canonical_parent;
                for component in tail.iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                cursor = parent;
            }
            Err(e) => return Err(GitError::Io(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_pathspec_accepts_normal_paths() {
        assert!(is_safe_pathspec("src/main.rs"));
        assert!(is_safe_pathspec("a/b/c-d_e.txt"));
        assert!(is_safe_pathspec("folder with spaces/file.md"));
        assert!(is_safe_pathspec("file.with.dots"));
    }

    #[test]
    fn safe_pathspec_rejects_colon() {
        assert!(!is_safe_pathspec("evil:path"));
        assert!(!is_safe_pathspec(":head"));
        assert!(!is_safe_pathspec("a/b:c"));
    }

    #[test]
    fn safe_pathspec_rejects_nul_and_control() {
        assert!(!is_safe_pathspec("foo\0bar"));
        assert!(!is_safe_pathspec("foo\nbar"));
        assert!(!is_safe_pathspec("foo\rbar"));
        assert!(!is_safe_pathspec("foo\tbar"));
    }

    #[test]
    fn safe_pathspec_rejects_empty() {
        assert!(!is_safe_pathspec(""));
    }

    #[test]
    fn resolve_within_repo_rejects_colon_path() {
        let tmp = std::env::temp_dir();
        let err = resolve_within_repo(&tmp, "evil:path");
        assert!(matches!(err, Err(GitError::InvalidPath(_))));
    }

    #[test]
    fn resolve_within_repo_rejects_nul_path() {
        let tmp = std::env::temp_dir();
        let err = resolve_within_repo(&tmp, "evil\0path");
        assert!(matches!(err, Err(GitError::InvalidPath(_))));
    }

    #[test]
    fn safe_pathspec_rejects_dot_components() {
        assert!(!is_safe_pathspec("../escape"));
        assert!(!is_safe_pathspec("a/../b"));
        assert!(!is_safe_pathspec("./a"));
        assert!(!is_safe_pathspec("a/."));
        assert!(!is_safe_pathspec(".."));
    }

    #[test]
    fn resolve_within_repo_handles_deleted_directory() {
        let base = std::env::temp_dir().join("terax_git_deleted_dir_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("envs/__pycache__")).unwrap();
        let repo_root = std::fs::canonicalize(&base).unwrap();
        std::fs::remove_dir_all(repo_root.join("envs")).unwrap();
        let resolved =
            resolve_within_repo(&repo_root, "envs/__pycache__/g1.pyc").expect("deleted path");
        assert_eq!(resolved, repo_root.join("envs/__pycache__/g1.pyc"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_within_repo_rejects_deleted_escape() {
        let tmp = std::env::temp_dir();
        let err = resolve_within_repo(&tmp, "../outside.txt");
        assert!(matches!(err, Err(GitError::InvalidPath(_))));
    }
}
