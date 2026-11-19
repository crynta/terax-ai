use serde_json::{Map, Value};

use super::text::truncate_str;

const MAX_DEPTH: usize = 8;
const MAX_ARRAY: usize = 32;
const MAX_KEYS: usize = 64;
const START_STRING_CAP: usize = 2048;
const MIN_STRING_CAP: usize = 64;

/// Top-level fields that can be megabytes and that Terax never reads.
const DROPPED: &[&str] = &[
    "tool_response",
    "tool_result",
    "background_tasks",
    "session_crons",
    "llm_request",
    "llm_response",
    "messages",
    "toolResults",
    "entries",
];

/// Fields kept when nothing else fits.
const CORE: &[&str] = &[
    "session_id",
    "transcript_path",
    "cwd",
    "hook_event_name",
    "tool_name",
    "tool_use_id",
    "notification_type",
    "message",
    "reason",
    "source",
    "agent_id",
    "agent_type",
];

/// Bounds a hook payload so it fits one control frame: unneeded bulk fields
/// are dropped and long strings, wide arrays and deep nesting are cut.
pub fn trim_payload(value: &Value, max_bytes: usize) -> Value {
    let mut cap = START_STRING_CAP;
    loop {
        let trimmed = shrink(value, 0, cap, true);
        if serialized_len(&trimmed) <= max_bytes {
            return trimmed;
        }
        if cap <= MIN_STRING_CAP {
            return core_fields(value);
        }
        cap /= 2;
    }
}

fn serialized_len(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

fn shrink(value: &Value, depth: usize, cap: usize, top: bool) -> Value {
    if depth > MAX_DEPTH {
        return Value::Null;
    }
    match value {
        Value::String(text) => Value::String(truncate_str(text, cap)),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .take(MAX_ARRAY)
                .map(|item| shrink(item, depth + 1, cap, false))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| !(top && DROPPED.contains(&key.as_str())))
                .take(MAX_KEYS)
                .map(|(key, item)| (truncate_str(key, 128), shrink(item, depth + 1, cap, false)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn core_fields(value: &Value) -> Value {
    let mut out = Map::new();
    if let Value::Object(map) = value {
        for key in CORE {
            if let Some(Value::String(text)) = map.get(*key) {
                out.insert((*key).to_string(), Value::String(truncate_str(text, 256)));
            }
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn small_payloads_pass_through_unchanged() {
        let payload = json!({
            "session_id": "s",
            "tool_name": "Bash",
            "tool_input": { "command": "ls", "timeout": 5, "background": false },
            "list": [1, 2, 3],
        });
        assert_eq!(trim_payload(&payload, 40 * 1024), payload);
    }

    #[test]
    fn bulk_fields_are_dropped_at_the_top_level_only() {
        let payload = json!({
            "session_id": "s",
            "tool_response": "x".repeat(100_000),
            "tool_input": { "tool_response": "kept" },
        });
        let out = trim_payload(&payload, 40 * 1024);
        assert!(out.get("tool_response").is_none());
        assert_eq!(out["tool_input"]["tool_response"], "kept");
    }

    #[test]
    fn long_strings_are_cut_on_character_boundaries() {
        let payload = json!({ "message": "\u{e9}".repeat(5000) });
        let out = trim_payload(&payload, 40 * 1024);
        let message = out["message"].as_str().unwrap();
        assert!(message.len() <= START_STRING_CAP + 3);
        assert!(message.ends_with('\u{2026}'));
    }

    #[test]
    fn wide_and_deep_values_are_bounded() {
        let mut deep = json!("leaf");
        for _ in 0..20 {
            deep = json!({ "next": deep });
        }
        let payload = json!({
            "list": (0..500).collect::<Vec<_>>(),
            "deep": deep,
        });
        let out = trim_payload(&payload, 40 * 1024);
        assert_eq!(out["list"].as_array().unwrap().len(), MAX_ARRAY);
        let mut node = &out["deep"];
        let mut levels = 0;
        while let Some(next) = node.get("next") {
            node = next;
            levels += 1;
        }
        assert!(levels <= MAX_DEPTH);
    }

    #[test]
    fn oversized_payloads_shrink_then_fall_back_to_core_fields() {
        let many: serde_json::Map<String, Value> = (0..64)
            .map(|index| (format!("k{index}"), json!("v".repeat(2000))))
            .collect();
        let payload = json!({
            "session_id": "abc",
            "cwd": "/work",
            "tool_name": "Bash",
            "tool_input": many,
        });
        let out = trim_payload(&payload, 1024);
        assert!(serialized_len(&out) <= 1024);
        assert_eq!(out["session_id"], "abc");
        assert_eq!(out["tool_name"], "Bash");
    }

    #[test]
    fn non_objects_are_handled() {
        assert_eq!(trim_payload(&Value::Null, 1024), Value::Null);
        assert_eq!(trim_payload(&json!("text"), 1024), json!("text"));
        let huge = Value::String("x".repeat(1_000_000));
        assert!(serialized_len(&trim_payload(&huge, 1024)) <= 1024);
    }
}
