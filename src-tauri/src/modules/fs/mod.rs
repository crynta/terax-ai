pub mod file;
pub mod grep;
pub mod mutate;
pub mod search;
pub mod tree;

use std::path::{Component, Path, PathBuf};

use crate::modules::workspace::WorkspaceRegistry;

const OUTSIDE_AUTHORIZED_WORKSPACE: &str = "outside authorized workspace";

/// The single canonical-to-display conversion: forward slashes, Windows
/// verbatim `\\?\` prefix stripped. Route every such conversion through here.
pub fn to_canon(p: impl AsRef<Path>) -> String {
    let s = p.as_ref().to_string_lossy();
    #[cfg(windows)]
    {
        strip_verbatim(&s)
    }
    #[cfg(not(windows))]
    {
        // Backslashes are legal in Unix filenames; never rewrite them.
        s.into_owned()
    }
}

fn outside_authorized_workspace(path: &Path) -> String {
    format!("{OUTSIDE_AUTHORIZED_WORKSPACE}: {}", path.display())
}

fn ensure_authorized(registry: &WorkspaceRegistry, canonical: PathBuf) -> Result<PathBuf, String> {
    if registry.is_authorized(&canonical) {
        Ok(canonical)
    } else {
        Err(outside_authorized_workspace(&canonical))
    }
}

/// Authorize an operation that follows the target, such as read/stat/search.
pub fn authorize_existing_path(
    registry: &WorkspaceRegistry,
    path: &Path,
) -> Result<PathBuf, String> {
    let canonical = registry
        .canonicalize_cached(path)
        .map_err(|e| e.to_string())?;
    ensure_authorized(registry, canonical)
}

/// Authorize an operation that acts on the directory entry itself. Symlink
/// deletes/renames are allowed when the link lives in an authorized workspace,
/// while ordinary files/directories are authorized by their canonical target.
pub fn authorize_entry_path(registry: &WorkspaceRegistry, path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        authorize_directory_entry_location(registry, path)?;
        return Ok(());
    }

    authorize_existing_path(registry, path).map(|_| ())
}

fn authorize_directory_entry_location(
    registry: &WorkspaceRegistry,
    path: &Path,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    let name = path
        .file_name()
        .ok_or_else(|| format!("path has no file name: {}", path.display()))?;
    let name_path = Path::new(name);
    if name_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("path traversal is not allowed: {}", path.display()));
    }

    let mut candidate = authorize_existing_path(registry, parent)?;
    candidate.push(name);
    if registry.is_authorized(&candidate) {
        Ok(())
    } else {
        Err(outside_authorized_workspace(&candidate))
    }
}

/// Authorize a missing destination by canonicalizing its nearest existing
/// ancestor and rejecting unresolved `..` traversal after that ancestor.
pub fn authorize_create_target(registry: &WorkspaceRegistry, path: &Path) -> Result<(), String> {
    if path.exists() {
        return authorize_existing_path(registry, path).map(|_| ());
    }

    let mut missing = Vec::new();
    let mut ancestor = path;
    while !ancestor.exists() {
        let name = ancestor.file_name().ok_or_else(|| {
            format!(
                "cannot resolve nearest existing ancestor: {}",
                path.display()
            )
        })?;
        missing.push(name.to_os_string());
        ancestor = ancestor.parent().ok_or_else(|| {
            format!(
                "cannot resolve nearest existing ancestor: {}",
                path.display()
            )
        })?;
    }

    let canonical_ancestor = authorize_existing_path(registry, ancestor)?;
    let mut candidate = canonical_ancestor;
    for component in missing.iter().rev() {
        let component_path = Path::new(component);
        if component_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(format!("path traversal is not allowed: {}", path.display()));
        }
        candidate.push(component);
    }

    if registry.is_authorized(&candidate) {
        Ok(())
    } else {
        Err(outside_authorized_workspace(&candidate))
    }
}

// Pure so it stays unit-testable on any host. `\\?\C:\x` -> `C:/x`.
#[cfg_attr(not(windows), allow(dead_code))]
fn strip_verbatim(s: &str) -> String {
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    };
    stripped.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim;

    #[test]
    fn strips_drive_verbatim_prefix() {
        assert_eq!(strip_verbatim(r"\\?\C:\Users\foo"), "C:/Users/foo");
    }

    #[test]
    fn rewrites_verbatim_unc_to_share_path() {
        assert_eq!(
            strip_verbatim(r"\\?\UNC\server\share\dir"),
            "//server/share/dir"
        );
    }

    #[test]
    fn passes_through_plain_windows_path() {
        assert_eq!(strip_verbatim(r"C:\Users\foo"), "C:/Users/foo");
    }

    #[test]
    fn leaves_forward_slash_path_unchanged() {
        assert_eq!(strip_verbatim("C:/Users/foo"), "C:/Users/foo");
    }

    #[test]
    fn handles_drive_root() {
        assert_eq!(strip_verbatim(r"\\?\C:\"), "C:/");
    }
}
