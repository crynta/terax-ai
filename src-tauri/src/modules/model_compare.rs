use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const HISTORY_LIMIT: usize = 50;
const MAX_HISTORY_BYTES: u64 = 1_048_576;

#[tauri::command]
pub fn model_compare_history_get(app: AppHandle) -> Result<Vec<Value>, String> {
    let path = history_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_HISTORY_BYTES {
        return Err("model compare history is too large".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed: Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    let entries = parsed
        .as_array()
        .ok_or_else(|| "model compare history must be an array".to_string())?;
    Ok(entries
        .iter()
        .filter(|entry| is_valid_history_entry(entry))
        .take(HISTORY_LIMIT)
        .cloned()
        .collect())
}

#[tauri::command]
pub fn model_compare_history_put(app: AppHandle, entries: Vec<Value>) -> Result<(), String> {
    let path = history_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let entries: Vec<Value> = entries.into_iter().take(HISTORY_LIMIT).collect();
    if !entries.iter().all(is_valid_history_entry) {
        return Err("model compare history contains invalid entries".to_string());
    }
    let content = serde_json::to_string_pretty(&entries).map_err(|error| error.to_string())?;
    if content.len() as u64 > MAX_HISTORY_BYTES {
        return Err("model compare history is too large".to_string());
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_compare_history_clear(app: AppHandle) -> Result<(), String> {
    let path = history_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("model-compare")
        .join("history.json"))
}

fn valid_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty() && !text.chars().any(char::is_control))
}

fn valid_number(value: Option<&Value>) -> bool {
    value.and_then(Value::as_f64).is_some()
}

fn is_valid_history_entry(entry: &Value) -> bool {
    let Some(entry) = entry.as_object() else {
        return false;
    };
    if !valid_string(entry.get("id")) || !valid_number(entry.get("savedAt")) {
        return false;
    }
    let Some(run) = entry.get("run").and_then(Value::as_object) else {
        return false;
    };
    if run.get("id") != entry.get("id") {
        return false;
    }
    valid_string(run.get("id"))
        && valid_string(run.get("prompt"))
        && valid_number(run.get("createdAt"))
        && run.get("blind").and_then(Value::as_bool).is_some()
        && run.get("revealed").and_then(Value::as_bool).is_some()
        && run
            .get("publicSnapshot")
            .and_then(Value::as_object)
            .is_some()
        && run
            .get("mode")
            .and_then(Value::as_str)
            .is_some_and(|mode| matches!(mode, "models" | "prompts" | "agent" | "research"))
        && run
            .get("panes")
            .and_then(Value::as_array)
            .is_some_and(|panes| (2..=4).contains(&panes.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_entry(id: &str) -> Value {
        json!({
            "id": id,
            "savedAt": 1,
            "run": {
                "id": id,
                "prompt": "Compare this",
                "mode": "models",
                "blind": true,
                "revealed": false,
                "createdAt": 1,
                "panes": [{ "id": "pane_1" }, { "id": "pane_2" }],
                "vote": null,
                "publicSnapshot": {}
            }
        })
    }

    #[test]
    fn validates_history_entries_before_writing() {
        assert!(is_valid_history_entry(&valid_entry("cmp_1")));
        assert!(!is_valid_history_entry(&json!({"id":"cmp_1"})));
        assert!(!is_valid_history_entry(&json!({
            "id": "cmp_1",
            "savedAt": 1,
            "run": { "id": "different" }
        })));
        assert!(!is_valid_history_entry(&json!({
            "id": "cmp_1\n",
            "savedAt": 1,
            "run": { "id": "cmp_1\n" }
        })));
        assert!(!is_valid_history_entry(&json!({
            "id": "cmp_1",
            "savedAt": 1,
            "run": {
                "id": "cmp_1",
                "prompt": "Compare this",
                "mode": "invalid",
                "blind": true,
                "revealed": false,
                "createdAt": 1,
                "panes": [{ "id": "pane_1" }, { "id": "pane_2" }],
                "publicSnapshot": {}
            }
        })));
        assert!(!is_valid_history_entry(&json!({
            "id": "cmp_1",
            "savedAt": 1,
            "run": {
                "id": "cmp_1",
                "prompt": "Compare this",
                "mode": "models",
                "blind": true,
                "revealed": false,
                "createdAt": 1,
                "panes": [{ "id": "pane_1" }],
                "publicSnapshot": {}
            }
        })));
    }
}
