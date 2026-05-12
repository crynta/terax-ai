//! Wire format for agent → frontend streaming.
//!
//! ACP's `SessionUpdate` enum is rich and pre-1.0; we deliberately project
//! it down to a smaller, frontend-friendly shape (`AgentEvent`) so the React
//! transport doesn't have to understand the full ACP schema. New ACP variants
//! land here first as `Unknown` and only get a typed event once we render
//! them.
//!
//! Tauri requires `Clone` for typed `Channel` payloads, so all variants do.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Sent once after `initialize` succeeds. The frontend can use this to
    /// flip the session into "ready" state.
    SessionReady {
        session_id: String,
        protocol_version: u32,
        agent_name: Option<String>,
        agent_version: Option<String>,
    },
    /// Streamed assistant message text (markdown).
    AssistantChunk { session_id: String, text: String },
    /// Agent's internal reasoning stream — surfaced separately so the UI can
    /// fold/dim it.
    ReasoningChunk { session_id: String, text: String },
    /// A new tool call has been initiated. The UI typically renders a card.
    ToolCall {
        session_id: String,
        call: ToolCallSnapshot,
    },
    /// Update to a previously-announced tool call (status flip, content
    /// append, completion).
    ToolCallUpdate {
        session_id: String,
        call_id: String,
        status: Option<String>,
        title: Option<String>,
        content: Option<Vec<ToolCallContentPart>>,
        locations: Option<Vec<ToolCallLocation>>,
        raw_output: Option<serde_json::Value>,
    },
    /// Agent's plan list — for the "thinking" / todo display.
    Plan {
        session_id: String,
        entries: Vec<PlanEntry>,
    },
    /// Agent is asking the host for permission to perform an action.
    /// The frontend must respond via `agent_permission_respond`. Until then
    /// the agent is paused.
    PermissionRequest {
        session_id: String,
        request_id: String,
        tool_call: ToolCallSnapshot,
        options: Vec<PermissionOptionSnapshot>,
    },
    /// Turn finished. `stop_reason` is the agent's verbatim string ("end_turn",
    /// "max_tokens", "cancelled", "refusal", …).
    TurnEnded {
        session_id: String,
        stop_reason: String,
    },
    /// Backend exited unexpectedly or a protocol error happened. After this,
    /// the session is dead — the frontend should mark it errored and not send
    /// further prompts.
    Error { session_id: String, message: String },
    /// Backend process closed cleanly.
    Closed { session_id: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallSnapshot {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub content: Vec<ToolCallContentPart>,
    pub locations: Vec<ToolCallLocation>,
    pub raw_input: Option<serde_json::Value>,
    pub raw_output: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolCallContentPart {
    /// Plain content block reduced to a markdown string. Image/audio/resource
    /// variants serialize their description and a content-type hint; the host
    /// UI can ignore non-text variants for now.
    Content { text: String, mime_type: Option<String> },
    /// File diff. Maps cleanly onto `QueuedEdit { path, originalContent,
    /// proposedContent }` on the frontend.
    Diff {
        path: String,
        old_text: Option<String>,
        new_text: String,
    },
    /// Embedded terminal — the agent has spawned a terminal we created via
    /// `terminal/create`. Phase 1 doesn't surface a real terminal yet; the
    /// UI can render a placeholder.
    Terminal { terminal_id: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallLocation {
    pub path: String,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanEntry {
    pub content: String,
    pub priority: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PermissionOptionSnapshot {
    pub id: String,
    pub label: String,
    pub kind: String,
}
