//! ACP session driver and Tauri-state holder.
//!
//! Each call to `start_session` spawns:
//! - the backend's CLI as a stdio subprocess (via `AcpAgent::new(McpServer::Stdio(...))`),
//! - a tokio task running `Client.builder().connect_with(...)`,
//! - command-mpsc + permission-responder map shared between the task and the
//!   Tauri commands the frontend invokes.
//!
//! The driver inside `connect_with` does:
//!   1. `initialize` (asserts protocol version and emits `SessionReady`).
//!   2. `session/new` with the workspace cwd.
//!   3. Loop over the command channel, sending `session/prompt` /
//!      `session/cancel` to the agent and emitting `TurnEnded` / `Error` /
//!      `Closed` events back to the frontend.
//!
//! `on_receive_notification` translates `session/update` payloads into
//! frontend events. `on_receive_request` (currently only
//! `RequestPermissionRequest`) stashes the responder in `pending_perms` so the
//! UI can resolve it asynchronously via `agent_permission_respond`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol::schema::{
    CancelNotification, ContentBlock, ContentChunk, InitializeRequest, NewSessionRequest,
    PermissionOption, PermissionOptionId, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, TextContent, ToolCall,
    ToolCallContent, ToolCallUpdate, ToolCallUpdateFields,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Responder};

use super::spawn::AcpSubprocess;
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::sync::{mpsc, Mutex as TokioMutex};

use super::backend::{AgentBackend, BackendProtocol};
use super::detection;
use super::event::{
    AgentEvent, PermissionOptionSnapshot, PlanEntry, ToolCallContentPart, ToolCallLocation,
    ToolCallSnapshot,
};
use crate::modules::secrets::{read_secret, SecretsState};

pub(super) const KEYRING_SERVICE: &str = "terax-ai";

/// Env vars the Anthropic / Claude Desktop / Claude-Code-CLI runtime sets
/// on its child processes to signal "you're nested inside another Claude
/// session." Any of them poisons `claude-code-acp` — `MANAGED_BY_HOST`
/// makes it try IPC to a host that isn't us (ECONNREFUSED), `CLAUDECODE`
/// triggers an explicit nested-session refusal, and the rest leak host
/// state in less obvious ways. We strip them on every spawn.
///
/// The Settings → External Agents probe imports this same list so a
/// passing test really exercises the same env shape as a real session.
pub(super) const POISON_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL",
    "CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES",
    "CLAUDE_CODE_DISABLE_CRON",
    "CLAUDE_AGENT_SDK_VERSION",
];

/// One frontend-issued instruction directed at the long-lived ACP driver.
enum Command {
    Prompt(String),
    Cancel,
    Close,
}

/// Per-session state held in `AgentsState`.
struct SessionHandle {
    cmd_tx: mpsc::UnboundedSender<Command>,
    pending_perms: Arc<TokioMutex<HashMap<String, Responder<RequestPermissionResponse>>>>,
    abort: tokio::task::AbortHandle,
}

#[derive(Default)]
pub struct AgentsState {
    sessions: std::sync::Mutex<HashMap<String, SessionHandle>>,
}

/// Entry point — dispatches to the right driver based on `backend.protocol`.
///
/// To add a non-ACP backend (e.g. Aider's plain-stdout, OpenCode's HTTP
/// server) you'd:
///   1. Add a variant to `BackendProtocol` (e.g. `Ndjson` or `Http`).
///   2. Tag the backend's registry entry with the new variant.
///   3. Add a match arm here that calls into the new driver.
///
/// The driver only has to (a) honour `Command::{Prompt, Cancel, Close}`
/// from the channel, (b) emit `AgentEvent`s on the Tauri channel, and
/// (c) populate `pending_perms` for any approval-style round-trips so
/// the existing `respond_to_permission` Tauri command can resolve them.
pub async fn start_session(
    state: tauri::State<'_, AgentsState>,
    app: AppHandle,
    backend: &'static AgentBackend,
    cwd: Option<String>,
    on_event: Channel<AgentEvent>,
) -> Result<String, String> {
    match backend.protocol {
        BackendProtocol::Acp => {
            start_acp_session(state, app, backend, cwd, on_event).await
        }
    }
}

async fn start_acp_session(
    state: tauri::State<'_, AgentsState>,
    app: AppHandle,
    backend: &'static AgentBackend,
    cwd: Option<String>,
    on_event: Channel<AgentEvent>,
) -> Result<String, String> {
    let bin_path = detection::resolve(backend).ok_or_else(|| {
        format!(
            "{} is not on $PATH. Install it once (`{}`) or run it via npx \
             (`npx -y {}`) — see Settings → External Agents for details.",
            backend.label, backend.install_hint, backend.npx_package,
        )
    })?;

    let session_id = uuid::Uuid::new_v4().to_string();

    // Build the spawn Command directly so we can both *set* and *remove*
    // env vars. AcpAgent's McpServerStdio config only supports adding,
    // which leaves us defenseless against parents that export poisoned
    // values.
    let mut cmd = tokio::process::Command::new(&bin_path);
    for arg in backend.args {
        cmd.arg(arg);
    }

    // Scrub env vars that signal "I'm running inside another Claude Code /
    // Claude Desktop session." If Terax was launched from a shell or
    // process that inherited Claude Desktop's local-agent-mode env (or
    // simply nested under `claude` itself), these tell the spawned shim
    // "auth and runtime are managed by an external host" — which causes it
    // to try IPC against a host socket that doesn't exist (→ ECONNREFUSED)
    // or to refuse to start ("nested sessions"). We always strip them so
    // each spawned agent runs as a fresh top-level session.
    for var in POISON_VARS {
        cmd.env_remove(var);
    }

    // Forward every populated auth-env entry. Unpopulated entries get
    // `env_remove` so inherited stale values can't poison the shim's
    // auth chain. The shim itself decides precedence when multiple are
    // set (Claude Code: ANTHROPIC_API_KEY beats CLAUDE_CODE_OAUTH_TOKEN).
    if !backend.auth_envs.is_empty() {
        let secrets = app
            .try_state::<SecretsState>()
            .ok_or_else(|| "secrets state not registered".to_string())?;
        for entry in backend.auth_envs {
            match read_secret(&app, secrets.inner(), KEYRING_SERVICE, entry.account)? {
                Some(v) if !v.is_empty() => {
                    cmd.env(entry.env_name, v);
                }
                _ => {
                    cmd.env_remove(entry.env_name);
                }
            }
        }
    }

    let agent_proc = AcpSubprocess::new(cmd);

    let cwd_pb: PathBuf = cwd
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("/"));

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Command>();
    let pending_perms: Arc<TokioMutex<HashMap<String, Responder<RequestPermissionResponse>>>> =
        Arc::new(TokioMutex::new(HashMap::new()));

    // The driver task owns these clones for emitting events / accepting
    // commands. Everything is `Send + 'static` so it crosses the spawn fine.
    let session_id_for_driver = session_id.clone();
    let pending_perms_for_req = pending_perms.clone();
    let on_event_for_main = on_event.clone();
    let on_event_for_notif = on_event.clone();
    let on_event_for_perm = on_event.clone();
    let session_id_for_notif = session_id.clone();
    let session_id_for_perm = session_id.clone();

    let driver = tokio::spawn(async move {
        let main_session_id = session_id_for_driver.clone();
        let on_event_for_close = on_event_for_main.clone();
        let close_session_id = main_session_id.clone();

        let res = Client
            .builder()
            .name("terax")
            .on_receive_notification(
                async move |notif: SessionNotification, _cx: ConnectionTo<Agent>| {
                    let chan = on_event_for_notif.clone();
                    let sid = session_id_for_notif.clone();
                    for ev in translate_session_update(&sid, notif) {
                        let _ = chan.send(ev);
                    }
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                async move |req: RequestPermissionRequest,
                            responder: Responder<RequestPermissionResponse>,
                            _cx: ConnectionTo<Agent>| {
                    let chan = on_event_for_perm.clone();
                    let sid = session_id_for_perm.clone();
                    let perms = pending_perms_for_req.clone();
                    let request_id = uuid::Uuid::new_v4().to_string();
                    perms.lock().await.insert(request_id.clone(), responder);
                    let _ = chan.send(AgentEvent::PermissionRequest {
                        session_id: sid,
                        request_id,
                        tool_call: snapshot_tool_call_update(&req.tool_call),
                        options: req
                            .options
                            .iter()
                            .map(snapshot_permission_option)
                            .collect(),
                    });
                    // We don't call `responder.respond` here — that happens
                    // out-of-band when the user clicks Approve/Deny. ACP
                    // tolerates the responder being held; the agent is paused
                    // until we reply.
                    Ok(())
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(agent_proc, |cx: ConnectionTo<Agent>| async move {
                // 1. Initialize.
                let init = cx
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                let _ = on_event_for_main.send(AgentEvent::SessionReady {
                    session_id: main_session_id.clone(),
                    protocol_version: protocol_version_to_u32(&init.protocol_version),
                    agent_name: init.agent_info.as_ref().map(|i| i.name.clone()),
                    agent_version: init.agent_info.as_ref().map(|i| i.version.clone()),
                });

                // 2. New session at the workspace cwd.
                let new_session = cx
                    .send_request(NewSessionRequest::new(cwd_pb))
                    .block_task()
                    .await?;
                let acp_session_id = new_session.session_id;

                // 3. Drive: pump commands until the channel is closed.
                let mut rx = cmd_rx;
                while let Some(cmd) = rx.recv().await {
                    match cmd {
                        Command::Prompt(text) => {
                            let res = cx
                                .send_request(PromptRequest::new(
                                    acp_session_id.clone(),
                                    vec![ContentBlock::Text(TextContent::new(text))],
                                ))
                                .block_task()
                                .await;
                            match res {
                                Ok(p) => {
                                    let _ = on_event_for_main.send(AgentEvent::TurnEnded {
                                        session_id: main_session_id.clone(),
                                        stop_reason: format!("{:?}", p.stop_reason),
                                    });
                                }
                                Err(e) => {
                                    let _ = on_event_for_main.send(AgentEvent::Error {
                                        session_id: main_session_id.clone(),
                                        message: e.to_string(),
                                    });
                                }
                            }
                        }
                        Command::Cancel => {
                            let _ = cx.send_notification(CancelNotification::new(
                                acp_session_id.clone(),
                            ));
                        }
                        Command::Close => break,
                    }
                }
                Ok::<(), agent_client_protocol::Error>(())
            })
            .await;

        match res {
            Ok(()) => {
                let _ = on_event_for_close.send(AgentEvent::Closed {
                    session_id: close_session_id,
                });
            }
            Err(e) => {
                let _ = on_event_for_close.send(AgentEvent::Error {
                    session_id: close_session_id,
                    message: e.to_string(),
                });
            }
        }
    });

    {
        let mut map = state
            .sessions
            .lock()
            .map_err(|e| format!("agent state poisoned: {e}"))?;
        map.insert(
            session_id.clone(),
            SessionHandle {
                cmd_tx,
                pending_perms,
                abort: driver.abort_handle(),
            },
        );
    }

    let _ = backend; // suppress unused warning in case of future trimming
    Ok(session_id)
}

pub async fn send_prompt(
    state: tauri::State<'_, AgentsState>,
    session_id: &str,
    text: String,
) -> Result<(), String> {
    let tx = {
        let map = state
            .sessions
            .lock()
            .map_err(|e| format!("agent state poisoned: {e}"))?;
        let h = map
            .get(session_id)
            .ok_or_else(|| format!("no agent session: {session_id}"))?;
        h.cmd_tx.clone()
    };
    tx.send(Command::Prompt(text))
        .map_err(|_| "agent session is no longer accepting prompts".to_string())
}

pub async fn cancel(
    state: tauri::State<'_, AgentsState>,
    session_id: &str,
) -> Result<(), String> {
    let tx = {
        let map = state
            .sessions
            .lock()
            .map_err(|e| format!("agent state poisoned: {e}"))?;
        let h = map
            .get(session_id)
            .ok_or_else(|| format!("no agent session: {session_id}"))?;
        h.cmd_tx.clone()
    };
    let _ = tx.send(Command::Cancel);
    Ok(())
}

pub async fn close(
    state: tauri::State<'_, AgentsState>,
    session_id: &str,
) -> Result<(), String> {
    let handle = {
        let mut map = state
            .sessions
            .lock()
            .map_err(|e| format!("agent state poisoned: {e}"))?;
        map.remove(session_id)
    };
    if let Some(h) = handle {
        let _ = h.cmd_tx.send(Command::Close);
        // If the driver is wedged, kill it after a short grace.
        h.abort.abort();
    }
    Ok(())
}

pub async fn respond_to_permission(
    state: tauri::State<'_, AgentsState>,
    session_id: &str,
    request_id: &str,
    option_id: Option<String>,
    cancelled: bool,
) -> Result<(), String> {
    let perms = {
        let map = state
            .sessions
            .lock()
            .map_err(|e| format!("agent state poisoned: {e}"))?;
        let h = map
            .get(session_id)
            .ok_or_else(|| format!("no agent session: {session_id}"))?;
        h.pending_perms.clone()
    };
    let responder = {
        let mut g = perms.lock().await;
        g.remove(request_id)
            .ok_or_else(|| format!("no pending permission request {request_id}"))?
    };
    let outcome = match (cancelled, option_id) {
        (true, _) | (_, None) => RequestPermissionOutcome::Cancelled,
        (false, Some(id)) => RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(PermissionOptionId::from(id)),
        ),
    };
    responder
        .respond(RequestPermissionResponse::new(outcome))
        .map_err(|e| e.to_string())
}

// ---------- ACP → AgentEvent translation ----------

fn translate_session_update(
    session_id: &str,
    notif: SessionNotification,
) -> Vec<AgentEvent> {
    match notif.update {
        SessionUpdate::AgentMessageChunk(chunk) => vec![AgentEvent::AssistantChunk {
            session_id: session_id.to_string(),
            text: content_chunk_text(&chunk),
        }],
        SessionUpdate::AgentThoughtChunk(chunk) => vec![AgentEvent::ReasoningChunk {
            session_id: session_id.to_string(),
            text: content_chunk_text(&chunk),
        }],
        SessionUpdate::UserMessageChunk(_) => vec![],
        SessionUpdate::ToolCall(tc) => vec![AgentEvent::ToolCall {
            session_id: session_id.to_string(),
            call: snapshot_tool_call(&tc),
        }],
        SessionUpdate::ToolCallUpdate(u) => vec![translate_tool_call_update(session_id, u)],
        SessionUpdate::Plan(plan) => vec![AgentEvent::Plan {
            session_id: session_id.to_string(),
            entries: plan
                .entries
                .iter()
                .map(|e| PlanEntry {
                    content: e.content.clone(),
                    priority: format!("{:?}", e.priority).to_lowercase(),
                    status: format!("{:?}", e.status).to_lowercase(),
                })
                .collect(),
        }],
        // Other variants (CurrentModeUpdate, ConfigOptionUpdate, etc.) are
        // useful long-term but not required for Phase 1's UI parity.
        _ => vec![],
    }
}

fn translate_tool_call_update(session_id: &str, u: ToolCallUpdate) -> AgentEvent {
    let f = u.fields;
    AgentEvent::ToolCallUpdate {
        session_id: session_id.to_string(),
        call_id: u.tool_call_id.0.to_string(),
        status: f.status.map(|s| format!("{s:?}").to_lowercase()),
        title: f.title,
        content: f
            .content
            .map(|cs| cs.iter().map(snapshot_tool_call_content).collect()),
        locations: f.locations.map(|ls| {
            ls.iter()
                .map(|l| ToolCallLocation {
                    path: l.path.to_string_lossy().to_string(),
                    line: l.line,
                })
                .collect()
        }),
        raw_output: f.raw_output,
    }
}

fn snapshot_tool_call(tc: &ToolCall) -> ToolCallSnapshot {
    ToolCallSnapshot {
        id: tc.tool_call_id.0.to_string(),
        title: tc.title.clone(),
        kind: format!("{:?}", tc.kind).to_lowercase(),
        status: format!("{:?}", tc.status).to_lowercase(),
        content: tc.content.iter().map(snapshot_tool_call_content).collect(),
        locations: tc
            .locations
            .iter()
            .map(|l| ToolCallLocation {
                path: l.path.to_string_lossy().to_string(),
                line: l.line,
            })
            .collect(),
        raw_input: tc.raw_input.clone(),
        raw_output: tc.raw_output.clone(),
    }
}

fn snapshot_tool_call_content(c: &ToolCallContent) -> ToolCallContentPart {
    match c {
        ToolCallContent::Content(content) => ToolCallContentPart::Content {
            text: content_block_text(&content.content),
            mime_type: None,
        },
        ToolCallContent::Diff(d) => ToolCallContentPart::Diff {
            path: d.path.to_string_lossy().to_string(),
            old_text: d.old_text.clone(),
            new_text: d.new_text.clone(),
        },
        ToolCallContent::Terminal(t) => ToolCallContentPart::Terminal {
            terminal_id: t.terminal_id.0.to_string(),
        },
        // ACP `ToolCallContent` is non-exhaustive — surface unknown variants
        // as a placeholder text block so the UI can at least show "the agent
        // produced something" instead of dropping it silently.
        _ => ToolCallContentPart::Content {
            text: "[unsupported tool-call content variant]".to_string(),
            mime_type: None,
        },
    }
}

/// Build a snapshot from the partial fields shipped in `RequestPermissionRequest`.
/// Phase 1 surfaces title/kind/status if present and falls back to the raw id
/// so the UI always has *something* to render.
fn snapshot_tool_call_update(u: &ToolCallUpdate) -> ToolCallSnapshot {
    let f: &ToolCallUpdateFields = &u.fields;
    ToolCallSnapshot {
        id: u.tool_call_id.0.to_string(),
        title: f.title.clone().unwrap_or_else(|| u.tool_call_id.0.to_string()),
        kind: f
            .kind
            .as_ref()
            .map(|k| format!("{k:?}").to_lowercase())
            .unwrap_or_else(|| "other".to_string()),
        status: f
            .status
            .as_ref()
            .map(|s| format!("{s:?}").to_lowercase())
            .unwrap_or_else(|| "pending".to_string()),
        content: f
            .content
            .as_ref()
            .map(|cs| cs.iter().map(snapshot_tool_call_content).collect())
            .unwrap_or_default(),
        locations: f
            .locations
            .as_ref()
            .map(|ls| {
                ls.iter()
                    .map(|l| ToolCallLocation {
                        path: l.path.to_string_lossy().to_string(),
                        line: l.line,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        raw_input: f.raw_input.clone(),
        raw_output: f.raw_output.clone(),
    }
}

fn snapshot_permission_option(o: &PermissionOption) -> PermissionOptionSnapshot {
    PermissionOptionSnapshot {
        id: o.option_id.0.to_string(),
        label: o.name.clone(),
        kind: format!("{:?}", o.kind).to_lowercase(),
    }
}

fn content_chunk_text(chunk: &ContentChunk) -> String {
    content_block_text(&chunk.content)
}

fn content_block_text(b: &ContentBlock) -> String {
    match b {
        ContentBlock::Text(t) => t.text.clone(),
        ContentBlock::Image(_) => "[image]".to_string(),
        ContentBlock::Audio(_) => "[audio]".to_string(),
        ContentBlock::ResourceLink(r) => format!("[resource: {}]", r.uri),
        ContentBlock::Resource(_) => "[embedded resource]".to_string(),
        _ => String::new(),
    }
}

fn protocol_version_to_u32(v: &ProtocolVersion) -> u32 {
    // ProtocolVersion is non-exhaustive; map the variants we know and fall
    // back to 0 for anything new. Frontend treats 0 as "unknown" today.
    let s = format!("{v:?}");
    if let Some(rest) = s.strip_prefix('V') {
        rest.parse().unwrap_or(0)
    } else {
        0
    }
}
