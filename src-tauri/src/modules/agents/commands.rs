use crate::modules::agents::registry::{get_agent, AgentRegistration, AGENT_REGISTRY};

/// Returns the full list of registered agents (for frontend settings UI).
#[tauri::command]
pub fn agent_get_registry() -> Vec<AgentRegistration> {
    AGENT_REGISTRY.to_vec()
}

/// Returns a single agent registration by id.
#[tauri::command]
pub fn agent_get_agent(id: String) -> Result<AgentRegistration, String> {
    get_agent(&id).cloned().ok_or_else(|| format!("unknown agent: {id}"))
}

/// Enable hooks for a specific agent by id.
/// For agents with native hooks (Claude, Codex), writes hook config.
/// For wrapper-based agents, returns a message that shell wrappers are active.
#[tauri::command]
pub fn agent_enable_hooks(agent_id: String) -> Result<String, String> {
    let agent = get_agent(&agent_id)
        .ok_or_else(|| format!("unknown agent: {agent_id}"))?;

    if !agent.has_native_hooks {
        return Ok(format!(
            "{} uses shell wrappers — no config file needed",
            agent.name
        ));
    }

    match agent_id.as_str() {
        "claude" => crate::agent::agent_enable_claude_hooks()
            .map(|_| format!("Claude Code hooks enabled")),
        "codex" => {
            // FIXME: Codex uses PermitRequest for attention, not Notification.
            // PR #625 will add proper Codex hook events when merged.
            // Until then, merge_hooks writes Claude-style events which don't
            // match Codex's hook contract — works for basic notification but
            // doesn't surface attention signals correctly.
            enable_codex_hooks()
        }
        other => Err(format!("native hooks not yet implemented for: {other}")),
    }
}

/// Write Codex CLI hooks config (~/.codex/hooks.json).
fn enable_codex_hooks() -> Result<String, String> {
    let path = dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".codex")
        .join("hooks.json");

    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("create {}: {e}", dir.display()))?;

    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => {
            if !s.trim().is_empty() {
                serde_json::from_str::<serde_json::Value>(&s)
                    .map_err(|e| format!("{} is not valid JSON ({e})", path.display()))?
            } else {
                serde_json::json!({})
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };

    let merged = crate::agent::merge_hooks(existing);
    let out = serde_json::to_string_pretty(&merged)
        .map_err(|e| e.to_string())?;

    let tmp = path.with_extension("json.terax-tmp");
    std::fs::write(&tmp, out)
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", path.display())
    })?;

    Ok("Codex CLI hooks enabled".to_string())
}
