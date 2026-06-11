use std::path::Path;

use super::definition::AgentDefinition;

pub struct OpenClickyAgent {
    pub slug: String,
    pub soul_md: String,
    pub instructions_md: String,
    pub memory_md: String,
}

pub fn migrate_agent(oc: &OpenClickyAgent) -> AgentDefinition {
    let system_prompt = format!("{}\n\n{}", oc.soul_md.trim(), oc.instructions_md.trim());

    AgentDefinition {
        schema_version: 1,
        slug: oc.slug.clone(),
        display_name: oc
            .slug
            .split('-')
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
        description: String::new(),
        accent_color_hex: "#6366f1".to_string(),
        system_prompt,
        tool_whitelist: vec![],
        skills: vec![],
        memory: oc.memory_md.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn scan_openclicky_dir(dir: &Path) -> Vec<OpenClickyAgent> {
    let mut agents = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return agents;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let soul = path.join("soul.md");
        let instructions = path.join("instructions.md");
        let memory = path.join("memory.md");

        if !soul.exists() && !instructions.exists() {
            continue;
        }

        agents.push(OpenClickyAgent {
            slug,
            soul_md: std::fs::read_to_string(&soul).unwrap_or_default(),
            instructions_md: std::fs::read_to_string(&instructions).unwrap_or_default(),
            memory_md: std::fs::read_to_string(&memory).unwrap_or_default(),
        });
    }
    agents
}

#[tauri::command]
pub async fn agents_import_openclicky(path: String) -> Result<usize, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    if !dir.is_absolute() {
        return Err("path must be absolute".to_string());
    }

    log::info!("importing OpenClicky agents from {:?}", dir);
    let oc_agents = scan_openclicky_dir(dir);
    let mut imported = 0;

    for oc in &oc_agents {
        let def = migrate_agent(oc);
        match super::definition::save_agent(&def) {
            Ok(()) => imported += 1,
            Err(e) => log::warn!("skipping agent '{}': {e}", oc.slug),
        }
    }

    Ok(imported)
}
