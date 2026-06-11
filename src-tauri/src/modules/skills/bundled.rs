use std::path::PathBuf;
use tauri::Manager;

use super::scanner::SkillMeta;

pub fn bundled_skills_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let skills_dir = resource_dir.join("skills");
    if skills_dir.is_dir() {
        Some(skills_dir)
    } else {
        None
    }
}

pub fn list_bundled_skills(app: &tauri::AppHandle) -> Vec<SkillMeta> {
    let Some(dir) = bundled_skills_dir(app) else {
        return vec![];
    };
    super::scanner::scan_skill_dir(&dir, 200, 65_536).unwrap_or_default()
}
