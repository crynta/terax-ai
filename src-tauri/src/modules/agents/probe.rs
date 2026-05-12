//! Connection probe for the External Agents settings UI.
//!
//! Spawns the backend the same way `runtime::start_acp_session` would
//! (same env-stripping, same keychain-injected auth) but only walks the
//! ACP handshake far enough to prove the binary launches, the protocol
//! version negotiates, and `session/new` succeeds. Anything past that —
//! prompts, tool calls, permissions — needs a real chat session and
//! isn't useful as a quick diagnostic.
//!
//! Emits a structured `ProbeResult` so the UI can show what specifically
//! failed (binary missing? exited early? auth method needed? timed out?)
//! instead of the generic "Something went wrong" the Chat surface
//! produces today.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

use super::backend::{self, BackendId};
use super::detection;
use super::runtime::{KEYRING_SERVICE, POISON_VARS};
use crate::modules::secrets::{read_secret, SecretsState};

#[derive(Serialize)]
pub struct ProbeResult {
    pub ok: bool,
    pub backend_id: String,
    pub binary_path: Option<String>,
    pub agent_name: Option<String>,
    pub agent_version: Option<String>,
    pub protocol_version: Option<u64>,
    pub session_id: Option<String>,
    /// Auth methods the agent advertised at `initialize`. Non-empty
    /// usually means "you need to log in" — surface in the UI.
    pub auth_methods: Vec<String>,
    /// Stripped `CLAUDE_*` / `CLAUDECODE` vars we removed from the spawn
    /// env, for debugging "why does the test pass but Terax fails" cases.
    pub stripped_env: Vec<String>,
    /// Env-var names we successfully forwarded from the keychain
    /// (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, …). Empty means
    /// "no Terax-managed auth — the agent must use its own login flow."
    pub forwarded_auth: Vec<String>,
    /// `HTTP_PROXY` / `HTTPS_PROXY` values present in the spawn env, plus
    /// whether each one's TCP endpoint is reachable. The shim inherits
    /// these — if the proxy is configured but down we get ECONNREFUSED
    /// when the agent tries to call api.anthropic.com.
    pub proxies: Vec<ProxyCheck>,
    /// Result of sending a tiny real prompt. `None` when caller asked for
    /// `with_prompt: false` (cheap mode), `Some` otherwise. A successful
    /// prompt is the strongest evidence the full chat path works.
    pub prompt: Option<PromptCheck>,
    pub error: Option<String>,
    pub stderr: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Serialize)]
pub struct ProxyCheck {
    pub var: String,
    pub value: String,
    pub reachable: Option<bool>,
}

#[derive(Serialize)]
pub struct PromptCheck {
    pub ok: bool,
    pub stop_reason: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn agent_backend_test(
    app: AppHandle,
    backend_id: String,
    cwd: Option<String>,
    with_prompt: Option<bool>,
) -> Result<ProbeResult, String> {
    let started = std::time::Instant::now();
    let backend = BackendId::parse(&backend_id)
        .map(backend::get)
        .ok_or_else(|| format!("unknown backend: {backend_id}"))?;
    let with_prompt = with_prompt.unwrap_or(false);

    let mut result = ProbeResult {
        ok: false,
        backend_id: backend.id.as_str().to_string(),
        binary_path: None,
        agent_name: None,
        agent_version: None,
        protocol_version: None,
        session_id: None,
        auth_methods: Vec::new(),
        stripped_env: Vec::new(),
        forwarded_auth: Vec::new(),
        proxies: probe_proxies().await,
        prompt: None,
        error: None,
        stderr: None,
        elapsed_ms: 0,
    };

    let bin_path = match detection::resolve(backend) {
        Some(p) => p,
        None => {
            result.error = Some(format!(
                "{} not found on $PATH (looked for: {}). Install: `{}`",
                backend.label,
                backend.binaries.join(", "),
                backend.install_hint,
            ));
            result.elapsed_ms = started.elapsed().as_millis();
            return Ok(result);
        }
    };
    result.binary_path = Some(bin_path.clone());

    // Mirror runtime::start_acp_session exactly so a passing probe means
    // the real session-start codepath also passes.
    let mut cmd = Command::new(&bin_path);
    for arg in backend.args {
        cmd.arg(arg);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for var in POISON_VARS {
        if std::env::var_os(var).is_some() {
            result.stripped_env.push((*var).to_string());
        }
        cmd.env_remove(var);
    }

    if !backend.auth_envs.is_empty() {
        let secrets = app
            .try_state::<SecretsState>()
            .ok_or_else(|| "secrets state not registered".to_string())?;
        for entry in backend.auth_envs {
            match read_secret(&app, secrets.inner(), KEYRING_SERVICE, entry.account)? {
                Some(v) if !v.is_empty() => {
                    cmd.env(entry.env_name, v);
                    result.forwarded_auth.push(entry.env_name.to_string());
                }
                _ => {
                    cmd.env_remove(entry.env_name);
                }
            }
        }
    }

    let cwd_pb: PathBuf = cwd
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("/"));

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            result.error = Some(format!("failed to spawn {}: {e}", backend.label));
            result.elapsed_ms = started.elapsed().as_millis();
            return Ok(result);
        }
    };

    let mut stdin = child.stdin.take().expect("piped");
    let stdout = child.stdout.take().expect("piped");
    let stderr = child.stderr.take().expect("piped");

    // Drain stderr into a buffer in the background. Cap the size so a
    // chatty agent can't blow up our memory.
    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut collected = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            if collected.len() < 8 * 1024 {
                if !collected.is_empty() {
                    collected.push('\n');
                }
                collected.push_str(&line);
            }
        }
        collected
    });

    // Drive the handshake: initialize → session/new, then optionally a
    // real (cheap) prompt if the caller asked for it. We keep state across
    // steps because session/prompt depends on the session_id we get back
    // from session/new.
    let init = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": 1 }
    });
    let new_session = serde_json::json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/new",
        "params": { "cwd": cwd_pb.to_string_lossy(), "mcpServers": [] }
    });
    let payload = format!("{init}\n{new_session}\n");
    if let Err(e) = stdin.write_all(payload.as_bytes()).await {
        result.error = Some(format!("failed to write to stdin: {e}"));
    }

    let mut reader = BufReader::new(stdout).lines();
    let mut prompt_sent = false;

    let drive_fut = async {
        let mut got_init = false;
        let mut got_session = false;
        let mut got_prompt = !with_prompt;
        while !(got_init && got_session && got_prompt) {
            let line = match reader.next_line().await {
                Ok(Some(l)) => l,
                _ => break,
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let id = v.get("id").and_then(|x| x.as_u64());
            match id {
                Some(1) => {
                    got_init = true;
                    if let Some(err) = v.get("error") {
                        result.error = Some(format!("initialize error: {err}"));
                        break;
                    }
                    let r = v.get("result");
                    result.protocol_version =
                        r.and_then(|x| x.get("protocolVersion")).and_then(|x| x.as_u64());
                    if let Some(info) = r.and_then(|x| x.get("agentInfo")) {
                        result.agent_name =
                            info.get("name").and_then(|x| x.as_str()).map(str::to_string);
                        result.agent_version = info
                            .get("version")
                            .and_then(|x| x.as_str())
                            .map(str::to_string);
                    }
                    if let Some(arr) =
                        r.and_then(|x| x.get("authMethods")).and_then(|x| x.as_array())
                    {
                        result.auth_methods = arr
                            .iter()
                            .filter_map(|m| m.get("id").and_then(|x| x.as_str()))
                            .map(str::to_string)
                            .collect();
                    }
                }
                Some(2) => {
                    got_session = true;
                    if let Some(err) = v.get("error") {
                        result.error = Some(format!("session/new error: {err}"));
                        break;
                    }
                    let sid = v
                        .get("result")
                        .and_then(|x| x.get("sessionId"))
                        .and_then(|x| x.as_str())
                        .map(str::to_string);
                    result.session_id = sid.clone();

                    if with_prompt && !prompt_sent {
                        if let Some(sid) = sid {
                            let prompt = serde_json::json!({
                                "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
                                "params": {
                                    "sessionId": sid,
                                    "prompt": [{"type": "text",
                                                "text": "Reply with a single short word."}],
                                }
                            });
                            let _ = stdin
                                .write_all(format!("{prompt}\n").as_bytes())
                                .await;
                            prompt_sent = true;
                        } else {
                            // No session id → can't prompt. Mark prompt
                            // step done with a clear error.
                            result.prompt = Some(PromptCheck {
                                ok: false,
                                stop_reason: None,
                                error: Some(
                                    "session/new returned no sessionId".to_string(),
                                ),
                            });
                            got_prompt = true;
                        }
                    }
                }
                Some(3) => {
                    got_prompt = true;
                    if let Some(err) = v.get("error") {
                        result.prompt = Some(PromptCheck {
                            ok: false,
                            stop_reason: None,
                            error: Some(err.to_string()),
                        });
                    } else {
                        let stop_reason = v
                            .get("result")
                            .and_then(|x| x.get("stopReason"))
                            .and_then(|x| x.as_str())
                            .map(str::to_string);
                        result.prompt = Some(PromptCheck {
                            ok: true,
                            stop_reason,
                            error: None,
                        });
                    }
                }
                _ => {
                    // session/update notifications etc. — ignore.
                }
            }
        }
    };

    let timeout_secs = if with_prompt { 60 } else { 15 };
    if timeout(Duration::from_secs(timeout_secs), drive_fut)
        .await
        .is_err()
        && result.error.is_none()
    {
        result.error = Some(format!(
            "agent did not finish handshake within {timeout_secs}s"
        ));
        if with_prompt && result.prompt.is_none() {
            result.prompt = Some(PromptCheck {
                ok: false,
                stop_reason: None,
                error: Some(format!("prompt timed out after {timeout_secs}s")),
            });
        }
    }

    drop(stdin);
    let _ = child.start_kill();
    let _ = child.wait().await;
    if let Ok(s) = stderr_handle.await {
        if !s.is_empty() {
            result.stderr = Some(s);
        }
    }

    let session_ok = result.session_id.is_some();
    let prompt_ok = result.prompt.as_ref().is_none_or(|p| p.ok);
    result.ok = result.error.is_none() && session_ok && prompt_ok;
    result.elapsed_ms = started.elapsed().as_millis();
    Ok(result)
}

/// Capture `HTTP_PROXY` / `HTTPS_PROXY` from the host env and TCP-probe
/// each. The most common cause of an ECONNREFUSED at API-call time is a
/// proxy var pointing to a port that isn't currently listening (clash /
/// v2ray / corporate proxy that's been stopped).
async fn probe_proxies() -> Vec<ProxyCheck> {
    let mut out = Vec::new();
    for name in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        let Ok(val) = std::env::var(name) else { continue };
        if val.is_empty() {
            continue;
        }
        out.push(ProxyCheck {
            var: name.to_string(),
            value: val.clone(),
            reachable: tcp_probe(&val).await,
        });
    }
    out
}

async fn tcp_probe(url: &str) -> Option<bool> {
    use tokio::net::TcpStream;
    // Strip scheme then split host:port. Best-effort — if we can't parse,
    // return None so the UI shows "?" instead of asserting.
    let after_scheme = url.split_once("://").map(|p| p.1).unwrap_or(url);
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok()?),
        None => return None,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match timeout(Duration::from_secs(2), TcpStream::connect((host, port))).await {
        Ok(Ok(_)) => Some(true),
        Ok(Err(_)) | Err(_) => Some(false),
    }
}
