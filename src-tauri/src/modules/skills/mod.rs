pub mod bundled;
pub mod scanner;

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Default)]
pub struct SkillsState {}

#[tauri::command]
pub fn skill_list(app: tauri::AppHandle) -> Result<Vec<SkillInfo>, String> {
    let mut skills = Vec::new();

    let user_dir = dirs::config_dir()
        .map(|d| d.join("terax").join("skills"))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    if user_dir.exists() {
        let scanned = scanner::scan_skill_dir(&user_dir, 200, 64 * 1024)?;
        skills.extend(scanned.into_iter().map(|s| SkillInfo {
            name: s.name,
            description: s.description,
            path: s.path,
        }));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("skills");
        if bundled.exists() {
            let scanned = scanner::scan_skill_dir(&bundled, 200, 64 * 1024)?;
            for s in scanned {
                if !skills.iter().any(|existing| existing.name == s.name) {
                    skills.push(SkillInfo {
                        name: s.name,
                        description: s.description,
                        path: s.path,
                    });
                }
            }
        }
    }

    Ok(skills)
}

#[tauri::command]
pub fn skill_status() -> Result<String, String> {
    Ok("ok".to_string())
}
