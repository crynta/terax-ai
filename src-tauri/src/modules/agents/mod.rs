//! External AI coding-agent backends, wired over the Agent Client Protocol.
//!
//! The frontend's existing AI panel speaks directly to model APIs via the
//! Vercel AI SDK. This module is the parallel path: instead of calling a
//! model, we spawn an external agent CLI that already speaks ACP (Claude
//! Code via `claude-code-acp`, Codex CLI via `codex-acp`, Gemini CLI via
//! `--experimental-acp`, …) and forward its streamed tool calls, diffs,
//! and permission requests to the host UI.
//!
//! Surface area:
//!
//! - `backends_list`: which backends are known + whether the user has the CLI
//!   on `$PATH`. The frontend uses this for the "External Agents" settings
//!   tab and for picking an active backend per chat session.
//! - `session_start`: spawn a backend and bind a Tauri `Channel` for events.
//! - `session_prompt`: send a user turn.
//! - `session_cancel`: cooperative interruption mid-turn.
//! - `session_close`: kill the backend process and drop session state.
//! - `permission_respond`: deliver the user's selection for a pending
//!   `session/request_permission` round-trip.
//!
//! ACP is pre-1.0; the crate version is pinned in `Cargo.toml` and the
//! protocol version is asserted at `initialize` time inside `runtime.rs`.

pub mod backend;
pub mod detection;
pub mod event;
pub mod probe;
pub mod runtime;
mod spawn;

use serde::Deserialize;
use tauri::{ipc::Channel, AppHandle};

pub use backend::BackendId;
pub use event::AgentEvent;
pub use runtime::AgentsState;

/// Lightweight wire shape — frontend reads this to decide what to render in
/// the Settings → AI → External Agents section and the model picker.
#[derive(serde::Serialize)]
pub struct BackendStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: &'static str,
    /// Resolved binary path on `$PATH`, or `null` if not installed.
    pub binary_path: Option<String>,
    pub install_hint: &'static str,
    pub auth_hint: &'static str,
    pub docs_url: &'static str,
    pub auth_envs: Vec<AuthEnvDescriptor>,
}

/// Per-`AuthEnv` metadata the Settings UI uses to render an input field.
#[derive(serde::Serialize)]
pub struct AuthEnvDescriptor {
    /// Keychain account name under `terax-ai` service.
    pub account: &'static str,
    /// Env var the spawned shim will see (purely for the user's debug
    /// context — surfaced in the probe panel).
    pub env_name: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
}

#[tauri::command]
pub async fn agent_backends_list() -> Result<Vec<BackendStatus>, String> {
    Ok(backend::all()
        .iter()
        .map(|b| BackendStatus {
            id: b.id.as_str(),
            label: b.label,
            kind: b.kind,
            binary_path: detection::resolve(b),
            install_hint: b.install_hint,
            auth_hint: b.auth_hint,
            docs_url: b.docs_url,
            auth_envs: b
                .auth_envs
                .iter()
                .map(|e| AuthEnvDescriptor {
                    account: e.account,
                    env_name: e.env_name,
                    label: e.label,
                    hint: e.hint,
                })
                .collect(),
        })
        .collect())
}

#[derive(Deserialize)]
pub struct StartArgs {
    pub backend_id: String,
    pub cwd: Option<String>,
}

#[tauri::command]
pub async fn agent_session_start(
    app: AppHandle,
    state: tauri::State<'_, AgentsState>,
    args: StartArgs,
    on_event: Channel<AgentEvent>,
) -> Result<String, String> {
    let backend_id = BackendId::parse(&args.backend_id)
        .ok_or_else(|| format!("unknown backend: {}", args.backend_id))?;
    let backend = backend::get(backend_id);
    runtime::start_session(state, app, backend, args.cwd, on_event).await
}

#[tauri::command]
pub async fn agent_session_prompt(
    state: tauri::State<'_, AgentsState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    runtime::send_prompt(state, &session_id, text).await
}

#[tauri::command]
pub async fn agent_session_cancel(
    state: tauri::State<'_, AgentsState>,
    session_id: String,
) -> Result<(), String> {
    runtime::cancel(state, &session_id).await
}

#[tauri::command]
pub async fn agent_session_close(
    state: tauri::State<'_, AgentsState>,
    session_id: String,
) -> Result<(), String> {
    runtime::close(state, &session_id).await
}

#[tauri::command]
pub async fn agent_permission_respond(
    state: tauri::State<'_, AgentsState>,
    session_id: String,
    request_id: String,
    option_id: Option<String>,
    cancelled: bool,
) -> Result<(), String> {
    runtime::respond_to_permission(state, &session_id, &request_id, option_id, cancelled).await
}
