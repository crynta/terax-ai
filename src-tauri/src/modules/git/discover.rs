use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

use crate::modules::fs::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

#[derive(Serialize)]
pub struct DiscoveredRepo {
    pub repo_root: String,
    pub name: String,
    #[serde(rename = "type")]
    pub repo_type: String,
}

#[derive(Serialize)]
pub struct DiscoverResult {
    pub repos: Vec<DiscoveredRepo>,
    pub timed_out: bool,
}

pub fn discover_repos(
    registry: &WorkspaceRegistry,
    workspace_root: &str,
    workspace: &WorkspaceEnv,
    max_depth: u32,
    max_results: usize,
    timeout_ms: u64,
) -> Result<DiscoverResult, String> {
    let root = resolve_path(workspace_root, workspace);
    let canonical_root = registry
        .canonicalize_cached(&root)
        .map_err(|e| format!("cannot access workspace root: {e}"))?;

    let start = Instant::now();
    let deadline_ms = timeout_ms;
    let mut timed_out = false;
    let mut repos = Vec::new();
    let mut seen = HashSet::new();

    // Check if workspace root itself is a git repo
    if repos.len() < max_results && start.elapsed().as_millis() < deadline_ms as u128 {
        if let Some(info) = check_git_repo(&canonical_root, &canonical_root, registry) {
            if seen.insert(info.repo_root.clone()) {
                repos.push(info);
            }
        }
    }

    // Walk subdirectories for additional repos
    if repos.len() < max_results {
        timed_out = discover_recursive(
            &canonical_root,
            &canonical_root,
            registry,
            0,
            max_depth,
            max_results,
            deadline_ms,
            &start,
            &mut seen,
            &mut repos,
        );
    }

    // Sort: root first, then submodule, then nested; alphabetically within each tier
    repos.sort_by(|a, b| {
        let type_ord = |t: &str| match t {
            "root" => 0u8,
            "submodule" => 1,
            _ => 2,
        };
        type_ord(&a.repo_type)
            .cmp(&type_ord(&b.repo_type))
            .then_with(|| a.name.cmp(&b.name))
    });

    repos.truncate(max_results);

    Ok(DiscoverResult { repos, timed_out })
}

/// Check if `dir` is a git repo (contains a .git dir or .git file for submodules).
/// Returns the canonical repo root and metadata.
fn check_git_repo(
    dir: &Path,
    workspace_root: &Path,
    registry: &WorkspaceRegistry,
) -> Option<DiscoveredRepo> {
    // Check for .git directory (regular repo) or .git file (submodule pointer)
    let git_entry = dir.join(".git");

    if git_entry.is_dir() {
        // Regular repo - dir is the repo root
        let canonical = registry.canonicalize_cached(dir).ok()?;
        // Verify it's still within workspace (proper path-component check)
        if !is_within_workspace(&canonical, workspace_root) {
            return None;
        }
        // Authorize the discovered repo so subsequent git operations work
        let _ = registry.authorize(&canonical);
        let name = file_name(&canonical).unwrap_or_default().to_string();
        Some(DiscoveredRepo {
            repo_root: to_canon(&canonical),
            name,
            repo_type: "root".into(),
        })
    } else if git_entry.is_file() {
        // Submodule - .git file points to the gitdir storage path.
        // Validate the gitdir is within the workspace (matching the original
        // JS behavior that checked realGitdir.startsWith(realWorkspaceRoot)).
        let content = std::fs::read_to_string(&git_entry).ok()?;
        let gitdir_line = content.lines().find(|l| l.starts_with("gitdir:"))?;
        let gitdir_path = gitdir_line.strip_prefix("gitdir:")?.trim();

        // Resolve relative paths
        let resolved_gitdir = if Path::new(gitdir_path).is_absolute() {
            PathBuf::from(gitdir_path)
        } else {
            dir.join(gitdir_path)
        };

        let canonical_gitdir = registry.canonicalize_cached(&resolved_gitdir).ok()?;
        if !is_within_workspace(&canonical_gitdir, workspace_root) {
            return None;
        }

        // The working tree (dir) is the repo root, not the gitdir
        let canonical = registry.canonicalize_cached(dir).ok()?;
        if !is_within_workspace(&canonical, workspace_root) {
            return None;
        }

        // Authorize the discovered repo so subsequent git operations work
        let _ = registry.authorize(&canonical);

        let name = file_name(&canonical).unwrap_or_default().to_string();
        Some(DiscoveredRepo {
            repo_root: to_canon(&canonical),
            name,
            repo_type: "submodule".into(),
        })
    } else {
        None
    }
}

/// Recursively discover git repos under `dir`.
/// Returns true if the deadline was hit (timed out).
fn discover_recursive(
    dir: &Path,
    workspace_root: &Path,
    registry: &WorkspaceRegistry,
    depth: u32,
    max_depth: u32,
    max_results: usize,
    deadline_ms: u64,
    start: &Instant,
    seen: &mut HashSet<String>,
    repos: &mut Vec<DiscoveredRepo>,
) -> bool {
    if depth > max_depth || repos.len() >= max_results {
        return false;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false, // Can't read directory, skip
    };

    for entry in entries.flatten() {
        if repos.len() >= max_results {
            return true; // Hit limit
        }
        if start.elapsed().as_millis() >= deadline_ms as u128 {
            return true; // Timed out
        }

        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Skip .git directory itself (don't descend into it)
        if name == ".git" {
            continue;
        }

        // Skip hidden directories except ones we want to explore
        // (we DON'T skip dot-prefixed dirs like .git is already handled above)
        // This is the KEY fix: we can see .git because we're reading ALL entries

        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        if !file_type.is_dir() {
            continue; // Only recurse into directories
        }

        // Skip symlinks to prevent escaping workspace
        if file_type.is_symlink() {
            continue;
        }

        let entry_path = entry.path();

        // Check if this directory IS a git repo
        if let Some(info) = check_git_repo(&entry_path, workspace_root, registry) {
            if seen.insert(info.repo_root.clone()) {
                repos.push(info);
            }
        }

        // Recurse into subdirectory
        if repos.len() < max_results
            && start.elapsed().as_millis() < deadline_ms as u128
        {
            discover_recursive(
                &entry_path,
                workspace_root,
                registry,
                depth + 1,
                max_depth,
                max_results,
                deadline_ms,
                start,
                seen,
                repos,
            );
        }
    }

    false
}

/// Check if `path` is within `workspace` using path components (not string prefix).
/// This prevents `/workspace2` from matching `/workspace`.
fn is_within_workspace(path: &Path, workspace: &Path) -> bool {
    path.starts_with(workspace) || path == workspace
}

/// Get the file name component of a path.
fn file_name(path: &Path) -> Option<&str> {
    path.file_name()?.to_str()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_within_workspace_exact_match() {
        let ws = Path::new("/workspace");
        assert!(is_within_workspace(ws, ws));
    }

    #[test]
    fn is_within_workspace_subdir() {
        let ws = Path::new("/workspace");
        let sub = Path::new("/workspace/sub");
        assert!(is_within_workspace(sub, ws));
    }

    #[test]
    fn is_within_workspace_no_false_positive() {
        let ws = Path::new("/workspace");
        let other = Path::new("/workspace2");
        assert!(!is_within_workspace(other, ws));
    }

    #[test]
    fn is_within_workspace_sibling() {
        let ws = Path::new("/workspace");
        let sibling = Path::new("/workspace/../other");
        // Path::starts_with compares components, so this is false
        assert!(!is_within_workspace(sibling, ws));
    }

    #[test]
    fn file_name_extracts_last_component() {
        assert_eq!(file_name(Path::new("/workspace/sub")), Some("sub"));
        assert_eq!(file_name(Path::new("/workspace")), Some("workspace"));
    }
}
