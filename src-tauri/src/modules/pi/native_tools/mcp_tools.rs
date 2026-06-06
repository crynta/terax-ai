use serde_json::{json, Value};

use crate::modules::artifacts::{
    ArtifactCreateInput, ArtifactKind, ArtifactSummary, ArtifactUpdateReason,
};

use super::{artifact_tools, NativeToolContext, NativeToolRequest, NativeToolResult};

pub(super) fn execute_mcp_tool(
    request: &NativeToolRequest,
    tool_name: &str,
    arguments: Value,
    context: &NativeToolContext,
) -> Result<NativeToolResult, String> {
    let Some(mcp_state) = context.mcp_state.as_ref() else {
        return Err("MCP tool requested but no MCP broker is connected".to_string());
    };
    let result = mcp_state.call_tool(tool_name, arguments)?;
    let artifacts = create_mcp_result_artifacts(request, tool_name, &result.content, context)?;
    let text = result
        .content
        .iter()
        .map(|part| match part.content_type.as_str() {
            "text" => part.text.clone().unwrap_or_default(),
            other => format!("[MCP {other} content omitted]"),
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let mut text = if text.is_empty() {
        "MCP tool completed.".to_string()
    } else {
        text
    };
    if !artifacts.is_empty() {
        let artifact_lines = artifacts
            .iter()
            .map(|artifact| {
                format!(
                    "{} | {} | v{} | {} bytes",
                    artifact.slug,
                    artifact_tools::artifact_kind_label(&artifact.kind),
                    artifact.version,
                    artifact.content_bytes
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        text.push_str("\n\nMCP artifacts:\n");
        text.push_str(&artifact_lines);
    }
    Ok(NativeToolResult::text(
        text,
        json!({
            "mcp": {
                "toolName": tool_name,
                "isError": result.is_error,
                "content": result.content,
                "artifacts": artifacts,
            }
        }),
    ))
}

fn create_mcp_result_artifacts(
    request: &NativeToolRequest,
    tool_name: &str,
    content: &[crate::modules::mcp::McpContent],
    context: &NativeToolContext,
) -> Result<Vec<ArtifactSummary>, String> {
    let Some(store) = context.artifact_store.clone() else {
        return Ok(Vec::new());
    };

    let mut artifacts = Vec::new();
    for (index, part) in content.iter().enumerate() {
        let Some(data) = part.raw_data.as_ref() else {
            continue;
        };
        if part.content_type == "text" {
            continue;
        }
        let artifact_content = json!({
            "source": "mcp",
            "toolName": tool_name,
            "toolCallId": request.tool_call_id,
            "contentIndex": index,
            "type": part.content_type,
            "mimeType": part.mime_type,
            "encoding": "base64",
            "data": data,
        })
        .to_string();
        let artifact = store
            .create(
                &request.session_id,
                ArtifactCreateInput {
                    slug: mcp_artifact_slug(&request.tool_call_id, index),
                    title: Some(format!("MCP output {} from {tool_name}", index + 1)),
                    kind: ArtifactKind::Json,
                    content: artifact_content,
                },
            )
            .map_err(artifact_tools::format_artifact_error)?;
        artifact_tools::emit_artifact_update(
            context,
            &artifact.summary,
            ArtifactUpdateReason::Create,
        );
        artifacts.push(artifact.summary);
    }
    Ok(artifacts)
}

fn mcp_artifact_slug(tool_call_id: &str, index: usize) -> String {
    let mut slug = String::from("mcp");
    let mut last_was_dash = false;
    for ch in tool_call_id.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if !last_was_dash {
            Some('-')
        } else {
            None
        };
        if let Some(next) = next {
            slug.push(next);
            last_was_dash = next == '-';
        }
        if slug.len() >= 72 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    format!("{slug}-{}", index + 1)
}

pub(super) fn merge_details(mut base: Value, extra: Value) -> Value {
    if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    base
}
