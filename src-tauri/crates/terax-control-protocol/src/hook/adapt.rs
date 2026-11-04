use serde::{Deserialize, Deserializer};
use serde_json::Value;

use super::text::{clean_text, truncate_str};
use super::{
    is_decision_event, AgentName, HookFacts, HookKind, PermissionInfo, SubagentInfo, SubagentState,
    Suggestion, ToolInfo, MAX_LABEL, MAX_MESSAGE, MAX_NAME, MAX_PATH, MAX_PREVIEW, MAX_SESSION_ID,
    MAX_SUGGESTIONS,
};

#[derive(Debug, PartialEq, Eq)]
pub enum NormalizeError {
    UnsupportedEvent,
}

/// Union of the stdin fields the supported agents send. Claude Code and Codex
/// share most names; Gemini adds `prompt_response` and `details`; the Pi
/// extension emits Claude-shaped payloads. Every field is optional and a field
/// of the wrong type reads as absent.
#[derive(Default, Deserialize)]
struct Fields {
    #[serde(default, deserialize_with = "text")]
    session_id: Option<String>,
    #[serde(default, deserialize_with = "text")]
    transcript_path: Option<String>,
    #[serde(default, deserialize_with = "text")]
    cwd: Option<String>,
    #[serde(default, deserialize_with = "text")]
    tool_name: Option<String>,
    #[serde(default, deserialize_with = "text")]
    tool_use_id: Option<String>,
    #[serde(default)]
    tool_input: Value,
    #[serde(default, deserialize_with = "text")]
    prompt: Option<String>,
    #[serde(default, deserialize_with = "text")]
    prompt_response: Option<String>,
    #[serde(default, deserialize_with = "text")]
    last_assistant_message: Option<String>,
    #[serde(default, deserialize_with = "text")]
    message: Option<String>,
    #[serde(default, deserialize_with = "text")]
    title: Option<String>,
    #[serde(default, deserialize_with = "text")]
    notification_type: Option<String>,
    #[serde(default)]
    details: Value,
    #[serde(default, deserialize_with = "text")]
    error: Option<String>,
    #[serde(default, deserialize_with = "text")]
    error_details: Option<String>,
    #[serde(default, deserialize_with = "text")]
    source: Option<String>,
    #[serde(default, deserialize_with = "text")]
    reason: Option<String>,
    #[serde(default, deserialize_with = "text")]
    agent_id: Option<String>,
    #[serde(default, deserialize_with = "text")]
    agent_type: Option<String>,
    #[serde(default, deserialize_with = "flag")]
    is_error: Option<bool>,
    #[serde(default, deserialize_with = "flag")]
    aborted: Option<bool>,
    #[serde(default, deserialize_with = "list")]
    permission_suggestions: Vec<Value>,
}

fn text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) => Some(text),
        _ => None,
    })
}

fn flag<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<bool>, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_bool())
}

fn list<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Value>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(items) => items,
        _ => Vec::new(),
    })
}

pub fn normalize(
    agent: AgentName,
    event: &str,
    payload: &Value,
) -> Result<HookFacts, NormalizeError> {
    let mut kind = event_kind(agent, event).ok_or(NormalizeError::UnsupportedEvent)?;
    let fields = Fields::deserialize(payload).unwrap_or_default();

    let gemini_permission = agent == AgentName::Gemini
        && kind == HookKind::Notification
        && fields.notification_type.as_deref() == Some("ToolPermission");
    if gemini_permission {
        kind = HookKind::PermissionRequest;
    }

    let mut facts = HookFacts::new(kind);
    facts.session_id = fields.session_id.as_deref().and_then(session_id);
    facts.transcript_path = fields.transcript_path.as_deref().and_then(path);
    facts.cwd = fields.cwd.as_deref().and_then(path);

    match kind {
        HookKind::SessionStart => facts.reason = short(fields.source.as_deref()),
        HookKind::SessionEnd => facts.reason = short(fields.reason.as_deref()),
        HookKind::Prompt => facts.message = message(fields.prompt.as_deref()),
        HookKind::Stop => {
            facts.message = message(
                fields
                    .last_assistant_message
                    .as_deref()
                    .or(fields.prompt_response.as_deref()),
            );
        }
        HookKind::StopFailure => {
            facts.reason = short(fields.error.as_deref());
            facts.message = message(
                fields
                    .last_assistant_message
                    .as_deref()
                    .or(fields.error_details.as_deref())
                    .or(fields.error.as_deref()),
            );
        }
        HookKind::Notification => {
            facts.message = message(fields.message.as_deref().or(fields.title.as_deref()));
            facts.notification_type = short(fields.notification_type.as_deref());
        }
        HookKind::ToolStart | HookKind::ToolEnd => {
            let failed = event == "PostToolUseFailure" || fields.is_error == Some(true);
            facts.tool = tool_info(&fields, failed);
        }
        HookKind::PermissionRequest => {
            facts.notification_type = short(fields.notification_type.as_deref());
            if gemini_permission {
                facts.message = message(fields.message.as_deref());
                facts.permission = Some(gemini_permission_info(&fields.details));
            } else {
                facts.message = message(description(&fields.tool_input).as_deref());
                facts.permission = Some(permission_info(&fields));
            }
            facts.decision_capable = is_decision_event(agent, event);
        }
        HookKind::SubagentStart | HookKind::SubagentStop => {
            let state = if kind == HookKind::SubagentStart {
                SubagentState::Running
            } else {
                facts.message = message(fields.last_assistant_message.as_deref());
                SubagentState::Done
            };
            facts.subagent =
                fields
                    .agent_id
                    .as_deref()
                    .and_then(session_id)
                    .map(|id| SubagentInfo {
                        id,
                        agent_type: short(fields.agent_type.as_deref())
                            .unwrap_or_else(|| "agent".to_string()),
                        state,
                    });
        }
        HookKind::Interrupt => {}
        HookKind::PermissionResolved => return Err(NormalizeError::UnsupportedEvent),
    }
    if fields.aborted == Some(true) && kind == HookKind::Stop {
        facts.reason = Some("aborted".to_string());
    }
    Ok(facts)
}

fn event_kind(agent: AgentName, event: &str) -> Option<HookKind> {
    let kind = match agent {
        AgentName::Gemini => match event {
            "SessionStart" => HookKind::SessionStart,
            "BeforeAgent" => HookKind::Prompt,
            "BeforeTool" => HookKind::ToolStart,
            "AfterTool" => HookKind::ToolEnd,
            "Notification" => HookKind::Notification,
            "AfterAgent" => HookKind::Stop,
            "SessionEnd" => HookKind::SessionEnd,
            _ => return None,
        },
        _ => match event {
            "SessionStart" => HookKind::SessionStart,
            "UserPromptSubmit" => HookKind::Prompt,
            "PreToolUse" => HookKind::ToolStart,
            "PostToolUse" | "PostToolUseFailure" => HookKind::ToolEnd,
            "PermissionRequest" => HookKind::PermissionRequest,
            "Notification" => HookKind::Notification,
            "Stop" => HookKind::Stop,
            "StopFailure" => HookKind::StopFailure,
            "Interrupt" if agent == AgentName::Codex => HookKind::Interrupt,
            "SubagentStart" => HookKind::SubagentStart,
            "SubagentStop" => HookKind::SubagentStop,
            "SessionEnd" => HookKind::SessionEnd,
            _ => return None,
        },
    };
    Some(kind)
}

fn session_id(value: &str) -> Option<String> {
    let valid = !value.is_empty()
        && value.len() <= MAX_SESSION_ID
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte));
    valid.then(|| value.to_string())
}

fn path(value: &str) -> Option<String> {
    if value.len() > MAX_PATH || value.chars().any(char::is_control) {
        return None;
    }
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn message(value: Option<&str>) -> Option<String> {
    value.and_then(|text| clean_text(text, MAX_MESSAGE))
}

fn short(value: Option<&str>) -> Option<String> {
    value.and_then(|text| clean_text(text, MAX_NAME))
}

fn tool_info(fields: &Fields, failed: bool) -> Option<ToolInfo> {
    let name = short(fields.tool_name.as_deref())?;
    Some(ToolInfo {
        input_preview: preview(&fields.tool_input),
        id: fields.tool_use_id.as_deref().and_then(session_id),
        error: failed,
        name,
    })
}

fn permission_info(fields: &Fields) -> PermissionInfo {
    PermissionInfo {
        request_id: None,
        tool: short(fields.tool_name.as_deref()).unwrap_or_else(|| "tool".to_string()),
        input_preview: preview(&fields.tool_input),
        suggestions: fields
            .permission_suggestions
            .iter()
            .take(MAX_SUGGESTIONS)
            .map(|entry| Suggestion {
                label: suggestion_label(entry),
            })
            .collect(),
        outcome: None,
    }
}

fn gemini_permission_info(details: &Value) -> PermissionInfo {
    let field = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| details.get(*key).and_then(Value::as_str))
            .map(str::to_string)
    };
    let tool = field(&["toolName", "toolDisplayName"])
        .or_else(|| {
            field(&["type"]).map(|kind| match kind.as_str() {
                "exec" => "shell".to_string(),
                "edit" => "edit".to_string(),
                "info" => "web".to_string(),
                _ => kind,
            })
        })
        .unwrap_or_else(|| "tool".to_string());
    let input = field(&["command", "filePath", "fileName", "prompt", "title"])
        .unwrap_or_else(|| compact(details));
    PermissionInfo {
        request_id: None,
        tool: clean_text(&tool, MAX_NAME).unwrap_or_else(|| "tool".to_string()),
        input_preview: clean_text(&input, MAX_PREVIEW).unwrap_or_default(),
        suggestions: Vec::new(),
        outcome: None,
    }
}

fn description(input: &Value) -> Option<String> {
    input.get("description")?.as_str().map(str::to_string)
}

const PREVIEW_KEYS: &[&str] = &[
    "command",
    "cmd",
    "file_path",
    "absolute_path",
    "notebook_path",
    "path",
    "url",
    "pattern",
    "query",
    "description",
    "prompt",
    "patch",
    "input",
];

fn preview(input: &Value) -> String {
    let raw = match input {
        Value::Object(map) => PREVIEW_KEYS
            .iter()
            .find_map(|key| map.get(*key).and_then(readable))
            .unwrap_or_else(|| compact(input)),
        Value::Null => String::new(),
        other => readable(other).unwrap_or_else(|| compact(other)),
    };
    clean_text(&raw, MAX_PREVIEW).unwrap_or_default()
}

fn readable(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) if !items.is_empty() => items
            .iter()
            .map(|item| item.as_str().map(str::to_string))
            .collect::<Option<Vec<_>>>()
            .map(|parts| parts.join(" ")),
        _ => None,
    }
}

fn compact(value: &Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    truncate_str(&raw, MAX_PREVIEW)
}

fn suggestion_label(entry: &Value) -> String {
    let scope = match entry.get("destination").and_then(Value::as_str) {
        Some("session") => " for this session",
        Some("localSettings") => " in local settings",
        Some("projectSettings") => " for this project",
        Some("userSettings") => " for all projects",
        _ => "",
    };
    let label = match entry.get("type").and_then(Value::as_str) {
        Some("addRules") => format!("Always allow {}{scope}", rule_summary(entry)),
        Some("setMode") => {
            let mode = entry.get("mode").and_then(Value::as_str).unwrap_or("new");
            format!("Switch to {mode} mode{scope}")
        }
        Some("addDirectories") => {
            let dirs = entry
                .get("directories")
                .and_then(Value::as_array)
                .map(|dirs| dirs.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .filter(|dirs| !dirs.is_empty())
                .map_or_else(|| "directory".to_string(), |dirs| dirs.join(", "));
            format!("Allow access to {dirs}{scope}")
        }
        _ => format!("Apply suggested permission update{scope}"),
    };
    clean_text(&label, MAX_LABEL).unwrap_or_else(|| "Apply suggested permission update".into())
}

fn rule_summary(entry: &Value) -> String {
    let rules = entry
        .get("rules")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let Some(first) = rules.first() else {
        return "this tool".to_string();
    };
    let tool = first
        .get("toolName")
        .and_then(Value::as_str)
        .unwrap_or("tool");
    let mut summary = match first.get("ruleContent").and_then(Value::as_str) {
        Some(content) if !content.is_empty() => format!("{tool}({content})"),
        _ => tool.to_string(),
    };
    if rules.len() > 1 {
        summary.push_str(&format!(" +{} more", rules.len() - 1));
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(agent: AgentName, event: &str, payload: Value) -> HookFacts {
        normalize(agent, event, &payload).unwrap_or_else(|error| {
            panic!("{agent:?} {event} rejected: {error:?}");
        })
    }

    #[test]
    fn claude_session_lifecycle_events() {
        let start = run(
            AgentName::Claude,
            "SessionStart",
            json!({
                "session_id": "abc123",
                "transcript_path": "/Users/me/.claude/projects/p/abc.jsonl",
                "cwd": "/Users/me/p",
                "hook_event_name": "SessionStart",
                "source": "resume",
                "model": "claude-opus-5",
            }),
        );
        assert_eq!(start.kind, HookKind::SessionStart);
        assert_eq!(start.session_id.as_deref(), Some("abc123"));
        assert_eq!(
            start.transcript_path.as_deref(),
            Some("/Users/me/.claude/projects/p/abc.jsonl")
        );
        assert_eq!(start.cwd.as_deref(), Some("/Users/me/p"));
        assert_eq!(start.reason.as_deref(), Some("resume"));

        let end = run(
            AgentName::Claude,
            "SessionEnd",
            json!({ "session_id": "abc123", "reason": "prompt_input_exit" }),
        );
        assert_eq!(end.kind, HookKind::SessionEnd);
        assert_eq!(end.reason.as_deref(), Some("prompt_input_exit"));
    }

    #[test]
    fn claude_prompt_and_stop_carry_the_text() {
        let prompt = run(
            AgentName::Claude,
            "UserPromptSubmit",
            json!({ "session_id": "s", "prompt": "fix the build" }),
        );
        assert_eq!(prompt.kind, HookKind::Prompt);
        assert_eq!(prompt.message.as_deref(), Some("fix the build"));

        let stop = run(
            AgentName::Claude,
            "Stop",
            json!({
                "session_id": "s",
                "stop_hook_active": false,
                "last_assistant_message": "Done. All tests pass.",
                "background_tasks": [],
            }),
        );
        assert_eq!(stop.kind, HookKind::Stop);
        assert_eq!(stop.message.as_deref(), Some("Done. All tests pass."));

        let failure = run(
            AgentName::Claude,
            "StopFailure",
            json!({
                "session_id": "s",
                "error": "rate_limit",
                "error_details": "429 Too Many Requests",
                "last_assistant_message": "API Error: Rate limit reached",
            }),
        );
        assert_eq!(failure.kind, HookKind::StopFailure);
        assert_eq!(failure.reason.as_deref(), Some("rate_limit"));
        assert_eq!(
            failure.message.as_deref(),
            Some("API Error: Rate limit reached")
        );
    }

    #[test]
    fn claude_tool_events_carry_name_input_and_failure() {
        let start = run(
            AgentName::Claude,
            "PreToolUse",
            json!({
                "session_id": "abc123",
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {
                    "command": "npm test",
                    "description": "Run test suite",
                    "timeout": 120000,
                    "run_in_background": false,
                },
                "tool_use_id": "toolu_01ABC123",
            }),
        );
        assert_eq!(start.kind, HookKind::ToolStart);
        let tool = start.tool.unwrap();
        assert_eq!(tool.name, "Bash");
        assert_eq!(tool.input_preview, "npm test");
        assert_eq!(tool.id.as_deref(), Some("toolu_01ABC123"));
        assert!(!tool.error);

        let write = run(
            AgentName::Claude,
            "PostToolUse",
            json!({
                "tool_name": "Write",
                "tool_input": { "file_path": "/p/a.txt", "content": "hello" },
                "tool_response": { "filePath": "/p/a.txt", "type": "create" },
            }),
        );
        assert_eq!(write.kind, HookKind::ToolEnd);
        assert_eq!(write.tool.unwrap().input_preview, "/p/a.txt");

        let failed = run(
            AgentName::Claude,
            "PostToolUseFailure",
            json!({
                "tool_name": "Bash",
                "tool_input": { "command": "false" },
                "error": "Exit code 1",
                "is_interrupt": false,
            }),
        );
        assert_eq!(failed.kind, HookKind::ToolEnd);
        assert!(failed.tool.unwrap().error);
    }

    #[test]
    fn claude_permission_request_exposes_tool_preview_and_suggestions() {
        let facts = run(
            AgentName::Claude,
            "PermissionRequest",
            json!({
                "hook_event_name": "PermissionRequest",
                "tool_name": "Bash",
                "tool_input": {
                    "command": "rm -rf node_modules",
                    "description": "Remove node_modules directory",
                },
                "permission_suggestions": [
                    {
                        "type": "addRules",
                        "rules": [{ "toolName": "Bash", "ruleContent": "rm -rf node_modules" }],
                        "behavior": "allow",
                        "destination": "localSettings",
                    },
                    { "type": "setMode", "mode": "acceptEdits", "destination": "session" },
                    { "type": "addDirectories", "directories": ["/a", "/b"], "destination": "projectSettings" },
                    "garbage",
                ],
            }),
        );
        assert_eq!(facts.kind, HookKind::PermissionRequest);
        assert!(facts.decision_capable);
        assert_eq!(
            facts.message.as_deref(),
            Some("Remove node_modules directory")
        );
        let permission = facts.permission.unwrap();
        assert_eq!(permission.tool, "Bash");
        assert_eq!(permission.input_preview, "rm -rf node_modules");
        assert_eq!(permission.request_id, None);
        let labels: Vec<_> = permission
            .suggestions
            .iter()
            .map(|s| s.label.as_str())
            .collect();
        assert_eq!(
            labels,
            [
                "Always allow Bash(rm -rf node_modules) in local settings",
                "Switch to acceptEdits mode for this session",
                "Allow access to /a, /b for this project",
                "Apply suggested permission update",
            ]
        );
    }

    #[test]
    fn claude_notifications_keep_their_type() {
        let facts = run(
            AgentName::Claude,
            "Notification",
            json!({
                "session_id": "s",
                "message": "Claude needs your permission to use Bash",
                "notification_type": "permission_prompt",
            }),
        );
        assert_eq!(facts.kind, HookKind::Notification);
        assert_eq!(
            facts.notification_type.as_deref(),
            Some("permission_prompt")
        );
        assert_eq!(
            facts.message.as_deref(),
            Some("Claude needs your permission to use Bash")
        );
        let titled = run(
            AgentName::Claude,
            "Notification",
            json!({ "title": "Heads up", "notification_type": "idle_prompt" }),
        );
        assert_eq!(titled.message.as_deref(), Some("Heads up"));
    }

    #[test]
    fn claude_subagent_events_track_identity_and_state() {
        let start = run(
            AgentName::Claude,
            "SubagentStart",
            json!({ "agent_id": "agent-7", "agent_type": "reviewer" }),
        );
        assert_eq!(
            start.subagent,
            Some(SubagentInfo {
                id: "agent-7".into(),
                agent_type: "reviewer".into(),
                state: SubagentState::Running,
            })
        );
        let stop = run(
            AgentName::Claude,
            "SubagentStop",
            json!({
                "agent_id": "agent-7",
                "agent_type": "reviewer",
                "agent_transcript_path": "/t.jsonl",
                "last_assistant_message": "No issues found.",
            }),
        );
        assert_eq!(stop.subagent.unwrap().state, SubagentState::Done);
        assert_eq!(stop.message.as_deref(), Some("No issues found."));

        let anonymous = run(AgentName::Claude, "SubagentStart", json!({}));
        assert_eq!(anonymous.subagent, None);
    }

    #[test]
    fn codex_events_use_the_shared_names_plus_interrupt() {
        let permission = run(
            AgentName::Codex,
            "PermissionRequest",
            json!({
                "session_id": "019a-uuid",
                "transcript_path": null,
                "cwd": "/repo",
                "hook_event_name": "PermissionRequest",
                "model": "gpt-5",
                "turn_id": "t1",
                "tool_name": "Bash",
                "tool_input": { "command": "git push", "description": null },
            }),
        );
        assert_eq!(permission.kind, HookKind::PermissionRequest);
        assert!(permission.decision_capable);
        assert_eq!(permission.transcript_path, None);
        assert_eq!(permission.permission.unwrap().input_preview, "git push");

        let argv = run(
            AgentName::Codex,
            "PreToolUse",
            json!({ "tool_name": "shell", "tool_input": { "command": ["bash", "-lc", "ls -la"] } }),
        );
        assert_eq!(argv.tool.unwrap().input_preview, "bash -lc ls -la");

        let stop = run(
            AgentName::Codex,
            "Stop",
            json!({ "turn_id": "t1", "stop_hook_active": false, "last_assistant_message": "ok" }),
        );
        assert_eq!(stop.kind, HookKind::Stop);
        assert_eq!(stop.message.as_deref(), Some("ok"));

        let interrupt = run(AgentName::Codex, "Interrupt", json!({ "turn_id": "t1" }));
        assert_eq!(interrupt.kind, HookKind::Interrupt);
        assert_eq!(
            normalize(AgentName::Claude, "Interrupt", &json!({})),
            Err(NormalizeError::UnsupportedEvent)
        );
    }

    #[test]
    fn gemini_events_map_before_after_names() {
        let prompt = run(
            AgentName::Gemini,
            "BeforeAgent",
            json!({ "session_id": "g1", "prompt": "list files", "timestamp": "2026-01-01T00:00:00Z" }),
        );
        assert_eq!(prompt.kind, HookKind::Prompt);
        assert_eq!(prompt.message.as_deref(), Some("list files"));

        let stop = run(
            AgentName::Gemini,
            "AfterAgent",
            json!({ "prompt": "list files", "prompt_response": "Here they are", "stop_hook_active": false }),
        );
        assert_eq!(stop.kind, HookKind::Stop);
        assert_eq!(stop.message.as_deref(), Some("Here they are"));

        let tool = run(
            AgentName::Gemini,
            "BeforeTool",
            json!({ "tool_name": "run_shell_command", "tool_input": { "command": "ls" } }),
        );
        assert_eq!(tool.kind, HookKind::ToolStart);
        assert_eq!(tool.tool.unwrap().input_preview, "ls");
        assert_eq!(
            run(AgentName::Gemini, "AfterTool", json!({ "tool_name": "x" })).kind,
            HookKind::ToolEnd
        );
        assert_eq!(
            normalize(AgentName::Gemini, "UserPromptSubmit", &json!({})),
            Err(NormalizeError::UnsupportedEvent)
        );
    }

    #[test]
    fn gemini_tool_permission_notifications_become_permission_requests() {
        let exec = run(
            AgentName::Gemini,
            "Notification",
            json!({
                "notification_type": "ToolPermission",
                "message": "Please approve",
                "details": { "type": "exec", "title": "Confirm Shell Command", "command": "rm -rf build", "rootCommand": "rm" },
            }),
        );
        assert_eq!(exec.kind, HookKind::PermissionRequest);
        assert!(!exec.decision_capable);
        let permission = exec.permission.unwrap();
        assert_eq!(permission.tool, "shell");
        assert_eq!(permission.input_preview, "rm -rf build");

        let mcp = run(
            AgentName::Gemini,
            "Notification",
            json!({
                "notification_type": "ToolPermission",
                "details": { "type": "mcp", "serverName": "gh", "toolName": "create_issue", "title": "Confirm MCP" },
            }),
        );
        let permission = mcp.permission.unwrap();
        assert_eq!(permission.tool, "create_issue");
        assert_eq!(permission.input_preview, "Confirm MCP");

        let plain = run(
            AgentName::Gemini,
            "Notification",
            json!({ "notification_type": "Other", "message": "fyi" }),
        );
        assert_eq!(plain.kind, HookKind::Notification);
    }

    #[test]
    fn pi_extension_payloads_reuse_the_claude_shape() {
        let tool = run(
            AgentName::Pi,
            "PostToolUse",
            json!({
                "session_id": "pi-1",
                "transcript_path": "/home/me/.pi/agent/sessions/x.jsonl",
                "cwd": "/repo",
                "tool_name": "bash",
                "tool_use_id": "call_1",
                "tool_input": { "command": "make" },
                "is_error": true,
            }),
        );
        assert_eq!(tool.kind, HookKind::ToolEnd);
        let info = tool.tool.unwrap();
        assert!(info.error);
        assert_eq!(info.input_preview, "make");

        let stop = run(
            AgentName::Pi,
            "Stop",
            json!({ "session_id": "pi-1", "aborted": true, "last_assistant_message": "stopped" }),
        );
        assert_eq!(stop.reason.as_deref(), Some("aborted"));
        assert!(
            !run(
                AgentName::Pi,
                "PermissionRequest",
                json!({ "tool_name": "bash" })
            )
            .decision_capable
        );
    }

    #[test]
    fn unknown_events_are_unsupported_not_errors_in_the_payload() {
        for event in ["PreCompact", "PostCompact", "TaskCreated", "Setup", ""] {
            assert_eq!(
                normalize(AgentName::Claude, event, &json!({})),
                Err(NormalizeError::UnsupportedEvent),
                "{event}"
            );
        }
    }

    #[test]
    fn malformed_payloads_degrade_to_bare_facts() {
        for payload in [Value::Null, json!("text"), json!([1, 2]), json!(42)] {
            let facts = run(AgentName::Claude, "Stop", payload);
            assert_eq!(facts, HookFacts::new(HookKind::Stop));
        }
        let wrong_types = run(
            AgentName::Claude,
            "PreToolUse",
            json!({ "session_id": 5, "cwd": {}, "tool_name": ["Bash"], "tool_input": 3 }),
        );
        assert_eq!(wrong_types.session_id, None);
        assert_eq!(wrong_types.cwd, None);
        assert_eq!(wrong_types.tool, None);
    }

    #[test]
    fn untrusted_strings_are_validated_and_bounded() {
        let facts = run(
            AgentName::Claude,
            "Notification",
            json!({
                "session_id": "bad id with spaces",
                "transcript_path": "/p/\u{1b}[31m",
                "cwd": "x".repeat(MAX_PATH + 1),
                "message": format!("a\u{1b}[2Jb{}", "m".repeat(10_000)),
            }),
        );
        assert_eq!(facts.session_id, None);
        assert_eq!(facts.transcript_path, None);
        assert_eq!(facts.cwd, None);
        let message = facts.message.unwrap();
        assert!(!message.contains('\u{1b}'));
        assert!(message.len() <= MAX_MESSAGE + 3);

        let long_id = run(
            AgentName::Claude,
            "SessionStart",
            json!({ "session_id": "a".repeat(MAX_SESSION_ID + 1) }),
        );
        assert_eq!(long_id.session_id, None);
    }

    #[test]
    fn previews_fall_back_to_compact_json_and_stay_bounded() {
        let facts = run(
            AgentName::Claude,
            "PreToolUse",
            json!({ "tool_name": "Custom", "tool_input": { "a": 1, "b": [true] } }),
        );
        assert_eq!(facts.tool.unwrap().input_preview, r#"{"a":1,"b":[true]}"#);

        let long = run(
            AgentName::Claude,
            "PreToolUse",
            json!({ "tool_name": "Bash", "tool_input": { "command": "c".repeat(10_000) } }),
        );
        assert!(long.tool.unwrap().input_preview.len() <= MAX_PREVIEW + 3);

        let none = run(
            AgentName::Claude,
            "PreToolUse",
            json!({ "tool_name": "Bash" }),
        );
        assert_eq!(none.tool.unwrap().input_preview, "");
    }
}
