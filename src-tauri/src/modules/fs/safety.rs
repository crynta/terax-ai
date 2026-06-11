use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PathPolicy {
    workspace: PathBuf,
    workspace_error_subject: &'static str,
    sensitive_error_subject: &'static str,
}

impl PathPolicy {
    pub fn native_pi_tool(workspace: &Path) -> Self {
        Self {
            workspace: workspace.to_path_buf(),
            workspace_error_subject: "native Pi tools",
            sensitive_error_subject: "native Pi tool",
        }
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    pub fn resolve_existing(&self, raw_path: &str) -> Result<PathBuf, String> {
        let candidate = self.candidate_path(raw_path);
        let canonical = fs::canonicalize(&candidate)
            .map_err(|error| format!("path not accessible: {raw_path}: {error}"))?;
        self.ensure_workspace_path(&canonical)?;
        self.ensure_not_sensitive(raw_path, &canonical)?;
        Ok(canonical)
    }

    pub fn resolve_target(&self, raw_path: &str) -> Result<PathBuf, String> {
        if raw_path.trim().is_empty() {
            return Err("path must not be empty".to_string());
        }

        let normalized = normalize_lexical(&self.candidate_path(raw_path))?;
        self.ensure_workspace_path(&normalized)?;
        self.ensure_not_sensitive(raw_path, &normalized)?;

        if normalized.exists() {
            let canonical = fs::canonicalize(&normalized)
                .map_err(|error| format!("path not accessible: {raw_path}: {error}"))?;
            self.ensure_workspace_path(&canonical)?;
            self.ensure_not_sensitive(raw_path, &canonical)?;
            return Ok(canonical);
        }

        if let Some(parent) = normalized.parent() {
            let existing_parent = nearest_existing_parent(parent)?;
            let canonical_parent = fs::canonicalize(&existing_parent).map_err(|error| {
                format!(
                    "parent path not accessible: {}: {error}",
                    existing_parent.display()
                )
            })?;
            self.ensure_workspace_path(&canonical_parent)?;
        }

        Ok(normalized)
    }

    pub fn is_visible_child_name(&self, name: &str) -> bool {
        !is_sensitive_path(Path::new(name))
    }

    fn candidate_path(&self, raw_path: &str) -> PathBuf {
        let raw = Path::new(raw_path);
        if raw.is_absolute() {
            raw.to_path_buf()
        } else {
            self.workspace.join(raw)
        }
    }

    fn ensure_workspace_path(&self, path: &Path) -> Result<(), String> {
        if path.starts_with(&self.workspace) {
            Ok(())
        } else {
            Err(format!(
                "{} can only access files inside the workspace: {}",
                self.workspace_error_subject,
                self.workspace.display()
            ))
        }
    }

    fn ensure_not_sensitive(&self, raw_path: &str, path: &Path) -> Result<(), String> {
        if self.is_sensitive_tool_path(raw_path, path) {
            return Err(format!(
                "{} refused sensitive path: {raw_path}",
                self.sensitive_error_subject
            ));
        }
        Ok(())
    }

    fn is_sensitive_tool_path(&self, raw_path: &str, path: &Path) -> bool {
        let raw = Path::new(raw_path);
        let raw_relative = if raw.is_absolute() {
            raw.strip_prefix(&self.workspace).unwrap_or(raw)
        } else {
            raw
        };
        let canonical_relative = path.strip_prefix(&self.workspace).unwrap_or(path);
        is_sensitive_path(raw_relative) || is_sensitive_path(canonical_relative)
    }
}

fn normalize_lexical(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("path escapes its root: {}", path.display()));
                }
            }
        }
    }
    Ok(normalized)
}

fn nearest_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = path.to_path_buf();
    loop {
        if current.exists() {
            return Ok(current);
        }
        if !current.pop() {
            return Err(format!("no existing parent for path: {}", path.display()));
        }
    }
}

fn is_sensitive_component_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let normalized_name = name.replace(['-', ' '], "_");
    let sensitive_exact = matches!(
        normalized_name.as_str(),
        ".env"
            | ".env.local"
            | ".env.development"
            | ".env.production"
            | ".env.test"
            | ".npmrc"
            | ".pypirc"
            | ".netrc"
            | ".aws"
            | ".ssh"
            | ".gnupg"
            | ".docker"
            | ".kube"
            | "gcloud"
            | "kubeconfig"
            | "id_rsa"
            | "id_dsa"
            | "id_ecdsa"
            | "id_ed25519"
            | "known_hosts"
    );
    let sensitive_substring = [
        "secret",
        "secrets",
        "token",
        "tokens",
        "credential",
        "credentials",
        "private_key",
        "apikey",
        "api_key",
    ]
    .iter()
    .any(|needle| normalized_name.contains(needle));
    let sensitive_extension = matches!(
        Path::new(&name)
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("pem" | "p12" | "pfx" | "key" | "asc" | "gpg")
    );
    sensitive_exact || sensitive_substring || sensitive_extension
}

pub fn is_sensitive_path(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(component, Component::Normal(_))
            && component
                .as_os_str()
                .to_str()
                .is_some_and(is_sensitive_component_name)
    })
}

pub fn ensure_not_sensitive_path(raw_path: &str, workspace: &WorkspaceEnv) -> Result<(), String> {
    let raw = Path::new(raw_path);
    if is_sensitive_path(raw) {
        return Err(format!(
            "native file operation refused sensitive path: {raw_path}"
        ));
    }

    let resolved = resolve_path(raw_path, workspace);
    if is_sensitive_path(&resolved) {
        return Err(format!(
            "native file operation refused sensitive path: {raw_path}"
        ));
    }

    if let Ok(canonical) = fs::canonicalize(&resolved) {
        if is_sensitive_path(&canonical) {
            return Err(format!(
                "native file operation refused sensitive path: {raw_path}"
            ));
        }
    } else if let (Some(parent), Some(file_name)) = (resolved.parent(), resolved.file_name()) {
        if let Ok(parent) = fs::canonicalize(parent) {
            if is_sensitive_path(&parent.join(file_name)) {
                return Err(format!(
                    "native file operation refused sensitive path: {raw_path}"
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_secret_paths() {
        assert!(is_sensitive_path(Path::new(".env")));
        assert!(is_sensitive_path(Path::new("config/tokens.json")));
        assert!(is_sensitive_path(Path::new("secrets/note.txt")));
        assert!(is_sensitive_path(Path::new("keys/private_key.pem")));
        assert!(is_sensitive_path(Path::new("keys/private-key.pem")));
        assert!(is_sensitive_path(Path::new("config/cert.pem")));
        assert!(is_sensitive_path(Path::new("deploy/server.pfx")));
        assert!(is_sensitive_path(Path::new("keys/public.asc")));
        assert!(is_sensitive_path(Path::new(".ssh/id_dsa")));
        assert!(is_sensitive_path(Path::new(".ssh/id_ecdsa")));
        assert!(is_sensitive_path(Path::new(".aws/credentials")));
        assert!(is_sensitive_path(Path::new(".docker/config.json")));
        assert!(is_sensitive_path(Path::new(".kube/config")));
        assert!(is_sensitive_path(Path::new(
            ".config/gcloud/application_default_credentials.json"
        )));
        assert!(!is_sensitive_path(Path::new("assets/image.png")));
        assert!(!is_sensitive_path(Path::new("src/main.rs")));
        assert!(!is_sensitive_path(Path::new(".config/app/settings.json")));
    }

    #[test]
    fn rejects_raw_sensitive_paths_before_canonicalization() {
        let error = ensure_not_sensitive_path("secrets/new.txt", &WorkspaceEnv::Local).unwrap_err();
        assert!(error.contains("sensitive path"), "{error}");
    }
}
