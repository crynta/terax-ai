use std::fs;
use std::path::Path;

use serde::Serialize;

const MAX_SKILLS: usize = 200;
const MAX_SKILL_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub content: String,
    pub path: String,
}

pub fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()? != "---" {
        return None;
    }
    let prefix = format!("{key}:");
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let trimmed = line.trim_start();
        if let Some(value) = trimmed.strip_prefix(&prefix) {
            return Some(value.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

fn load_skill(path: &Path) -> Option<SkillMeta> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    if metadata.len() > MAX_SKILL_BYTES {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    let name = frontmatter_value(&content, "name").unwrap_or_else(|| {
        path.parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string()
    });
    let description = frontmatter_value(&content, "description").unwrap_or_default();

    if !is_valid_skill_name(&name) {
        return None;
    }

    Some(SkillMeta {
        name,
        description,
        content,
        path: path.to_string_lossy().to_string(),
    })
}

pub fn scan_skill_dir(
    dir: &Path,
    max_skills: usize,
    _max_bytes: u64,
) -> Result<Vec<SkillMeta>, String> {
    let mut skills = Vec::new();
    let max = max_skills.min(MAX_SKILLS);
    scan_recursive(dir, &mut skills, max)?;
    Ok(skills)
}

fn scan_recursive(dir: &Path, skills: &mut Vec<SkillMeta>, max: usize) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if skills.len() >= max {
            break;
        }
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.is_file() {
                if let Some(skill) = load_skill(&skill_file) {
                    skills.push(skill);
                }
            } else {
                scan_recursive(&path, skills, max)?;
            }
        } else if metadata.is_file()
            && path.file_name().and_then(|n| n.to_str()) == Some("SKILL.md")
        {
            if let Some(skill) = load_skill(&path) {
                skills.push(skill);
            }
        }
    }
    Ok(())
}
