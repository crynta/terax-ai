use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

use super::{
    McpContent, McpEnvVar, McpToolCallResult, MCP_ALLOWED_COMMANDS, MCP_CONTENT_ITEM_LIMIT,
    MCP_MIME_TYPE_LIMIT, MCP_NAME_LIMIT, MCP_SCHEMA_DESCRIPTION_LIMIT, MCP_SCHEMA_PROPERTY_LIMIT,
    MCP_STORED_TEXT_LIMIT, MCP_TEXT_RESULT_LIMIT,
};

pub fn mcp_env_secret_account(server_id: &str, name: &str) -> Result<String, String> {
    let server_id = sanitize_server_id(server_id)?;
    if !is_safe_env_name(name) {
        return Err("MCP env name is not allowed for secret storage".to_string());
    }
    Ok(format!("{server_id}/{name}"))
}

pub(super) fn validate_config_text(
    value: &str,
    field: &str,
    limit: usize,
    allow_empty: bool,
    trim: bool,
) -> Result<String, String> {
    let value = if trim { value.trim() } else { value };
    if !allow_empty && value.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.len() > limit {
        return Err(format!("{field} is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{field} must not contain control characters"));
    }
    Ok(value.to_string())
}

pub(super) fn validate_http_url(url: Option<&str>) -> Result<String, String> {
    let url = validate_config_text(
        url.unwrap_or_default(),
        "MCP HTTP URL",
        MCP_STORED_TEXT_LIMIT,
        false,
        true,
    )?;
    let parsed = reqwest::Url::parse(&url).map_err(|_| "MCP HTTP URL is invalid".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("MCP HTTP URL must use http or https".to_string()),
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("MCP HTTP URL must not contain credentials".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("MCP HTTP URL must include a host".to_string());
    }
    Ok(url)
}

pub(super) fn validate_stdio_args(args: &[String]) -> Result<(), String> {
    if args.len() > 64 {
        return Err("MCP stdio args list too long (max 64)".to_string());
    }
    for (i, arg) in args.iter().enumerate() {
        if arg.len() > MCP_STORED_TEXT_LIMIT {
            return Err(format!("MCP stdio arg[{}] is too long", i));
        }
        if arg.chars().any(|c| c == '\0') {
            return Err(format!("MCP stdio arg[{}] contains null bytes", i));
        }
    }
    Ok(())
}

pub(super) fn validate_stdio_command(command: &str) -> Result<String, String> {
    let command = validate_config_text(
        command,
        "MCP stdio command",
        MCP_STORED_TEXT_LIMIT,
        false,
        true,
    )?;
    let looks_like_path =
        command.contains('/') || command.contains('\\') || Path::new(&command).is_absolute();
    if looks_like_path {
        let path = Path::new(&command);
        if !path.is_absolute() {
            return Err(
                "MCP stdio command must be an absolute executable path or allowlisted command name"
                    .to_string(),
            );
        }
        if !path.exists() {
            return Err(format!("MCP stdio command does not exist: {command}"));
        }
        if !is_executable_file(path) {
            return Err(format!(
                "MCP stdio command must be an executable file: {command}"
            ));
        }
        return Ok(command);
    }

    if !is_safe_command_name(&command) || !MCP_ALLOWED_COMMANDS.contains(&command.as_str()) {
        return Err(format!(
            "MCP stdio command must be an absolute executable path or allowlisted command name ({})",
            MCP_ALLOWED_COMMANDS.join(", ")
        ));
    }
    Ok(command)
}

pub(super) fn validate_stdio_cwd(cwd: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|cwd| !cwd.is_empty()) else {
        return Ok(None);
    };
    let cwd = validate_config_text(cwd, "MCP stdio cwd", MCP_STORED_TEXT_LIMIT, false, false)?;
    let path = PathBuf::from(&cwd);
    if !path.exists() {
        return Err(format!("MCP stdio cwd does not exist: {cwd}"));
    }
    if !path.is_dir() {
        return Err(format!("MCP stdio cwd must be a directory: {cwd}"));
    }
    Ok(Some(path))
}

fn is_safe_command_name(command: &str) -> bool {
    !command.is_empty()
        && command.len() <= 128
        && command.bytes().all(|byte| {
            byte == b'.' || byte == b'_' || byte == b'-' || byte.is_ascii_alphanumeric()
        })
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.is_file()
        && fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

pub(super) fn apply_stdio_environment(command: &mut Command, env_vars: &[McpEnvVar]) {
    command.env_clear();
    for name in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TMPDIR",
        "TEMP",
        "TMP",
        "SystemRoot",
        "WINDIR",
    ] {
        if let Ok(value) = env::var(name) {
            command.env(name, value);
        }
    }
    for item in env_vars {
        if is_safe_env_name(&item.name) {
            command.env(&item.name, &item.value);
        }
    }
}

pub(super) fn is_safe_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
        && !name.starts_with("TERAX_")
}

pub(super) fn sanitize_server_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("MCP server id must not be empty".to_string());
    }
    if id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte == b'_' || byte == b'-' || byte.is_ascii_alphanumeric())
    {
        return Err("MCP server id may only contain letters, numbers, _ and -".to_string());
    }
    Ok(id.to_string())
}

pub(super) fn parse_qualified_tool_name(qualified_name: &str) -> Result<(String, String), String> {
    let mut parts = qualified_name.splitn(3, "__");
    if parts.next() != Some("mcp") {
        return Err(format!("invalid MCP tool name: {qualified_name}"));
    }
    let server_id = parts
        .next()
        .filter(|part| !part.is_empty())
        .ok_or_else(|| format!("invalid MCP tool name: {qualified_name}"))?;
    let tool_key = parts
        .next()
        .filter(|part| !part.is_empty())
        .ok_or_else(|| format!("invalid MCP tool name: {qualified_name}"))?;
    Ok((server_id.to_string(), tool_key.to_string()))
}

pub(super) fn normalize_tool_result(result: Value) -> McpToolCallResult {
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = result
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(MCP_CONTENT_ITEM_LIMIT)
                .map(normalize_content)
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            vec![McpContent {
                content_type: "text".to_string(),
                text: Some(truncate_text(&result.to_string(), MCP_TEXT_RESULT_LIMIT)),
                mime_type: None,
                data: None,
                raw_data: None,
            }]
        });
    McpToolCallResult { content, is_error }
}

fn normalize_content(value: &Value) -> McpContent {
    let content_type = value
        .get("type")
        .and_then(Value::as_str)
        .map(|text| sanitize_text_token(text, MCP_NAME_LIMIT))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "text".to_string());
    let mime_type = value
        .get("mimeType")
        .or_else(|| value.get("mime_type"))
        .and_then(Value::as_str)
        .map(|text| sanitize_text_token(text, MCP_MIME_TYPE_LIMIT))
        .filter(|text| !text.is_empty());
    let raw_data_len = value.get("data").and_then(Value::as_str).map(str::len);
    let text = if content_type == "text" {
        value
            .get("text")
            .and_then(Value::as_str)
            .map(|text| truncate_text(text, MCP_TEXT_RESULT_LIMIT))
            .or_else(|| raw_data_len.map(|len| format!("[MCP text data omitted: {len} bytes]")))
    } else {
        Some(omitted_content_notice(
            &content_type,
            mime_type.as_deref(),
            raw_data_len,
        ))
    };
    let raw_data = if content_type == "text" {
        None
    } else {
        value
            .get("data")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    };
    McpContent {
        content_type,
        text,
        mime_type,
        data: None,
        raw_data,
    }
}

fn omitted_content_notice(
    content_type: &str,
    mime_type: Option<&str>,
    data_len: Option<usize>,
) -> String {
    let mime = mime_type
        .filter(|mime| !mime.is_empty())
        .map(|mime| format!(" {mime}"))
        .unwrap_or_default();
    let bytes = data_len
        .map(|len| format!(", {len} bytes"))
        .unwrap_or_default();
    format!("[MCP {content_type}{mime} content omitted{bytes}]")
}

pub(super) fn sanitize_input_schema(schema: Value) -> Value {
    let Some(object) = schema.as_object() else {
        return json!({ "type": "object", "properties": {}, "required": [] });
    };
    let properties = object
        .get("properties")
        .and_then(Value::as_object)
        .map(|props| {
            props
                .iter()
                .take(MCP_SCHEMA_PROPERTY_LIMIT)
                .filter_map(|(name, value)| {
                    let name = sanitize_text_token(name, MCP_NAME_LIMIT);
                    if name.is_empty() {
                        None
                    } else {
                        Some((name, sanitize_property_schema(value)))
                    }
                })
                .collect::<serde_json::Map<String, Value>>()
        })
        .unwrap_or_default();
    let required = object
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|name| sanitize_text_token(name, MCP_NAME_LIMIT))
                .filter(|name| properties.contains_key(name))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
    })
}

fn sanitize_property_schema(value: &Value) -> Value {
    let Some(object) = value.as_object() else {
        return json!({ "type": "string" });
    };
    let mut out = serde_json::Map::new();
    if let Some(kind) = object.get("type") {
        match kind {
            Value::String(text) => {
                out.insert(
                    "type".to_string(),
                    json!(sanitize_text_token(text, MCP_NAME_LIMIT)),
                );
            }
            Value::Array(items) => {
                out.insert(
                    "type".to_string(),
                    Value::Array(
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .take(4)
                            .map(|item| json!(sanitize_text_token(item, MCP_NAME_LIMIT)))
                            .collect(),
                    ),
                );
            }
            _ => {}
        }
    }
    if let Some(description) = object.get("description").and_then(Value::as_str) {
        out.insert(
            "description".to_string(),
            json!(sanitize_text_token(
                description,
                MCP_SCHEMA_DESCRIPTION_LIMIT
            )),
        );
    }
    if let Some(enum_values) = object.get("enum").and_then(Value::as_array) {
        out.insert(
            "enum".to_string(),
            Value::Array(enum_values.iter().take(20).cloned().collect()),
        );
    }
    if out.is_empty() {
        out.insert("type".to_string(), json!("string"));
    }
    Value::Object(out)
}

pub(super) fn sanitize_text_token(value: &str, limit: usize) -> String {
    let mut output = String::new();
    let mut previous_space = false;
    for ch in value.chars() {
        let next = if ch.is_control() { ' ' } else { ch };
        if next.is_whitespace() {
            if !previous_space && !output.is_empty() {
                output.push(' ');
            }
            previous_space = true;
        } else {
            output.push(next);
            previous_space = false;
        }
        if output.len() >= limit {
            let mut end = limit;
            while !output.is_char_boundary(end) {
                end -= 1;
            }
            output.truncate(end);
            break;
        }
    }
    output.trim().to_string()
}

pub(super) fn safe_tool_key(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            output.push(ch);
        } else if ch == '.' || ch.is_whitespace() {
            output.push('_');
        }
        if output.len() >= MCP_NAME_LIMIT {
            break;
        }
    }
    output.trim_matches('_').to_string()
}

pub(super) fn truncate_text(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…[truncated {} bytes]", &value[..end], value.len() - end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn sanitize_server_id_accepts_valid() {
        assert_eq!(sanitize_server_id("my_server-1").unwrap(), "my_server-1");
    }

    #[test]
    fn sanitize_server_id_rejects_empty() {
        assert!(sanitize_server_id("").is_err());
        assert!(sanitize_server_id("   ").is_err());
    }

    #[test]
    fn sanitize_server_id_rejects_overlong() {
        assert!(sanitize_server_id(&"a".repeat(65)).is_err());
        assert!(sanitize_server_id(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn sanitize_server_id_rejects_special_chars() {
        assert!(sanitize_server_id("has space").is_err());
        assert!(sanitize_server_id("has/slash").is_err());
        assert!(sanitize_server_id("has.dot").is_err());
    }

    #[test]
    fn is_safe_env_name_rejects_terax_prefix() {
        assert!(!is_safe_env_name("TERAX_SECRET"));
        assert!(is_safe_env_name("MY_VAR"));
    }

    #[test]
    fn is_safe_env_name_rejects_empty() {
        assert!(!is_safe_env_name(""));
    }

    #[test]
    fn is_safe_env_name_rejects_special_chars() {
        assert!(!is_safe_env_name("MY-VAR"));
        assert!(!is_safe_env_name("MY.VAR"));
        assert!(is_safe_env_name("MY_VAR"));
    }

    #[test]
    fn safe_tool_key_normalizes() {
        assert_eq!(safe_tool_key("hello world"), "hello_world");
        assert_eq!(safe_tool_key("foo.bar"), "foo_bar");
        assert_eq!(safe_tool_key("a/b"), "ab");
        assert_eq!(safe_tool_key("___"), "");
    }

    #[test]
    fn parse_qualified_tool_name_valid() {
        let (server, key) = parse_qualified_tool_name("mcp__server__tool").unwrap();
        assert_eq!(server, "server");
        assert_eq!(key, "tool");
    }

    #[test]
    fn parse_qualified_tool_name_rejects_invalid() {
        assert!(parse_qualified_tool_name("mcpx__s__t").is_err());
        assert!(parse_qualified_tool_name("mcp___t").is_err());
        assert!(parse_qualified_tool_name("mcp__s__").is_err());
    }

    #[test]
    fn validate_config_text_rejects_control_chars() {
        assert!(validate_config_text("hello\u{0000}world", "f", 100, false, false).is_err());
        assert!(validate_config_text("hello\nworld", "f", 100, false, false).is_err());
    }

    #[test]
    fn sanitize_text_token_collapses_whitespace() {
        assert_eq!(sanitize_text_token("  a   b  ", 100), "a b");
    }

    #[test]
    fn sanitize_text_token_replaces_control_with_space() {
        assert_eq!(sanitize_text_token("a\tb", 100), "a b");
    }

    #[test]
    fn normalize_tool_result_extracts_content() {
        let result = normalize_tool_result(serde_json::json!({
            "isError": true,
            "content": [{"type": "text", "text": "oops"}]
        }));
        assert!(result.is_error);
        assert_eq!(result.content.len(), 1);
        assert_eq!(result.content[0].text.as_deref(), Some("oops"));
    }

    #[test]
    fn normalize_tool_result_falls_back_to_raw_json() {
        let result = normalize_tool_result(serde_json::json!({"some": "data"}));
        assert!(!result.is_error);
        assert_eq!(result.content.len(), 1);
        assert!(result.content[0].text.as_ref().unwrap().contains("data"));
    }

    #[test]
    fn sanitize_input_schema_non_object_falls_back() {
        let schema = sanitize_input_schema(serde_json::json!("not an object"));
        assert_eq!(schema["type"], "object");
    }

    #[test]
    fn truncate_text_no_op_under_limit() {
        assert_eq!(truncate_text("short", 10), "short");
    }

    #[test]
    fn truncate_text_truncates_at_limit() {
        let result = truncate_text("abcdefghij", 5);
        assert!(result.contains("abcde"));
        assert!(result.contains("[truncated"));
    }

    proptest! {
        #[test]
        fn sanitize_server_id_never_accepts_spaces_or_special(s in "[A-Za-z0-9_\\- ]{1,64}") {
            let trimmed = s.trim();
            if trimmed.contains(' ') {
                prop_assert!(sanitize_server_id(&s).is_err());
            }
        }

        #[test]
        fn sanitize_server_id_roundtrips_valid(s in "[A-Za-z0-9_-]{1,64}") {
            let id = sanitize_server_id(&s).unwrap();
            prop_assert_eq!(id, s.trim());
        }

        #[test]
        fn is_safe_env_name_only_accepts_alnum_underscore(name in "[\x00-\x7f]{0,20}") {
            let valid = !name.is_empty()
                && name.len() <= 128
                && name.bytes().all(|b| b == b'_' || b.is_ascii_alphanumeric())
                && !name.starts_with("TERAX_");
            prop_assert_eq!(is_safe_env_name(&name), valid);
        }

        #[test]
        fn safe_tool_key_produces_only_safe_chars(input in "[A-Za-z0-9 ./\\-_]{0,64}") {
            let key = safe_tool_key(&input);
            for ch in key.chars() {
                prop_assert!(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');
            }
        }

        #[test]
        fn sanitize_text_token_never_contains_control(input in ".*") {
            let out = sanitize_text_token(&input, 1024);
            for ch in out.chars() {
                prop_assert!(!ch.is_control(), "found control char: {:?}", ch);
            }
        }

        #[test]
        fn sanitize_text_token_respects_limit(input in ".*", limit in 1usize..=256) {
            let out = sanitize_text_token(&input, limit);
            prop_assert!(out.len() <= limit);
        }

        #[test]
        fn truncate_text_never_exceeds_limit(input in ".*", limit in 1usize..=512) {
            let out = truncate_text(&input, limit);
            prop_assert!(out.len() <= limit + 30);
        }

        #[test]
        fn parse_qualified_roundtrip(server in "[A-Za-z0-9]{1,32}", tool in "[A-Za-z0-9_-]{1,32}") {
            let qualified = format!("mcp__{server}__{tool}");
            let (s, t) = parse_qualified_tool_name(&qualified).unwrap();
            prop_assert_eq!(s, server);
            prop_assert_eq!(t, tool);
        }
    }
}
