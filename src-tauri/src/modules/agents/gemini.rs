use serde_json::{json, Value};

const GEMINI_EVENTS: [(&str, &str); 3] = [
    ("BeforeAgent", "working"),
    ("AfterAgent", "finished"),
    ("Notification", "attention"),
];

fn settings_path() -> Result<std::path::PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "no home dir".to_string())?
        .join(".gemini")
        .join("settings.json"))
}

fn hook_cmd(event: &str) -> String {
    format!(
        r#"[ -n "$TERAX_TERMINAL" ] && printf '\033]777;notify;Terax;gemini;{}\007' || true"#,
        event
    )
}

fn hook_name(event: &str) -> String {
    format!("terax-{}", event)
}

fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            hs.iter().any(|h| {
                h.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|n| n.starts_with("terax-"))
            })
        })
}

fn hook_group(event: &str) -> Value {
    json!({
        "hooks": [{
            "type": "command",
            "command": hook_cmd(event),
            "name": hook_name(event),
            "timeout": 5000
        }]
    })
}

fn is_empty_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_none_or(|hs| hs.is_empty())
}

fn merge_hooks(mut root: Value) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks_obj = hooks.as_object_mut().unwrap();

    for (event, marker) in GEMINI_EVENTS {
        let arr = hooks_obj.entry(event).or_insert_with(|| json!([]));
        let arr = arr.as_array_mut().unwrap();
        arr.retain(|g| !is_ours(g) && !is_empty_group(g));
        arr.push(hook_group(marker));
    }
    root
}

/// Enable Gemini CLI hooks by writing to ~/.gemini/settings.json.
#[tauri::command]
pub fn agent_enable_gemini_hooks() -> Result<(), String> {
    let path = settings_path()?;
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("mkdir: {e}"))?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) if !s.trim().is_empty() => {
            serde_json::from_str(&s).map_err(|e| format!("invalid JSON: {e}"))?
        }
        Ok(_) | Err(_) => json!({}),
    };
    let merged = merge_hooks(existing);
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.terax-tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("write: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename: {e}")
    })?;
    Ok(())
}

/// Check if Gemini CLI hooks are installed.
#[tauri::command]
pub fn agent_gemini_hooks_status() -> bool {
    settings_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .is_some_and(|c| {
            GEMINI_EVENTS
                .iter()
                .all(|(_, m)| c.contains(&format!("notify;Terax;gemini;{m}")))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_all_events_to_empty_config() {
        let out = merge_hooks(json!({}));
        for (event, marker) in GEMINI_EVENTS {
            let arr = out["hooks"][event].as_array().unwrap();
            assert_eq!(arr.len(), 1, "missing event: {event}");
            let cmd = arr[0]["hooks"][0]["command"].as_str().unwrap();
            assert!(cmd.contains(&format!("gemini;{marker}")));
        }
    }

    #[test]
    fn is_idempotent() {
        let once = merge_hooks(json!({}));
        let twice = merge_hooks(once.clone());
        assert_eq!(once, twice);
    }

    #[test]
    fn preserves_foreign_settings() {
        let input = json!({"security": {"approvalMode": "yolo"}});
        let out = merge_hooks(input);
        assert_eq!(out["security"]["approvalMode"], "yolo");
    }
}
