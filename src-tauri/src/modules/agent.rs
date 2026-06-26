use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
struct HookEvent {
    name: &'static str,
    marker: &'static str,
}

#[derive(Clone, Copy)]
struct ProviderHooks {
    events: &'static [HookEvent],
    marker_prefix: &'static str,
    owned_markers: &'static [&'static str],
    hook_group: fn(&str) -> Value,
}

impl ProviderHooks {
    fn claude() -> Self {
        Self {
            events: &CLAUDE_HOOK_EVENTS,
            marker_prefix: "notify;Terax;",
            owned_markers: &CLAUDE_OWNED_MARKERS,
            hook_group: claude_hook_group,
        }
    }

    fn codex() -> Self {
        Self {
            events: &CODEX_HOOK_EVENTS,
            marker_prefix: "notify;Terax;codex;",
            owned_markers: &CODEX_OWNED_MARKERS,
            hook_group: codex_hook_group,
        }
    }

    fn marker_text(self, marker: &str) -> String {
        format!("{}{marker}", self.marker_prefix)
    }
}

const CLAUDE_HOOK_EVENTS: [HookEvent; 3] = [
    HookEvent {
        name: "UserPromptSubmit",
        marker: "working",
    },
    HookEvent {
        name: "Notification",
        marker: "attention",
    },
    HookEvent {
        name: "Stop",
        marker: "finished",
    },
];

const CODEX_HOOK_EVENTS: [HookEvent; 3] = [
    HookEvent {
        name: "UserPromptSubmit",
        marker: "working",
    },
    HookEvent {
        name: "PermissionRequest",
        marker: "attention",
    },
    HookEvent {
        name: "Stop",
        marker: "finished",
    },
];

// Includes the pre-v2.1.139 /dev/tty variant so re-running migrates it.
const CLAUDE_OWNED_MARKERS: [&str; 2] = ["notify;Terax;", "terax;notify"];
const CODEX_OWNED_MARKERS: [&str; 1] = ["notify;Terax;codex;"];

// Gated on TERAX_TERMINAL; no-op outside Terax. Returns the sequence via
// `terminalSequence` because hooks lost /dev/tty access in v2.1.139.
fn claude_hook_cmd(event: &str) -> String {
    format!(
        r#"[ -n "$TERAX_TERMINAL" ] && printf '{{"terminalSequence":"\\u001b]777;notify;Terax;{event}\\u0007"}}' || true"#
    )
}

fn codex_hook_cmd(event: &str) -> String {
    format!(
        r#"[ -n "$TERAX_TERMINAL" ] && {{ printf '\033]777;notify;Terax;codex;{event}\007' 2>/dev/null > /dev/tty || printf '\033]777;notify;Terax;codex;{event}\007' 2>/dev/null > "/proc/$PPID/fd/1" || true; }}"#
    )
}

fn codex_windows_hook_cmd(event: &str) -> String {
    format!(
        r#"powershell -NoProfile -Command "if ($env:TERAX_TERMINAL) {{ $s = [string][char]27 + ']777;notify;Terax;codex;{event}' + [string][char]7; $bytes = [System.Text.Encoding]::UTF8.GetBytes($s); $out = [System.IO.File]::OpenWrite('\\.\CONOUT$'); try {{ $out.Write($bytes, 0, $bytes.Length) }} finally {{ $out.Dispose() }} }}""#
    )
}

fn claude_hook_group(event: &str) -> Value {
    json!({
        "hooks": [ { "type": "command", "command": claude_hook_cmd(event) } ]
    })
}

fn codex_hook_group(event: &str) -> Value {
    json!({
        "hooks": [ {
            "type": "command",
            "command": codex_hook_cmd(event),
            "commandWindows": codex_windows_hook_cmd(event),
        } ]
    })
}

fn is_ours(group: &Value, spec: ProviderHooks) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            hs.iter().any(|h| {
                ["command", "commandWindows"].iter().any(|key| {
                    h.get(key)
                        .and_then(Value::as_str)
                        .is_some_and(|c| spec.owned_markers.iter().any(|m| c.contains(m)))
                })
            })
        })
}

// A group with no hooks is inert cruft (e.g. left behind when someone deletes
// our command but not its wrapper). Drop it so the file stays clean.
fn is_empty_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_none_or(|hs| hs.is_empty())
}

fn merge_provider_hooks(mut root: Value, spec: ProviderHooks) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();

    for event in spec.events {
        let arr = hooks.entry(event.name).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let arr = arr.as_array_mut().unwrap();
        arr.retain(|group| !is_ours(group, spec) && !is_empty_group(group));
        arr.push((spec.hook_group)(event.marker));
    }
    root
}

#[cfg(test)]
fn merge_hooks(root: Value) -> Value {
    merge_provider_hooks(root, ProviderHooks::claude())
}

fn existing_config(contents: Option<&str>, path: &Path) -> Result<Value, String> {
    match contents {
        Some(s) if !s.trim().is_empty() => serde_json::from_str::<Value>(s).map_err(|e| {
            format!(
                "{} is not valid JSON ({e}); refusing to overwrite",
                path.display()
            )
        }),
        _ => Ok(json!({})),
    }
}

fn claude_settings_path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".claude")
        .join("settings.json"))
}

fn codex_hooks_path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".codex")
        .join("hooks.json"))
}

fn enable_hooks_at(path: PathBuf, spec: ProviderHooks) -> Result<(), String> {
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => existing_config(Some(&s), &path)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };

    let merged = merge_provider_hooks(existing, spec);
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;

    // Write to a sibling temp file then rename so a crash mid-write can't leave
    // a truncated config file.
    let tmp = path.with_extension("json.terax-tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", path.display())
    })?;
    Ok(())
}

fn hooks_status_at(path: PathBuf, spec: ProviderHooks) -> bool {
    let Ok(content) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(root) = serde_json::from_str::<Value>(&content) else {
        return false;
    };

    spec.events.iter().all(|event| {
        let marker = spec.marker_text(event.marker);
        root.get("hooks")
            .and_then(|hooks| hooks.get(event.name))
            .and_then(Value::as_array)
            .is_some_and(|groups| {
                groups.iter().any(|group| {
                    group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .is_some_and(|hooks| {
                            hooks.iter().any(|hook| {
                                ["command", "commandWindows"].iter().any(|key| {
                                    hook.get(key)
                                        .and_then(Value::as_str)
                                        .is_some_and(|command| command.contains(&marker))
                                })
                            })
                        })
                })
            })
    })
}

#[tauri::command]
pub fn agent_enable_claude_hooks() -> Result<(), String> {
    enable_hooks_at(claude_settings_path()?, ProviderHooks::claude())
}

#[tauri::command]
pub fn agent_claude_hooks_status() -> bool {
    claude_settings_path()
        .map(|path| hooks_status_at(path, ProviderHooks::claude()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn agent_enable_codex_hooks() -> Result<(), String> {
    enable_hooks_at(codex_hooks_path()?, ProviderHooks::codex())
}

#[tauri::command]
pub fn agent_codex_hooks_status() -> bool {
    codex_hooks_path()
        .map(|path| hooks_status_at(path, ProviderHooks::codex()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hook_count(root: &Value, event: &str) -> usize {
        root["hooks"][event].as_array().map_or(0, Vec::len)
    }

    fn command(root: &Value, event: &str, idx: usize) -> String {
        root["hooks"][event][idx]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn adds_all_event_hooks_to_empty_config() {
        let out = merge_hooks(json!({}));
        assert_eq!(hook_count(&out, "UserPromptSubmit"), 1);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert_eq!(hook_count(&out, "Stop"), 1);
        assert!(command(&out, "Notification", 0).contains("notify;Terax;attention"));
        assert!(command(&out, "Stop", 0).contains("notify;Terax;finished"));
        assert!(command(&out, "UserPromptSubmit", 0).contains("notify;Terax;working"));
        assert!(command(&out, "Stop", 0).contains("terminalSequence"));
        assert!(!command(&out, "Stop", 0).contains("/dev/tty"));
    }

    #[test]
    fn is_idempotent() {
        let once = merge_hooks(json!({}));
        let twice = merge_hooks(once.clone());
        assert_eq!(once, twice);
        assert_eq!(hook_count(&twice, "Notification"), 1);
    }

    #[test]
    fn migrates_legacy_dev_tty_hook() {
        let legacy = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [ {
                        "type": "command",
                        "command": "[ -n \"$TERAX_TERMINAL\" ] && printf '\\033]777;terax;notify\\033\\\\' > /dev/tty || true"
                    } ] }
                ]
            }
        });
        let out = merge_hooks(legacy);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert!(command(&out, "Notification", 0).contains("terminalSequence"));
        assert!(!command(&out, "Notification", 0).contains("/dev/tty"));
    }

    #[test]
    fn preserves_unrelated_settings_and_foreign_hooks() {
        let input = json!({
            "permissions": { "allow": ["Bash"] },
            "hooks": {
                "Notification": [
                    { "hooks": [ { "type": "command", "command": "say hi" } ] }
                ]
            }
        });
        let out = merge_hooks(input);
        assert_eq!(out["permissions"]["allow"][0], "Bash");
        assert_eq!(hook_count(&out, "Notification"), 2);
        assert_eq!(command(&out, "Notification", 0), "say hi");
    }

    #[test]
    fn replaces_non_object_root() {
        let out = merge_hooks(json!("garbage"));
        assert_eq!(hook_count(&out, "Notification"), 1);
    }

    #[test]
    fn prunes_empty_groups_and_collapses_duplicates() {
        let input = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [] },
                    { "hooks": [ { "type": "command", "command": claude_hook_cmd("attention") } ] }
                ]
            }
        });
        let out = merge_hooks(input);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert!(command(&out, "Notification", 0).contains("notify;Terax;attention"));
    }

    #[test]
    fn adds_codex_hooks_to_empty_config() {
        let out = merge_provider_hooks(json!({}), ProviderHooks::codex());
        assert_eq!(hook_count(&out, "UserPromptSubmit"), 1);
        assert_eq!(hook_count(&out, "PermissionRequest"), 1);
        assert_eq!(hook_count(&out, "Stop"), 1);
        assert!(command(&out, "UserPromptSubmit", 0).contains("notify;Terax;codex;working"));
        assert!(command(&out, "PermissionRequest", 0).contains("notify;Terax;codex;attention"));
        assert!(command(&out, "Stop", 0).contains("notify;Terax;codex;finished"));
        assert!(command(&out, "PermissionRequest", 0).contains("/proc/$PPID/fd/1"));
    }

    #[test]
    fn codex_hooks_are_idempotent_and_preserve_foreign_hooks() {
        let input = json!({
            "hooks": {
                "Stop": [
                    { "hooks": [ { "type": "command", "command": "echo foreign" } ] }
                ]
            }
        });
        let once = merge_provider_hooks(input, ProviderHooks::codex());
        let twice = merge_provider_hooks(once.clone(), ProviderHooks::codex());
        assert_eq!(once, twice);
        assert_eq!(hook_count(&twice, "Stop"), 2);
        assert_eq!(command(&twice, "Stop", 0), "echo foreign");
    }

    #[test]
    fn claude_hooks_still_use_terminal_sequence() {
        let out = merge_provider_hooks(json!({}), ProviderHooks::claude());
        assert!(command(&out, "Stop", 0).contains("terminalSequence"));
        assert!(command(&out, "Stop", 0).contains("notify;Terax;finished"));
    }

    #[test]
    fn existing_config_absent_or_empty_starts_fresh() {
        let p = std::path::Path::new("/x/settings.json");
        assert_eq!(existing_config(None, p).unwrap(), json!({}));
        assert_eq!(existing_config(Some("   \n"), p).unwrap(), json!({}));
    }

    #[test]
    fn existing_config_refuses_to_clobber_invalid_json() {
        let p = std::path::Path::new("/x/settings.json");
        assert!(existing_config(Some("{ not json,"), p).is_err());
        assert_eq!(
            existing_config(Some(r#"{"permissions":{}}"#), p).unwrap(),
            json!({ "permissions": {} })
        );
    }
}
