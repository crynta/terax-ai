use serde_json::{json, Value};

pub(super) fn string_schema(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

pub(super) fn number_schema(description: &str) -> Value {
    json!({ "type": "number", "description": description })
}

pub(super) fn boolean_schema(description: &str) -> Value {
    json!({ "type": "boolean", "description": description })
}

pub(super) fn object_schema(properties: Value, required: &[&str]) -> Value {
    object_schema_extra(properties, required, json!({}))
}

pub(super) fn object_schema_extra(mut properties: Value, required: &[&str], extra: Value) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("type".to_string(), json!("object"));
    object.insert("properties".to_string(), properties.take());
    object.insert("required".to_string(), json!(required));
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            object.insert(key, value);
        }
    }
    Value::Object(object)
}

pub(super) fn read_schema() -> Value {
    object_schema(
        json!({
            "path": string_schema("Path to the file to read (relative or absolute)"),
            "offset": number_schema("Line number to start reading from (1-indexed)"),
            "limit": number_schema("Maximum number of lines to read"),
        }),
        &["path"],
    )
}

pub(super) fn ls_schema() -> Value {
    object_schema(
        json!({
            "path": string_schema("Directory to list (default: current directory)"),
            "limit": number_schema("Maximum number of entries to return (default: 500)"),
        }),
        &[],
    )
}

pub(super) fn grep_schema() -> Value {
    object_schema(
        json!({
            "pattern": string_schema("Search pattern (regex or literal string)"),
            "path": string_schema("Directory or file to search (default: current directory)"),
            "glob": string_schema("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
            "ignoreCase": boolean_schema("Case-insensitive search (default: false)"),
            "literal": boolean_schema("Treat pattern as literal string instead of regex (default: false)"),
            "context": number_schema("Number of lines to show before and after each match (default: 0)"),
            "limit": number_schema("Maximum number of matches to return (default: 100)"),
        }),
        &["pattern"],
    )
}

pub(super) fn find_schema() -> Value {
    object_schema(
        json!({
            "pattern": string_schema("Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"),
            "path": string_schema("Directory to search in (default: current directory)"),
            "limit": number_schema("Maximum number of results (default: 1000)"),
        }),
        &["pattern"],
    )
}

pub(super) fn bash_schema() -> Value {
    object_schema(
        json!({
            "command": string_schema("Bash command to execute"),
            "timeout": number_schema("Timeout in seconds (optional, no default timeout)"),
        }),
        &["command"],
    )
}

pub(super) fn replace_edit_schema() -> Value {
    object_schema_extra(
        json!({
            "oldText": string_schema("Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."),
            "newText": string_schema("Replacement text for this targeted edit."),
        }),
        &["oldText", "newText"],
        json!({ "additionalProperties": false }),
    )
}

pub(super) fn edit_schema() -> Value {
    object_schema_extra(
        json!({
            "path": string_schema("Path to the file to edit (relative or absolute)"),
            "edits": {
                "type": "array",
                "items": replace_edit_schema(),
                "description": "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead."
            },
        }),
        &["path", "edits"],
        json!({ "additionalProperties": false }),
    )
}

pub(super) fn write_schema() -> Value {
    object_schema(
        json!({
            "path": string_schema("Path to the file to write (relative or absolute)"),
            "content": string_schema("Content to write to the file"),
        }),
        &["path", "content"],
    )
}

pub(super) fn delete_schema() -> Value {
    object_schema(
        json!({
            "path": string_schema("Path to the file or directory to delete (relative or absolute)"),
        }),
        &["path"],
    )
}

pub(super) fn http_request_schema() -> Value {
    object_schema(
        json!({
            "method": string_schema("HTTP method, e.g. GET or POST"),
            "url": string_schema("HTTP or HTTPS URL to request"),
            "headers": {
                "type": "object",
                "additionalProperties": { "type": "string" },
                "description": "Request headers. Terax blocks unsafe hop-by-hop and control-byte headers."
            },
            "body": string_schema("Optional request body text"),
        }),
        &["method", "url"],
    )
}

pub(super) fn agent_prompt_schema() -> Value {
    object_schema(
        json!({
            "prompt": string_schema("Prompt to send to the workflow Pi agent"),
            "cwd": string_schema("Optional workspace directory for the agent session"),
        }),
        &["prompt"],
    )
}

pub(super) fn browser_automation_schema() -> Value {
    object_schema(
        json!({
            "url": string_schema("Starting URL for browser automation"),
            "instructions": string_schema("Browser automation instructions"),
        }),
        &["instructions"],
    )
}

pub(super) fn artifact_kind_schema() -> Value {
    json!({
        "type": "string",
        "enum": ["html", "react", "markdown", "text", "json", "svg"],
        "description": "Artifact kind. Prefer html, markdown, text, json, or svg until React preview support is available.",
    })
}

pub(super) fn artifact_guidelines() -> Vec<&'static str> {
    vec![
        "Use artifacts for substantial reusable outputs, not short answers.",
        "Do not provide conversationId. Terax derives artifact ownership from the verified Pi session.",
    ]
}

pub(super) fn create_artifact_schema() -> Value {
    object_schema_extra(
        json!({
            "slug": string_schema("Short kebab-style artifact id. Terax normalizes and validates it."),
            "kind": artifact_kind_schema(),
            "content": string_schema("Full artifact content to store in app-owned artifact state."),
            "title": string_schema("Optional display title."),
        }),
        &["slug", "kind", "content"],
        json!({ "additionalProperties": false }),
    )
}

pub(super) fn artifact_replace_edit_schema() -> Value {
    object_schema_extra(
        json!({
            "oldText": string_schema("Exact text to replace. It must match exactly once in the original artifact."),
            "newText": string_schema("Replacement text for this artifact edit."),
        }),
        &["oldText", "newText"],
        json!({ "additionalProperties": false }),
    )
}

pub(super) fn edit_artifact_schema() -> Value {
    object_schema_extra(
        json!({
            "id": string_schema("Artifact slug/id in the current Pi conversation."),
            "edits": {
                "type": "array",
                "items": artifact_replace_edit_schema(),
                "description": "Exact text replacements resolved against the original artifact content, not incrementally."
            },
            "baseVersion": number_schema("Optional current version guard. Stale versions are rejected."),
        }),
        &["id", "edits"],
        json!({ "additionalProperties": false }),
    )
}

pub(super) fn read_artifact_schema() -> Value {
    object_schema_extra(
        json!({
            "id": string_schema("Artifact slug/id in the current Pi conversation."),
            "version": number_schema("Optional artifact version to read."),
        }),
        &["id"],
        json!({ "additionalProperties": false }),
    )
}

pub(super) fn list_artifacts_schema() -> Value {
    object_schema_extra(json!({}), &[], json!({ "additionalProperties": false }))
}
