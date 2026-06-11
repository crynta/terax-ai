mod definition;
pub mod lease;
pub mod migrator;

pub use definition::{AgentDefinition, list_agents, load_agent, save_agent, delete_agent, append_memory};

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub accent_color_hex: String,
    pub has_memory: bool,
}

#[tauri::command]
pub fn agent_list(app: AppHandle) -> Result<Vec<AgentInfo>, String> {
    let agents = list_agents(&app)?;
    Ok(agents
        .into_iter()
        .map(|a| AgentInfo {
            slug: a.slug,
            display_name: a.display_name,
            description: a.description,
            accent_color_hex: a.accent_color_hex,
            has_memory: !a.memory.is_empty(),
        })
        .collect())
}

#[tauri::command]
pub fn agent_load(app: AppHandle, slug: String) -> Result<AgentDefinition, String> {
    load_agent(&app, &slug)
}

#[tauri::command]
pub fn agent_save(agent: AgentDefinition) -> Result<(), String> {
    save_agent(&agent)
}

#[tauri::command]
pub fn agent_delete(slug: String) -> Result<(), String> {
    delete_agent(&slug)
}

#[tauri::command]
pub fn agent_memory_read(app: AppHandle, slug: String) -> Result<String, String> {
    let agent = load_agent(&app, &slug)?;
    Ok(agent.memory)
}

#[tauri::command]
pub fn agent_memory_append(slug: String, entry: String) -> Result<(), String> {
    append_memory(&slug, &entry)
}
