use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const SCHEMA_VERSION: u32 = 1;

fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && !slug.contains('.')
        && !slug.contains('/')
        && !slug.contains('\\')
        && !slug.contains("..")
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b == b'-' || b.is_ascii_digit())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub schema_version: u32,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    #[serde(default)]
    pub accent_color_hex: String,
    pub system_prompt: String,
    #[serde(default)]
    pub tool_whitelist: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub memory: String,
    pub created_at: String,
    pub updated_at: String,
}

impl AgentDefinition {
    pub fn validate(&self) -> Result<(), String> {
        if self.slug.is_empty() {
            return Err("slug is required".to_string());
        }
        if !is_valid_slug(&self.slug) {
            return Err(
                "slug must be lowercase ascii with hyphens, no dots or slashes".to_string(),
            );
        }
        if self.display_name.is_empty() {
            return Err("display_name is required".to_string());
        }
        if self.system_prompt.is_empty() {
            return Err("system_prompt is required".to_string());
        }
        Ok(())
    }
}

fn agents_dir() -> Result<PathBuf, String> {
    let dir = dirs::config_dir()
        .ok_or("cannot determine config directory")?
        .join("terax")
        .join("agents");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create agents dir: {e}"))?;
    Ok(dir)
}

fn bundled_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource = app.path().resource_dir().ok()?;
    let dir = resource.join("agents");
    dir.exists().then_some(dir)
}

fn validate_slug(slug: &str) -> Result<(), String> {
    if !is_valid_slug(slug) {
        return Err(format!("invalid agent slug: '{slug}'"));
    }
    Ok(())
}

pub fn list_agents(app: &tauri::AppHandle) -> Result<Vec<AgentDefinition>, String> {
    let mut agents = Vec::new();
    let mut seen_slugs = std::collections::HashSet::new();

    if let Some(bundled) = bundled_dir(app) {
        load_agents_from_dir(&bundled, &mut agents, &mut seen_slugs)?;
    }

    let user_dir = agents_dir()?;
    load_agents_from_dir(&user_dir, &mut agents, &mut seen_slugs)?;

    agents.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(agents)
}

fn load_agents_from_dir(
    dir: &Path,
    agents: &mut Vec<AgentDefinition>,
    seen: &mut std::collections::HashSet<String>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<AgentDefinition>(&content) {
                Ok(mut agent) => {
                    if agent.schema_version != SCHEMA_VERSION {
                        continue;
                    }
                    if seen.insert(agent.slug.clone()) {
                        agent.memory = load_memory(&agent.slug).unwrap_or_default();
                        agents.push(agent);
                    }
                }
                Err(_) => {
                    log::warn!("skipping malformed agent file {:?}", path.file_name());
                }
            }
        }
    }
    Ok(())
}

pub fn load_agent(app: &tauri::AppHandle, slug: &str) -> Result<AgentDefinition, String> {
    validate_slug(slug)?;

    let user_path = agents_dir()?.join(format!("{slug}.json"));
    let path = if user_path.exists() {
        user_path
    } else if let Some(bundled) = bundled_dir(app) {
        let bundled_path = bundled.join(format!("{slug}.json"));
        if bundled_path.exists() {
            bundled_path
        } else {
            return Err(format!("agent '{slug}' not found"));
        }
    } else {
        return Err(format!("agent '{slug}' not found"));
    };

    let content = std::fs::read_to_string(&path).map_err(|e| format!("read agent: {e}"))?;
    let mut agent: AgentDefinition =
        serde_json::from_str(&content).map_err(|e| format!("parse agent: {e}"))?;
    agent.memory = load_memory(slug).unwrap_or_default();
    Ok(agent)
}

pub fn save_agent(agent: &AgentDefinition) -> Result<(), String> {
    agent.validate()?;
    let dir = agents_dir()?;
    let path = dir.join(format!("{}.json", agent.slug));
    let content = serde_json::to_string_pretty(agent).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("write agent: {e}"))?;
    Ok(())
}

pub fn delete_agent(slug: &str) -> Result<(), String> {
    validate_slug(slug)?;
    let path = agents_dir()?.join(format!("{slug}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete agent: {e}"))?;
    }
    let mem_path = memory_path(slug)?;
    if mem_path.exists() {
        let _ = std::fs::remove_file(&mem_path);
    }
    Ok(())
}

const MAX_MEMORY_CHARS: usize = 120_000;

fn memory_path(slug: &str) -> Result<PathBuf, String> {
    Ok(agents_dir()?.join(format!("{slug}.memory.md")))
}

fn load_memory(slug: &str) -> Result<String, String> {
    let path = memory_path(slug)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("read memory: {e}"))
}

pub fn append_memory(slug: &str, entry: &str) -> Result<(), String> {
    validate_slug(slug)?;
    let path = memory_path(slug)?;
    let mut content = load_memory(slug).unwrap_or_default();
    content.push_str(entry);
    content.push('\n');

    if content.len() > MAX_MEMORY_CHARS {
        if let Some(archive) = archive_memory(slug, &content)? {
            content = archive;
        }
    }

    std::fs::write(&path, content).map_err(|e| format!("write memory: {e}"))?;
    Ok(())
}

fn archive_memory(slug: &str, content: &str) -> Result<Option<String>, String> {
    let dir = agents_dir()?;
    let archive_path = dir.join(format!("{slug}.archive.jsonl"));

    let half = content.len() / 2;
    let char_boundary = content.floor_char_boundary(half);
    let cutoff = content[..char_boundary]
        .rfind('\n')
        .unwrap_or(char_boundary);
    let archived = &content[..cutoff];
    let remaining = &content[cutoff..];

    let timestamp = chrono::Utc::now().to_rfc3339();
    let entry = serde_json::json!({
        "timestamp": timestamp,
        "slug": slug,
        "content": archived,
    });
    let line = serde_json::to_string(&entry).map_err(|e| format!("serialize archive: {e}"))?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&archive_path)
        .map_err(|e| format!("open archive: {e}"))?;
    use std::io::Write;
    writeln!(file, "{line}").map_err(|e| format!("write archive: {e}"))?;

    Ok(Some(remaining.to_string()))
}
