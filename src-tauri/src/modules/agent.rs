use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use super::agent_json;

/// How an agent's config describes a hook, and which shell runs it on Windows.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Style {
    Claude,
    Codex,
    Gemini,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Dialect {
    Posix,
    Cmd,
    PowerShell,
}

struct EventSpec {
    event: &'static str,
    /// Seconds; Gemini's millisecond field is derived from it.
    timeout: Option<u32>,
    /// Observe-only events that never need to delay the agent.
    background: bool,
    /// Installed when true; a Terax group for an unwanted event is removed.
    wanted: bool,
}

const fn event(event: &'static str) -> EventSpec {
    EventSpec {
        event,
        timeout: None,
        background: false,
        wanted: true,
    }
}

const fn background(event: &'static str) -> EventSpec {
    EventSpec {
        event,
        timeout: None,
        background: true,
        wanted: true,
    }
}

const fn timed(event: &'static str, timeout: u32) -> EventSpec {
    EventSpec {
        event,
        timeout: Some(timeout),
        background: false,
        wanted: true,
    }
}

impl EventSpec {
    /// Supported by the adapters but not installed until something consumes it.
    const fn off(mut self) -> Self {
        self.wanted = false;
        self
    }
}

struct AgentSpec {
    agent: &'static str,
    dir: &'static str,
    file: &'static str,
    style: Style,
    events: &'static [EventSpec],
}

/// Longer than the CLI's default decision wait, so Terax answers first.
const DECISION_HOOK_TIMEOUT: u32 = 660;

const AGENTS: &[AgentSpec] = &[
    AgentSpec {
        agent: "claude",
        dir: ".claude",
        file: "settings.json",
        style: Style::Claude,
        events: &[
            event("SessionStart"),
            event("UserPromptSubmit"),
            background("PreToolUse").off(),
            timed("PermissionRequest", DECISION_HOOK_TIMEOUT),
            background("PostToolUse").off(),
            background("PostToolUseFailure").off(),
            event("Notification"),
            event("Stop"),
            event("StopFailure").off(),
            event("SubagentStart").off(),
            event("SubagentStop").off(),
            timed("SessionEnd", 5),
        ],
    },
    AgentSpec {
        agent: "codex",
        dir: ".codex",
        file: "hooks.json",
        style: Style::Codex,
        events: &[
            event("SessionStart"),
            event("UserPromptSubmit"),
            background("PreToolUse").off(),
            timed("PermissionRequest", DECISION_HOOK_TIMEOUT),
            background("PostToolUse").off(),
            event("Stop"),
        ],
    },
    AgentSpec {
        agent: "gemini",
        dir: ".gemini",
        file: "settings.json",
        style: Style::Gemini,
        events: &[
            event("SessionStart"),
            event("BeforeAgent"),
            event("BeforeTool").off(),
            event("AfterTool").off(),
            event("Notification"),
            event("AfterAgent"),
            event("SessionEnd"),
        ],
    },
];

const PI_EXTENSION_DIR: &str = ".pi/agent/extensions";
const PI_EXTENSION_FILE: &str = "terax-notifications.ts";
const PI_EXTENSION_FAMILY: &str = "terax-pi-notifications-v";
struct PiHook {
    pi_event: &'static str,
    hook: &'static str,
    /// JavaScript object literal of payload fields, from the Pi event `e`.
    fields: &'static str,
    wanted: bool,
}

const PI_HOOKS: &[PiHook] = &[
    PiHook {
        pi_event: "session_start",
        hook: "SessionStart",
        fields: "{ source: e.reason }",
        wanted: true,
    },
    PiHook {
        pi_event: "before_agent_start",
        hook: "UserPromptSubmit",
        fields: "{ prompt: e.prompt }",
        wanted: true,
    },
    PiHook {
        pi_event: "tool_execution_start",
        hook: "PreToolUse",
        fields: "{ tool_name: e.toolName, tool_use_id: e.toolCallId, tool_input: e.args }",
        wanted: false,
    },
    PiHook {
        pi_event: "tool_execution_end",
        hook: "PostToolUse",
        fields: "{ tool_name: e.toolName, tool_use_id: e.toolCallId, is_error: e.isError }",
        wanted: false,
    },
    PiHook {
        pi_event: "agent_settled",
        hook: "Stop",
        fields: "{ aborted: e.aborted, last_assistant_message: takeMessage() }",
        wanted: true,
    },
    PiHook {
        pi_event: "session_shutdown",
        hook: "SessionEnd",
        fields: "{ reason: e.reason }",
        wanted: true,
    },
];

const PI_HEAD: &str = r#"// terax-pi-notifications-v2
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const cli = process.env.TERAX_CLI;
  if (!cli || !process.env.TERAX_PANE_ID) return;

  const attempt = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };

  const send = (event: string, ctx: any, extra: Record<string, unknown> = {}) => {
    attempt(() => {
      const child = spawn(cli, ["hook", "pi", event], {
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      });
      child.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(
        JSON.stringify({
          session_id: attempt(() => ctx.sessionManager.getSessionId()),
          transcript_path: attempt(() => ctx.sessionManager.getSessionFile()),
          cwd: ctx.cwd,
          ...extra,
        }),
      );
    });
  };

  let lastMessage: string | undefined;
  const takeMessage = () => {
    const text = lastMessage;
    lastMessage = undefined;
    return text;
  };

  pi.on("message_end", (e: any) => {
    const message = e.message;
    if (message?.role !== "assistant") return;
    const text = attempt(() =>
      (Array.isArray(message.content) ? message.content : [])
        .filter((part: any) => part?.type === "text")
        .map((part: any) => part.text)
        .join(""),
    );
    if (text) lastMessage = text;
  });

"#;

/// The Pi extension: one handler per wanted entry of `PI_HOOKS`.
fn pi_extension() -> String {
    let mut out = String::from(PI_HEAD);
    for hook in PI_HOOKS.iter().filter(|hook| hook.wanted) {
        out.push_str(&format!(
            "  pi.on(\"{}\", (e: any, ctx: any) => send(\"{}\", ctx, {}));\n",
            hook.pi_event, hook.hook, hook.fields
        ));
    }
    out.push_str("}\n");
    out
}

/// Hook commands that older Terax versions wrote (OSC markers, a CONOUT$
/// helper); recognised so an install migrates them.
const LEGACY_MARKERS: [&str; 3] = ["notify;Terax;", "terax;notify", "__terax_notify"];

fn find(agent: &str) -> Result<&'static AgentSpec, String> {
    AGENTS
        .iter()
        .find(|s| s.agent == agent)
        .ok_or_else(|| format!("unknown agent {agent}"))
}

fn shell_for(style: Style, windows: bool) -> Dialect {
    match (style, windows) {
        (_, false) => Dialect::Posix,
        (Style::Claude, true) => Dialect::PowerShell,
        (Style::Codex | Style::Gemini, true) => Dialect::Cmd,
    }
}

/// Runs the CLI Terax exposes through `TERAX_CLI`, and prints an empty JSON
/// object where there is none (outside Terax, or a stale path) because some
/// agents reject an empty stdout. No user data is interpolated.
fn hook_command(dialect: Dialect, agent: &str, event: &str) -> String {
    match dialect {
        Dialect::Posix => {
            format!(r#"[ -n "$TERAX_CLI" ] && "$TERAX_CLI" hook {agent} {event} || printf '{{}}'"#)
        }
        Dialect::Cmd => {
            format!(r#"if defined TERAX_CLI ("%TERAX_CLI%" hook {agent} {event}) else (echo {{}})"#)
        }
        Dialect::PowerShell => format!(
            r#"if ($env:TERAX_CLI) {{ & $env:TERAX_CLI hook {agent} {event} }} else {{ '{{}}' }}"#
        ),
    }
}

fn hook_group(spec: &AgentSpec, event: &EventSpec, windows: bool) -> Value {
    let command = hook_command(shell_for(spec.style, windows), spec.agent, event.event);
    let mut hook = json!({ "type": "command", "command": command });
    match spec.style {
        Style::Claude => {
            if windows {
                hook["shell"] = json!("powershell");
            }
            if let Some(timeout) = event.timeout {
                hook["timeout"] = json!(timeout);
            }
            if event.background {
                hook["async"] = json!(true);
            }
        }
        Style::Codex => {
            if windows {
                hook["commandWindows"] = hook["command"].clone();
            }
            if let Some(timeout) = event.timeout {
                hook["timeout"] = json!(timeout);
            }
            // Codex starts each hook through the login shell, which is too
            // slow to sit in front of every tool call.
            if event.background {
                hook["async"] = json!(true);
            }
        }
        Style::Gemini => {
            hook["name"] = json!("terax");
            if let Some(timeout) = event.timeout {
                hook["timeout"] = json!(u64::from(timeout) * 1000);
            }
        }
    }
    let mut group = json!({ "hooks": [hook] });
    if spec.style == Style::Gemini {
        group["matcher"] = json!("*");
    }
    group
}

fn command_is_ours(command: &str) -> bool {
    LEGACY_MARKERS.iter().any(|marker| command.contains(marker))
        || (command.contains("TERAX_CLI") && command.contains(" hook "))
}

/// A matcher group is ours when it exists only to run Terax commands, so a
/// group the user added their own commands to is never taken apart.
fn group_is_ours(group: &Value) -> bool {
    let Some(hooks) = group.get("hooks").and_then(Value::as_array) else {
        return false;
    };
    !hooks.is_empty()
        && hooks.iter().all(|hook| {
            hook.get("command")
                .and_then(Value::as_str)
                .is_some_and(command_is_ours)
        })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Action {
    Install,
    Uninstall,
}

impl Action {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "install" => Ok(Self::Install),
            "uninstall" => Ok(Self::Uninstall),
            other => Err(format!("unknown action {other}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Uninstall => "uninstall",
        }
    }
}

fn blank(contents: Option<&str>) -> bool {
    contents.is_none_or(|text| text.trim().is_empty())
}

/// The config text after the action; `None` when the file would not exist.
fn json_after(
    spec: &AgentSpec,
    existing: Option<&str>,
    action: Action,
    windows: bool,
    path: &Path,
) -> Result<Option<String>, String> {
    if let Some(text) = existing.filter(|text| !text.trim().is_empty()) {
        agent_json::validate(text).map_err(|error| {
            format!(
                "{} is not valid JSON ({error}); refusing to edit",
                path.display()
            )
        })?;
    }
    let mut text = existing.filter(|_| !blank(existing)).map(str::to_string);
    match action {
        Action::Install => {
            let created = text.is_none();
            let mut current = text.take().unwrap_or_else(|| "{}".to_string());
            for event in spec.events {
                let edited = if event.wanted {
                    let group = hook_group(spec, event, windows);
                    agent_json::upsert(&current, &["hooks", event.event], &group, &group_is_ours)
                } else {
                    agent_json::remove_matching(&current, &["hooks", event.event], &group_is_ours)
                };
                current = edited.map_err(|error| format!("{}: {error}", path.display()))?;
            }
            if created {
                current.push('\n');
            }
            Ok(Some(current))
        }
        Action::Uninstall => {
            let Some(mut current) = text else {
                return Ok(existing.map(str::to_string));
            };
            for event in spec.events {
                current =
                    agent_json::remove_matching(&current, &["hooks", event.event], &group_is_ours)
                        .map_err(|error| format!("{}: {error}", path.display()))?;
            }
            Ok(Some(current))
        }
    }
}

fn pi_after(existing: Option<&str>, action: Action, path: &Path) -> Result<Option<String>, String> {
    let foreign =
        existing.is_some_and(|text| !text.trim().is_empty() && !text.contains(PI_EXTENSION_FAMILY));
    match action {
        Action::Install if foreign => Err(format!(
            "{} is not managed by Terax; refusing to overwrite",
            path.display()
        )),
        Action::Install => Ok(Some(pi_extension())),
        Action::Uninstall if foreign => Ok(existing.map(str::to_string)),
        Action::Uninstall => Ok(None),
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HooksPlan {
    pub agent: String,
    pub action: String,
    pub path: String,
    /// File contents now; `None` when the file does not exist.
    pub before: Option<String>,
    /// File contents after applying; `None` when the file would be removed.
    pub after: Option<String>,
    pub changed: bool,
}

fn home_path(dir: &str, file: &str) -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(dir)
        .join(file))
}

fn config_path(agent: &str) -> Result<PathBuf, String> {
    if agent == "pi" {
        return home_path(PI_EXTENSION_DIR, PI_EXTENSION_FILE);
    }
    let spec = find(agent)?;
    home_path(spec.dir, spec.file)
}

fn read_existing(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

fn plan_at(
    agent: &str,
    action: Action,
    path: &Path,
    existing: Option<String>,
    windows: bool,
) -> Result<HooksPlan, String> {
    let after = if agent == "pi" {
        pi_after(existing.as_deref(), action, path)?
    } else {
        json_after(find(agent)?, existing.as_deref(), action, windows, path)?
    };
    let changed = after != existing;
    Ok(HooksPlan {
        agent: agent.to_string(),
        action: action.as_str().to_string(),
        path: path.display().to_string(),
        before: existing,
        after,
        changed,
    })
}

fn plan(agent: &str, action: Action) -> Result<HooksPlan, String> {
    let path = config_path(agent)?;
    let existing = read_existing(&path)?;
    plan_at(agent, action, &path, existing, cfg!(windows))
}

/// Writes through a symlink instead of replacing it (dotfile managers link
/// these files), and keeps the permissions the user chose.
fn write_target(path: &Path) -> Result<PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            std::fs::canonicalize(path).map_err(|e| format!("resolve {}: {e}", path.display()))
        }
        Ok(_) => Ok(path.to_path_buf()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(e) => Err(format!("inspect {}: {e}", path.display())),
    }
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let target = write_target(path)?;
    let dir = target
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", target.display()))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{name}.terax-tmp"));
    std::fs::write(&tmp, contents).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    if let Ok(metadata) = std::fs::metadata(&target) {
        let _ = std::fs::set_permissions(&tmp, metadata.permissions());
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", target.display())
    })
}

fn apply_plan(plan: &HooksPlan) -> Result<(), String> {
    let path = PathBuf::from(&plan.path);
    if read_existing(&path)? != plan.before {
        return Err(format!(
            "{} changed since the preview; review the new diff first",
            path.display()
        ));
    }
    if !plan.changed {
        return Ok(());
    }
    match &plan.after {
        Some(contents) => write_atomic(&path, contents),
        None => {
            let target = write_target(&path)?;
            std::fs::remove_file(&target).map_err(|e| format!("remove {}: {e}", target.display()))
        }
    }
}

fn run_action(agent: &str, action: Action) -> Result<(), String> {
    apply_plan(&plan(agent, action)?)
}

#[tauri::command]
pub async fn agent_enable_hooks(agent: String) -> Result<(), String> {
    super::fs::blocking(move || run_action(&agent, Action::Install)).await
}

#[tauri::command]
pub async fn agent_disable_hooks(agent: String) -> Result<(), String> {
    super::fs::blocking(move || run_action(&agent, Action::Uninstall)).await
}

/// What installing or removing would change, for a diff preview.
#[tauri::command]
pub async fn agent_hooks_plan(agent: String, action: String) -> Result<HooksPlan, String> {
    let action = Action::parse(&action)?;
    super::fs::blocking(move || plan(&agent, action)).await
}

/// Applies a previewed plan; refused when the file changed after the preview.
#[tauri::command]
pub async fn agent_hooks_apply(
    agent: String,
    action: String,
    before: Option<String>,
) -> Result<(), String> {
    let action = Action::parse(&action)?;
    super::fs::blocking(move || {
        let current = plan(&agent, action)?;
        if current.before != before {
            return Err(format!(
                "{} changed since the preview; review the new diff first",
                current.path
            ));
        }
        apply_plan(&current)
    })
    .await
}

#[tauri::command]
pub async fn agent_hooks_status(agent: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || hooks_status(&agent))
        .await
        .unwrap_or(false)
}

/// True when every hook Terax installs is present and current.
fn hooks_status(agent: &str) -> bool {
    plan(agent, Action::Install).is_ok_and(|plan| !plan.changed)
}

// The raw OSC 777 bytes older hooks emitted. Kept so an old Windows hook
// config still pointing at `__terax_notify` keeps working until it is migrated.
#[cfg(any(windows, test))]
fn conout_marker(agent: &str, event: &str) -> String {
    format!("\x1b]777;notify;Terax;{agent};{event}\x07")
}

#[cfg(windows)]
pub fn emit_conout_marker(agent: &str, event: &str) {
    use std::io::Write;
    use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};

    if std::env::var_os("TERAX_TERMINAL").is_none() {
        return;
    }
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("CONOUT$")
    {
        let _ = f.write_all(conout_marker(agent, event).as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(agent: &str) -> &'static AgentSpec {
        find(agent).unwrap()
    }

    fn path() -> PathBuf {
        PathBuf::from("/home/me/.agent/config.json")
    }

    fn install(agent: &str, existing: Option<&str>, windows: bool) -> String {
        json_after(spec(agent), existing, Action::Install, windows, &path())
            .unwrap()
            .unwrap()
    }

    fn parsed(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    fn commands(root: &Value, event: &str) -> Vec<String> {
        root["hooks"][event]
            .as_array()
            .map(|groups| {
                groups
                    .iter()
                    .flat_map(|group| group["hooks"].as_array().cloned().unwrap_or_default())
                    .filter_map(|hook| hook["command"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn commands_resolve_the_cli_through_the_environment_for_every_shell() {
        assert_eq!(
            hook_command(Dialect::Posix, "codex", "Stop"),
            r#"[ -n "$TERAX_CLI" ] && "$TERAX_CLI" hook codex Stop || printf '{}'"#
        );
        assert_eq!(
            hook_command(Dialect::Cmd, "gemini", "AfterAgent"),
            r#"if defined TERAX_CLI ("%TERAX_CLI%" hook gemini AfterAgent) else (echo {})"#
        );
        assert_eq!(
            hook_command(Dialect::PowerShell, "claude", "Stop"),
            r#"if ($env:TERAX_CLI) { & $env:TERAX_CLI hook claude Stop } else { '{}' }"#
        );
    }

    #[test]
    fn no_command_embeds_a_path_or_interpolated_input() {
        for agent in AGENTS {
            for windows in [false, true] {
                for event in agent.events {
                    let group = hook_group(agent, event, windows);
                    let command = group["hooks"][0]["command"].as_str().unwrap();
                    assert!(command.contains("TERAX_CLI"), "{command}");
                    assert!(
                        command.chars().all(
                            |c| c.is_ascii_alphanumeric() || " \"$%{}()[]&|'-=_:\\".contains(c)
                        ),
                        "{command}"
                    );
                    assert!(group_is_ours(&group));
                }
            }
        }
    }

    fn wanted(agent: &str) -> Vec<&'static str> {
        spec(agent)
            .events
            .iter()
            .filter(|event| event.wanted)
            .map(|event| event.event)
            .collect()
    }

    #[test]
    fn claude_installs_only_the_lifecycle_events_with_platform_shells() {
        assert_eq!(
            wanted("claude"),
            [
                "SessionStart",
                "UserPromptSubmit",
                "PermissionRequest",
                "Notification",
                "Stop",
                "SessionEnd"
            ]
        );
        let unix = parsed(&install("claude", None, false));
        let mut keys: Vec<_> = unix["hooks"].as_object().unwrap().keys().cloned().collect();
        keys.sort();
        let mut expected = wanted("claude");
        expected.sort();
        assert_eq!(keys, expected);
        for event in wanted("claude") {
            assert_eq!(commands(&unix, event).len(), 1, "{event}");
        }
        let hook = &unix["hooks"]["PermissionRequest"][0]["hooks"][0];
        assert_eq!(hook["timeout"], DECISION_HOOK_TIMEOUT);
        assert!(hook.get("async").is_none());
        assert!(hook.get("shell").is_none());
        assert_eq!(unix["hooks"]["SessionEnd"][0]["hooks"][0]["timeout"], 5);
        assert!(commands(&unix, "Stop")[0].starts_with("[ -n \"$TERAX_CLI\" ]"));

        let windows = parsed(&install("claude", None, true));
        let hook = &windows["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(hook["shell"], "powershell");
        assert!(hook["command"]
            .as_str()
            .unwrap()
            .starts_with("if ($env:TERAX_CLI)"));
    }

    #[test]
    fn codex_installs_the_lifecycle_events_with_a_windows_override() {
        assert_eq!(
            wanted("codex"),
            [
                "SessionStart",
                "UserPromptSubmit",
                "PermissionRequest",
                "Stop"
            ]
        );
        let unix = parsed(&install("codex", None, false));
        assert_eq!(unix["hooks"].as_object().unwrap().len(), 4);
        for event in wanted("codex") {
            assert_eq!(commands(&unix, event).len(), 1, "{event}");
        }
        assert!(unix["hooks"]["Stop"][0]["hooks"][0]
            .get("commandWindows")
            .is_none());
        for event in wanted("codex") {
            assert!(unix["hooks"][event][0]["hooks"][0].get("async").is_none());
        }
        let windows = parsed(&install("codex", None, true));
        let hook = &windows["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(hook["commandWindows"], hook["command"]);
        assert!(hook["command"]
            .as_str()
            .unwrap()
            .starts_with("if defined TERAX_CLI"));
    }

    #[test]
    fn background_events_are_marked_async_for_the_agents_that_support_it() {
        let tool = background("PreToolUse");
        assert_eq!(
            hook_group(spec("claude"), &tool, false)["hooks"][0]["async"],
            true
        );
        assert_eq!(
            hook_group(spec("codex"), &tool, false)["hooks"][0]["async"],
            true
        );
        assert!(hook_group(spec("gemini"), &tool, false)["hooks"][0]
            .get("async")
            .is_none());
    }

    #[test]
    fn gemini_uses_matchers_names_and_cmd_on_windows() {
        assert_eq!(
            wanted("gemini"),
            [
                "SessionStart",
                "BeforeAgent",
                "Notification",
                "AfterAgent",
                "SessionEnd"
            ]
        );
        let unix = parsed(&install("gemini", None, false));
        assert_eq!(unix["hooks"].as_object().unwrap().len(), 5);
        assert_eq!(unix["hooks"]["BeforeAgent"][0]["matcher"], "*");
        assert_eq!(unix["hooks"]["AfterAgent"][0]["hooks"][0]["name"], "terax");
        assert!(commands(&unix, "AfterAgent")[0].contains("hook gemini AfterAgent"));
        let windows = parsed(&install("gemini", None, true));
        assert!(commands(&windows, "Notification")[0].starts_with("if defined TERAX_CLI"));
    }

    #[test]
    fn no_per_tool_call_hook_is_installed_for_any_agent() {
        const TOOL_LEVEL: [&str; 5] = [
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "BeforeTool",
            "AfterTool",
        ];
        for agent in AGENTS {
            for event in agent.events {
                if TOOL_LEVEL.contains(&event.event) {
                    assert!(!event.wanted, "{} {}", agent.agent, event.event);
                }
            }
            for windows in [false, true] {
                let text = install(agent.agent, None, windows);
                for event in TOOL_LEVEL {
                    assert!(!text.contains(event), "{} {event}", agent.agent);
                }
            }
        }
        let extension = pi_extension();
        assert!(!extension.contains("tool_execution"));
        assert!(!extension.contains("PreToolUse"));
        assert!(!extension.contains("PostToolUse"));
    }

    fn with_every_event_installed(agent: &str, windows: bool, base: &str) -> String {
        let spec = spec(agent);
        let mut text = base.to_string();
        for event in spec.events {
            let group = hook_group(spec, event, windows);
            text =
                agent_json::upsert(&text, &["hooks", event.event], &group, &group_is_ours).unwrap();
        }
        text
    }

    #[test]
    fn install_reconciles_away_stale_groups_it_no_longer_wants() {
        for agent in ["claude", "codex", "gemini"] {
            for windows in [false, true] {
                let user = "{\n  \"hooks\": {\n    \"PreToolUse\": [\n      { \"hooks\": [ { \"type\": \"command\", \"command\": \"audit\" } ] }\n    ],\n    \"BeforeTool\": [\n      { \"hooks\": [ { \"type\": \"command\", \"command\": \"audit\" } ] }\n    ]\n  }\n}\n";
                let bloated = with_every_event_installed(agent, windows, user);
                let reconciled = install(agent, Some(&bloated), windows);
                let value = parsed(&reconciled);
                let hooks = value["hooks"].as_object().unwrap();
                for event in spec(agent).events {
                    let ours = commands(&value, event.event)
                        .iter()
                        .filter(|command| {
                            command.contains("TERAX_CLI") || command.contains("hook ")
                        })
                        .count();
                    assert_eq!(ours, usize::from(event.wanted), "{agent} {}", event.event);
                    if !event.wanted && !["PreToolUse", "BeforeTool"].contains(&event.event) {
                        assert!(!hooks.contains_key(event.event), "{agent} {}", event.event);
                    }
                }
                for key in ["PreToolUse", "BeforeTool"] {
                    if spec(agent).events.iter().any(|event| event.event == key) {
                        assert_eq!(commands(&value, key), ["audit"], "{agent} {key}");
                    }
                }
                assert_eq!(install(agent, Some(&reconciled), windows), reconciled);
                let fresh = install(agent, Some(user), windows);
                assert_eq!(
                    parsed(&reconciled),
                    parsed(&fresh),
                    "{agent} windows={windows}"
                );
                assert!(
                    !plan_at(
                        agent,
                        Action::Install,
                        &path(),
                        Some(reconciled.clone()),
                        windows
                    )
                    .unwrap()
                    .changed
                );
            }
        }
    }

    #[test]
    fn installed_hook_definitions_are_byte_stable_across_versions() {
        let group = |agent: &str, event: &str, windows: bool| {
            let spec = spec(agent);
            let event = spec.events.iter().find(|e| e.event == event).unwrap();
            hook_group(spec, event, windows)
        };
        let posix = |agent: &str, event: &str| {
            format!(r#"[ -n "$TERAX_CLI" ] && "$TERAX_CLI" hook {agent} {event} || printf '{{}}'"#)
        };
        let cmd = |agent: &str, event: &str| {
            format!(r#"if defined TERAX_CLI ("%TERAX_CLI%" hook {agent} {event}) else (echo {{}})"#)
        };

        assert_eq!(
            group("codex", "Stop", false),
            json!({ "hooks": [{ "type": "command", "command": posix("codex", "Stop") }] })
        );
        assert_eq!(
            group("codex", "PermissionRequest", false),
            json!({ "hooks": [{
                "type": "command",
                "command": posix("codex", "PermissionRequest"),
                "timeout": 660
            }] })
        );
        for event in ["SessionStart", "UserPromptSubmit"] {
            assert_eq!(
                group("codex", event, false),
                json!({ "hooks": [{ "type": "command", "command": posix("codex", event) }] }),
                "{event}"
            );
        }
        assert_eq!(
            group("codex", "Stop", true),
            json!({ "hooks": [{
                "type": "command",
                "command": cmd("codex", "Stop"),
                "commandWindows": cmd("codex", "Stop")
            }] })
        );
        assert_eq!(
            group("claude", "PermissionRequest", false),
            json!({ "hooks": [{
                "type": "command",
                "command": posix("claude", "PermissionRequest"),
                "timeout": 660
            }] })
        );
        assert_eq!(
            group("claude", "Stop", true),
            json!({ "hooks": [{
                "type": "command",
                "command": r#"if ($env:TERAX_CLI) { & $env:TERAX_CLI hook claude Stop } else { '{}' }"#,
                "shell": "powershell"
            }] })
        );
        assert_eq!(
            group("gemini", "AfterAgent", false),
            json!({
                "matcher": "*",
                "hooks": [{ "type": "command", "name": "terax", "command": posix("gemini", "AfterAgent") }]
            })
        );
    }

    #[test]
    fn install_is_idempotent_per_agent_and_platform() {
        for agent in ["claude", "codex", "gemini"] {
            for windows in [false, true] {
                let once = install(agent, None, windows);
                let twice = install(agent, Some(&once), windows);
                assert_eq!(once, twice, "{agent} windows={windows}");
                assert!(once.ends_with("}\n"));
            }
        }
    }

    #[test]
    fn user_configuration_is_preserved_byte_for_byte() {
        let original = "{\n    // my tweaks\n    \"permissions\": { \"allow\": [\"Bash(ls)\"] },\n    \"hooks\": {\n        \"Notification\": [\n            { \"hooks\": [ { \"type\": \"command\", \"command\": \"say hi\" } ] }\n        ]\n    },\n    \"model\": \"opus\"\n}\n";
        let out = install("claude", Some(original), false);
        assert!(
            out.contains("    // my tweaks\n    \"permissions\": { \"allow\": [\"Bash(ls)\"] },\n")
        );
        assert!(
            out.contains("{ \"hooks\": [ { \"type\": \"command\", \"command\": \"say hi\" } ] }")
        );
        assert!(out.contains("\"model\": \"opus\"\n}\n"));
        let value = parsed(&agent_json_strip(&out));
        let notification = commands(&value, "Notification");
        assert_eq!(notification[0], "say hi");
        assert_eq!(notification.len(), 2);

        let removed = json_after(
            spec("claude"),
            Some(&out),
            Action::Uninstall,
            false,
            &path(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(removed, original);
    }

    fn agent_json_strip(text: &str) -> String {
        text.lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn legacy_hooks_are_migrated_not_duplicated() {
        let legacy = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [ { "type": "command", "command": "[ -n \"$TERAX_TERMINAL\" ] && printf '{\"terminalSequence\":\"\\u001b]777;notify;Terax;attention\\u0007\"}' || true" } ] }
                ],
                "Stop": [
                    { "hooks": [ { "type": "command", "command": "\"C:\\\\Terax\\\\terax.exe\" __terax_notify claude finished" } ] },
                    { "hooks": [ { "type": "command", "command": "mine" } ] }
                ]
            }
        });
        let out = parsed(&install("claude", Some(&legacy.to_string()), false));
        assert_eq!(commands(&out, "Notification").len(), 1);
        assert!(commands(&out, "Notification")[0].contains("TERAX_CLI"));
        let stop = commands(&out, "Stop");
        assert_eq!(stop.len(), 2);
        assert!(stop.contains(&"mine".to_string()));
        assert!(stop
            .iter()
            .all(|command| !command.contains("__terax_notify")));
    }

    #[test]
    fn a_group_shared_with_user_commands_is_left_alone() {
        let mixed = json!({ "hooks": [
            { "type": "command", "command": "mine" },
            { "type": "command", "command": hook_command(Dialect::Posix, "claude", "Stop") }
        ] });
        assert!(!group_is_ours(&mixed));
        assert!(!group_is_ours(&json!({ "hooks": [] })));
        assert!(!group_is_ours(&json!({})));
    }

    #[test]
    fn invalid_or_unexpected_configs_are_refused() {
        let error = json_after(
            spec("claude"),
            Some("{ not json,"),
            Action::Install,
            false,
            &path(),
        )
        .unwrap_err();
        assert!(error.contains("refusing to edit"));
        for bad in [
            "[]",
            "\"x\"",
            "{\"hooks\": []}",
            "{\"hooks\": {\"Stop\": 1}}",
        ] {
            assert!(
                json_after(spec("claude"), Some(bad), Action::Install, false, &path()).is_err(),
                "{bad}"
            );
        }
        let blank = install("claude", Some("  \n"), false);
        assert!(parsed(&blank)["hooks"]["Stop"].is_array());
    }

    #[test]
    fn uninstall_removes_everything_it_installed_and_nothing_else() {
        for agent in ["claude", "codex", "gemini"] {
            let installed = install(agent, Some("{\n  \"keep\": true\n}\n"), false);
            let removed = json_after(
                spec(agent),
                Some(&installed),
                Action::Uninstall,
                false,
                &path(),
            )
            .unwrap()
            .unwrap();
            assert_eq!(parsed(&removed), json!({ "keep": true }), "{agent}");
        }
        assert_eq!(
            json_after(spec("claude"), None, Action::Uninstall, false, &path()).unwrap(),
            None
        );
    }

    #[test]
    fn plans_describe_the_before_and_after_for_a_diff() {
        let path = PathBuf::from("/nowhere/settings.json");
        let fresh = plan_at("claude", Action::Install, &path, None, false).unwrap();
        assert!(fresh.changed);
        assert_eq!(fresh.before, None);
        assert!(fresh.after.as_deref().unwrap().contains("TERAX_CLI"));

        let again = plan_at("claude", Action::Install, &path, fresh.after.clone(), false).unwrap();
        assert!(!again.changed);

        let remove = plan_at(
            "claude",
            Action::Uninstall,
            &path,
            fresh.after.clone(),
            false,
        )
        .unwrap();
        assert!(remove.changed);
        assert_eq!(parsed(remove.after.as_deref().unwrap()), json!({}));

        let value = serde_json::to_value(&fresh).unwrap();
        assert_eq!(value["action"], "install");
        assert!(value["changed"].as_bool().unwrap());
    }

    #[test]
    fn applying_a_plan_writes_atomically_and_detects_concurrent_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".agent").join("settings.json");
        let first = plan_at("claude", Action::Install, &path, None, false).unwrap();
        apply_plan(&first).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            first.after.clone().unwrap()
        );

        // Second apply of the stale plan: the file is no longer absent.
        assert!(apply_plan(&first)
            .unwrap_err()
            .contains("changed since the preview"));

        let noop = plan_at(
            "claude",
            Action::Install,
            &path,
            read_existing(&path).unwrap(),
            false,
        )
        .unwrap();
        assert!(!noop.changed);
        apply_plan(&noop).unwrap();

        std::fs::write(&path, "{}").unwrap();
        let stale = plan_at("claude", Action::Install, &path, Some("{ }".into()), false).unwrap();
        assert!(apply_plan(&stale).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_and_private_configs_keep_their_identity() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let managed = dir.path().join("managed.json");
        std::fs::write(&managed, "{}\n").unwrap();
        std::fs::set_permissions(&managed, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = dir.path().join("settings.json");
        symlink(&managed, &link).unwrap();

        let plan = plan_at(
            "claude",
            Action::Install,
            &link,
            read_existing(&link).unwrap(),
            false,
        )
        .unwrap();
        apply_plan(&plan).unwrap();

        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(std::fs::read_to_string(&managed)
            .unwrap()
            .contains("TERAX_CLI"));
        let mode = std::fs::metadata(&managed).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn the_pi_extension_calls_the_cli_and_stays_inert_elsewhere() {
        let extension = pi_extension();
        assert!(extension.contains("process.env.TERAX_CLI"));
        assert!(extension.contains("process.env.TERAX_PANE_ID"));
        assert!(extension.contains(r#"["hook", "pi", event]"#));
        assert!(extension.starts_with("// terax-pi-notifications-v2"));
        assert!(extension.contains("windowsHide: true"));
        assert!(!extension.contains("777"));
        for event in ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"] {
            assert!(extension.contains(&format!("\"{event}\"")), "{event}");
        }
        assert_eq!(
            extension.matches("pi.on(\"").count(),
            1 + PI_HOOKS.iter().filter(|hook| hook.wanted).count()
        );
    }

    #[test]
    fn pi_install_replaces_only_terax_owned_files() {
        let p = Path::new("/x/terax-notifications.ts");
        assert_eq!(
            pi_after(None, Action::Install, p).unwrap().as_deref(),
            Some(pi_extension().as_str())
        );
        let v1 = "// terax-pi-notifications-v1\nexport default () => {}\n";
        assert_eq!(
            pi_after(Some(v1), Action::Install, p).unwrap().as_deref(),
            Some(pi_extension().as_str())
        );
        assert!(pi_after(Some("export const mine = true;"), Action::Install, p).is_err());
        assert_eq!(
            pi_after(Some("  \n"), Action::Install, p)
                .unwrap()
                .as_deref(),
            Some(pi_extension().as_str())
        );

        assert_eq!(
            pi_after(Some(pi_extension().as_str()), Action::Uninstall, p).unwrap(),
            None
        );
        assert_eq!(pi_after(None, Action::Uninstall, p).unwrap(), None);
        assert_eq!(
            pi_after(Some("export const mine = true;"), Action::Uninstall, p)
                .unwrap()
                .as_deref(),
            Some("export const mine = true;")
        );
    }

    #[test]
    fn pi_plan_install_and_uninstall_round_trip_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ext").join(PI_EXTENSION_FILE);
        let install = plan_at("pi", Action::Install, &path, None, false).unwrap();
        apply_plan(&install).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), pi_extension());
        let existing = read_existing(&path).unwrap();
        assert!(
            !plan_at("pi", Action::Install, &path, existing.clone(), false)
                .unwrap()
                .changed
        );
        apply_plan(&plan_at("pi", Action::Uninstall, &path, existing, false).unwrap()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn unknown_agents_and_actions_are_rejected() {
        assert!(find("nobody").is_err());
        assert!(Action::parse("explode").is_err());
        assert!(!hooks_status("nobody"));
    }

    #[test]
    fn conout_marker_matches_detector_format() {
        assert_eq!(
            conout_marker("gemini", "attention"),
            "\u{1b}]777;notify;Terax;gemini;attention\u{7}"
        );
    }
}
