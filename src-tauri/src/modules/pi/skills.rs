use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::modules::skills::scanner;

const MAX_SKILLS: usize = 200;
const MAX_SKILL_BYTES: u64 = 64 * 1024;

/// Scope of a Pi skill — project-level or user-level profile.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiSkillScope {
    Project,
    User,
}

/// Metadata and validation status for a single discovered Pi skill.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSkillInfo {
    pub name: String,
    pub description: String,
    pub heading: Option<String>,
    pub preview: Option<String>,
    pub path: String,
    pub base_dir: String,
    pub scope: PiSkillScope,
    pub warnings: Vec<String>,
}

/// Status of a single skill root directory after scanning.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSkillRootStatus {
    pub path: String,
    pub scope: PiSkillScope,
    pub scanned: bool,
    pub warning: Option<String>,
}

/// Aggregate skill scan result across all root directories.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSkillsStatus {
    pub skills: Vec<PiSkillInfo>,
    pub roots: Vec<PiSkillRootStatus>,
    pub max_skills: usize,
    pub max_skill_bytes: u64,
    pub truncated: bool,
}

#[derive(Clone, Debug)]
pub(super) struct SkillRoot {
    pub path: PathBuf,
    pub scope: PiSkillScope,
}

fn to_canon(path: impl AsRef<Path>) -> String {
    crate::modules::fs::to_canon(path.as_ref())
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("skill root is a symlink".to_string());
    }
    if !metadata.is_dir() {
        return Err("skill root is not a directory".to_string());
    }
    fs::canonicalize(root).map_err(|error| error.to_string())
}

fn is_valid_skill_name(name: &str) -> bool {
    scanner::is_valid_skill_name(name)
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    scanner::frontmatter_value(content, key)
}

fn first_heading(content: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn first_paragraph(content: &str) -> Option<String> {
    let mut in_frontmatter = content.starts_with("---\n");
    let mut seen_frontmatter_end = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if in_frontmatter {
            if seen_frontmatter_end && trimmed == "---" {
                in_frontmatter = false;
            }
            seen_frontmatter_end = true;
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("```") {
            continue;
        }
        return Some(trimmed.chars().take(240).collect());
    }
    None
}

fn load_skill(path: &Path, canonical_root: &Path, scope: PiSkillScope) -> Option<PiSkillInfo> {
    // Canonicalize first to resolve the true filesystem path,
    // then validate against root. This avoids TOCTOU between
    // symlink check and canonicalize.
    let canonical_file = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(_) => return None,
    };
    if !canonical_file.starts_with(canonical_root) {
        return None;
    }
    // Verify the canonical path is a regular file (not a symlink,
    // which canonicalize would have resolved already, but guard
    // against special file types).
    let metadata = match fs::metadata(&canonical_file) {
        Ok(metadata) => metadata,
        Err(_) => return None,
    };
    if !metadata.is_file() {
        return None;
    }

    let mut warnings = Vec::new();
    if metadata.len() > MAX_SKILL_BYTES {
        return Some(PiSkillInfo {
            name: canonical_file
                .parent()
                .and_then(Path::file_name)
                .and_then(|value| value.to_str())
                .unwrap_or("unknown")
                .to_string(),
            description: String::new(),
            heading: None,
            preview: None,
            path: to_canon(&canonical_file),
            base_dir: canonical_file.parent().map(to_canon).unwrap_or_default(),
            scope,
            warnings: vec![format!("SKILL.md exceeds {MAX_SKILL_BYTES} bytes")],
        });
    }

    let content = match fs::read_to_string(&canonical_file) {
        Ok(content) => content,
        Err(error) => {
            warnings.push(format!("failed to read skill: {error}"));
            String::new()
        }
    };
    let fallback_name = canonical_file
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();
    let name = frontmatter_value(&content, "name").unwrap_or(fallback_name);
    let description = frontmatter_value(&content, "description").unwrap_or_default();

    if !is_valid_skill_name(&name) {
        warnings.push("skill name does not match Pi skill naming rules".to_string());
    }
    if description.trim().is_empty() {
        warnings.push("description is missing".to_string());
    } else if description.len() > 1024 {
        warnings.push("description exceeds 1024 characters".to_string());
    }

    Some(PiSkillInfo {
        name,
        description,
        heading: first_heading(&content),
        preview: first_paragraph(&content),
        path: to_canon(&canonical_file),
        base_dir: canonical_file.parent().map(to_canon).unwrap_or_default(),
        scope,
        warnings,
    })
}

fn scan_dir(
    dir: &Path,
    canonical_root: &Path,
    scope: PiSkillScope,
    skills: &mut Vec<PiSkillInfo>,
    truncated: &mut bool,
) {
    if skills.len() >= MAX_SKILLS {
        *truncated = true;
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if skills.len() >= MAX_SKILLS {
            *truncated = true;
            return;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.is_file() {
                if let Some(skill) = load_skill(&skill_file, canonical_root, scope.clone()) {
                    skills.push(skill);
                }
            } else {
                scan_dir(&path, canonical_root, scope.clone(), skills, truncated);
            }
        } else if metadata.is_file()
            && path.file_name().and_then(|value| value.to_str()) == Some("SKILL.md")
        {
            if let Some(skill) = load_skill(&path, canonical_root, scope.clone()) {
                skills.push(skill);
            }
        }
    }
}

/// Scans the given root directories for Pi skills and returns the aggregate status.
pub(super) fn status(roots: Vec<SkillRoot>) -> PiSkillsStatus {
    let mut skills = Vec::new();
    let mut root_statuses = Vec::new();
    let mut truncated = false;

    for root in roots {
        if skills.len() >= MAX_SKILLS {
            truncated = true;
            root_statuses.push(PiSkillRootStatus {
                path: to_canon(&root.path),
                scope: root.scope,
                scanned: false,
                warning: Some("skill scan limit reached".to_string()),
            });
            continue;
        }

        match canonical_root(&root.path) {
            Ok(canonical) => {
                scan_dir(
                    &canonical,
                    &canonical,
                    root.scope.clone(),
                    &mut skills,
                    &mut truncated,
                );
                root_statuses.push(PiSkillRootStatus {
                    path: to_canon(&canonical),
                    scope: root.scope,
                    scanned: true,
                    warning: None,
                });
            }
            Err(error) => root_statuses.push(PiSkillRootStatus {
                path: to_canon(&root.path),
                scope: root.scope,
                scanned: false,
                warning: Some(error),
            }),
        }
    }

    PiSkillsStatus {
        skills,
        roots: root_statuses,
        max_skills: MAX_SKILLS,
        max_skill_bytes: MAX_SKILL_BYTES,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_skill_metadata_without_body_execution() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let skill_dir = tmp.path().join("demo");
        fs::create_dir_all(&skill_dir).expect("mkdir");
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Demo work\n---\n\n# Demo\n\nFirst paragraph.\n\n```bash\nrm -rf /\n```\n",
        )
        .expect("write");

        let status = status(vec![SkillRoot {
            path: tmp.path().to_path_buf(),
            scope: PiSkillScope::Project,
        }]);

        assert_eq!(status.skills.len(), 1);
        assert_eq!(status.skills[0].name, "demo-skill");
        assert_eq!(status.skills[0].description, "Demo work");
        assert_eq!(status.skills[0].heading.as_deref(), Some("Demo"));
        assert_eq!(
            status.skills[0].preview.as_deref(),
            Some("First paragraph.")
        );
    }
}
