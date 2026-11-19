use serde_json::{json, Value};

use super::text::truncate_str;
use super::{AgentName, HookDecision};

/// Printed when there is nothing to answer. Valid JSON for every agent, which
/// matters because some reject an empty stdout.
pub const NO_DECISION_OUTPUT: &str = "{}";

const MAX_DENY_MESSAGE: usize = 1000;

/// Whether Terax can answer this agent event with a permission decision.
pub fn is_decision_event(agent: AgentName, event: &str) -> bool {
    matches!(
        (agent, event),
        (AgentName::Claude | AgentName::Codex, "PermissionRequest")
    )
}

/// The JSON a decision-capable agent expects on stdout. `original` is the
/// untrimmed hook input; `remember` indexes its `permission_suggestions`.
pub fn decision_output(
    agent: AgentName,
    event: &str,
    decision: &HookDecision,
    original: &Value,
) -> Value {
    if !is_decision_event(agent, event) {
        return json!({});
    }
    let body = match decision {
        HookDecision::Ask => return json!({}),
        HookDecision::Allow { remember } => {
            let mut body = json!({ "behavior": "allow" });
            if agent == AgentName::Claude {
                if let Some(update) = remember.and_then(|index| suggestion(original, index)) {
                    body["updatedPermissions"] = json!([update]);
                }
            }
            body
        }
        HookDecision::Deny { message, interrupt } => {
            let text = message
                .as_deref()
                .map(|message| truncate_str(message, MAX_DENY_MESSAGE))
                .unwrap_or_else(|| "Denied in Terax".to_string());
            let mut body = json!({ "behavior": "deny", "message": text });
            if agent == AgentName::Claude && *interrupt {
                body["interrupt"] = json!(true);
            }
            body
        }
    };
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": body,
        }
    })
}

fn suggestion(original: &Value, index: u32) -> Option<Value> {
    original
        .get("permission_suggestions")?
        .as_array()?
        .get(index as usize)
        .filter(|entry| entry.is_object())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original() -> Value {
        json!({
            "permission_suggestions": [
                { "type": "addRules", "behavior": "allow", "destination": "localSettings",
                  "rules": [{ "toolName": "Bash", "ruleContent": "ls" }] },
                "not an object",
            ]
        })
    }

    #[test]
    fn only_claude_and_codex_permission_requests_take_decisions() {
        assert!(is_decision_event(AgentName::Claude, "PermissionRequest"));
        assert!(is_decision_event(AgentName::Codex, "PermissionRequest"));
        assert!(!is_decision_event(AgentName::Claude, "PreToolUse"));
        assert!(!is_decision_event(AgentName::Gemini, "PermissionRequest"));
        assert!(!is_decision_event(AgentName::Pi, "PermissionRequest"));
    }

    #[test]
    fn claude_allow_and_deny_use_the_documented_shape() {
        let allow = decision_output(
            AgentName::Claude,
            "PermissionRequest",
            &HookDecision::Allow { remember: None },
            &Value::Null,
        );
        assert_eq!(
            allow,
            json!({ "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "allow" } } })
        );

        let deny = decision_output(
            AgentName::Claude,
            "PermissionRequest",
            &HookDecision::Deny {
                message: Some("Not in this repo".into()),
                interrupt: true,
            },
            &Value::Null,
        );
        assert_eq!(
            deny,
            json!({ "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "deny", "message": "Not in this repo", "interrupt": true } } })
        );
    }

    #[test]
    fn remembering_applies_the_matching_suggestion_for_claude_only() {
        let allow = HookDecision::Allow { remember: Some(0) };
        let claude = decision_output(AgentName::Claude, "PermissionRequest", &allow, &original());
        assert_eq!(
            claude["hookSpecificOutput"]["decision"]["updatedPermissions"][0]["destination"],
            "localSettings"
        );
        let codex = decision_output(AgentName::Codex, "PermissionRequest", &allow, &original());
        assert!(codex["hookSpecificOutput"]["decision"]
            .get("updatedPermissions")
            .is_none());

        for index in [1, 9] {
            let out = decision_output(
                AgentName::Claude,
                "PermissionRequest",
                &HookDecision::Allow {
                    remember: Some(index),
                },
                &original(),
            );
            assert!(out["hookSpecificOutput"]["decision"]
                .get("updatedPermissions")
                .is_none());
        }
    }

    #[test]
    fn codex_deny_never_carries_interrupt() {
        let out = decision_output(
            AgentName::Codex,
            "PermissionRequest",
            &HookDecision::Deny {
                message: None,
                interrupt: true,
            },
            &Value::Null,
        );
        let decision = &out["hookSpecificOutput"]["decision"];
        assert_eq!(decision["behavior"], "deny");
        assert_eq!(decision["message"], "Denied in Terax");
        assert!(decision.get("interrupt").is_none());
    }

    #[test]
    fn ask_and_unsupported_events_answer_with_an_empty_object() {
        assert_eq!(
            decision_output(
                AgentName::Claude,
                "PermissionRequest",
                &HookDecision::Ask,
                &Value::Null
            ),
            json!({})
        );
        assert_eq!(
            decision_output(
                AgentName::Gemini,
                "Notification",
                &HookDecision::Allow { remember: None },
                &Value::Null
            ),
            json!({})
        );
        assert_eq!(NO_DECISION_OUTPUT, "{}");
    }

    #[test]
    fn deny_messages_are_bounded() {
        let out = decision_output(
            AgentName::Claude,
            "PermissionRequest",
            &HookDecision::Deny {
                message: Some("x".repeat(5000)),
                interrupt: false,
            },
            &Value::Null,
        );
        let message = out["hookSpecificOutput"]["decision"]["message"]
            .as_str()
            .unwrap();
        assert!(message.len() <= MAX_DENY_MESSAGE + 3);
    }
}
