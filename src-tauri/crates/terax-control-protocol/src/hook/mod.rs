mod adapt;
mod render;
mod text;
mod trim;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use adapt::{normalize, NormalizeError};
pub use render::{decision_output, is_decision_event, NO_DECISION_OUTPUT};
pub use text::{clean_text, truncate_str};
pub use trim::trim_payload;

/// Largest stdin the CLI reads from a hook before giving up on parsing it.
pub const MAX_STDIN_BYTES: usize = 1024 * 1024;
/// Serialized size of the trimmed payload the CLI sends; leaves headroom in
/// the 64 KiB control frame for the envelope.
pub const MAX_PAYLOAD_BYTES: usize = 40 * 1024;
pub const DEFAULT_DECISION_SECS: u32 = 600;
pub const MAX_DECISION_SECS: u32 = 900;

pub const MAX_SESSION_ID: usize = 128;
pub const MAX_PATH: usize = 4096;
pub const MAX_MESSAGE: usize = 4096;
pub const MAX_PREVIEW: usize = 2048;
pub const MAX_NAME: usize = 160;
pub const MAX_LABEL: usize = 200;
pub const MAX_SUGGESTIONS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentName {
    Claude,
    Codex,
    Gemini,
    Pi,
    OpenCode,
    Grok,
}

impl AgentName {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "claude" => Self::Claude,
            "codex" => Self::Codex,
            "gemini" => Self::Gemini,
            "pi" => Self::Pi,
            "opencode" => Self::OpenCode,
            "grok" => Self::Grok,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Pi => "pi",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HookKind {
    SessionStart,
    Prompt,
    ToolStart,
    ToolEnd,
    PermissionRequest,
    PermissionResolved,
    Notification,
    Stop,
    StopFailure,
    Interrupt,
    SubagentStart,
    SubagentStop,
    SessionEnd,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub input_preview: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub error: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Suggestion {
    pub label: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub tool: String,
    pub input_preview: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<Suggestion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubagentState {
    Running,
    Done,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SubagentInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub agent_type: String,
    pub state: SubagentState,
}

/// What an agent hook says, independent of which agent said it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookFacts {
    pub kind: HookKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notification_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<PermissionInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent: Option<SubagentInfo>,
    #[serde(skip)]
    pub decision_capable: bool,
}

impl HookFacts {
    pub fn new(kind: HookKind) -> Self {
        Self {
            kind,
            session_id: None,
            transcript_path: None,
            cwd: None,
            message: None,
            notification_type: None,
            reason: None,
            tool: None,
            permission: None,
            subagent: None,
            decision_capable: false,
        }
    }
}

/// Payload of the `terax:agent-event` Tauri event.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub pane_id: u32,
    pub pty_id: u32,
    pub agent: AgentName,
    #[serde(flatten)]
    pub facts: HookFacts,
    pub at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HookParams {
    pub agent: String,
    pub event: String,
    #[serde(default)]
    pub payload: Value,
    /// Seconds the CLI is willing to wait for a decision; absent for
    /// observe-only hooks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_secs: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "behavior", rename_all = "lowercase")]
pub enum HookDecision {
    Allow {
        /// Index into the request's permission suggestions to apply.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        remember: Option<u32>,
    },
    Deny {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        interrupt: bool,
    },
    /// No decision: the agent shows its own prompt.
    Ask,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HookResult {
    pub accepted: bool,
    /// An interim answer: the request waits for a UI decision and the final
    /// response follows on the same connection.
    #[serde(default, skip_serializing_if = "is_false")]
    pub held: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<HookDecision>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn agent_names_round_trip_through_the_wire_literals() {
        for agent in [
            AgentName::Claude,
            AgentName::Codex,
            AgentName::Gemini,
            AgentName::Pi,
            AgentName::OpenCode,
            AgentName::Grok,
        ] {
            assert_eq!(AgentName::parse(agent.as_str()), Some(agent));
            assert_eq!(serde_json::to_value(agent).unwrap(), json!(agent.as_str()));
        }
        assert_eq!(AgentName::parse("Claude"), None);
        assert_eq!(AgentName::parse(""), None);
    }

    #[test]
    fn event_wire_shape_is_flat_camel_case() {
        let mut facts = HookFacts::new(HookKind::PermissionRequest);
        facts.session_id = Some("s1".into());
        facts.permission = Some(PermissionInfo {
            request_id: Some("r1".into()),
            tool: "Bash".into(),
            input_preview: "ls".into(),
            suggestions: vec![Suggestion {
                label: "Always allow".into(),
            }],
            outcome: None,
        });
        facts.decision_capable = true;
        let event = AgentEvent {
            pane_id: 3,
            pty_id: 9,
            agent: AgentName::Claude,
            facts,
            at: 1700000000000,
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            json!({
                "paneId": 3,
                "ptyId": 9,
                "agent": "claude",
                "kind": "permission-request",
                "sessionId": "s1",
                "permission": {
                    "requestId": "r1",
                    "tool": "Bash",
                    "inputPreview": "ls",
                    "suggestions": [{ "label": "Always allow" }],
                },
                "at": 1700000000000u64,
            })
        );
    }

    #[test]
    fn subagent_info_uses_type_as_the_wire_key() {
        let info = SubagentInfo {
            id: "a1".into(),
            agent_type: "reviewer".into(),
            state: SubagentState::Running,
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({ "id": "a1", "type": "reviewer", "state": "running" })
        );
    }

    #[test]
    fn decisions_use_the_behavior_tag() {
        let allow: HookDecision = serde_json::from_value(json!({ "behavior": "allow" })).unwrap();
        assert_eq!(allow, HookDecision::Allow { remember: None });
        let remember: HookDecision =
            serde_json::from_value(json!({ "behavior": "allow", "remember": 1 })).unwrap();
        assert_eq!(remember, HookDecision::Allow { remember: Some(1) });
        let deny: HookDecision =
            serde_json::from_value(json!({ "behavior": "deny", "message": "no" })).unwrap();
        assert_eq!(
            deny,
            HookDecision::Deny {
                message: Some("no".into()),
                interrupt: false
            }
        );
        let ask: HookDecision = serde_json::from_value(json!({ "behavior": "ask" })).unwrap();
        assert_eq!(ask, HookDecision::Ask);
        assert!(serde_json::from_value::<HookDecision>(json!({ "behavior": "maybe" })).is_err());
    }

    #[test]
    fn results_mark_an_interim_hold_only_when_held() {
        let held = HookResult {
            accepted: true,
            held: true,
            decision: None,
        };
        assert_eq!(
            serde_json::to_value(&held).unwrap(),
            json!({ "accepted": true, "held": true })
        );
        let final_result = HookResult {
            accepted: true,
            held: false,
            decision: Some(HookDecision::Ask),
        };
        assert_eq!(
            serde_json::to_value(&final_result).unwrap(),
            json!({ "accepted": true, "decision": { "behavior": "ask" } })
        );
        let parsed: HookResult = serde_json::from_value(json!({ "accepted": true })).unwrap();
        assert!(!parsed.held);
    }

    #[test]
    fn hook_params_omit_an_absent_wait() {
        let params = HookParams {
            agent: "claude".into(),
            event: "Stop".into(),
            payload: json!({}),
            wait_secs: None,
        };
        assert_eq!(
            serde_json::to_value(params).unwrap(),
            json!({ "agent": "claude", "event": "Stop", "payload": {} })
        );
    }
}
