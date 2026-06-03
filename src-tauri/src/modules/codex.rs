use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const TURN_TIMEOUT_SECS: u64 = 600;
const LOGIN_TIMEOUT_SECS: u64 = 600;
const STDERR_TAIL_LIMIT: usize = 64 * 1024;

#[derive(Serialize)]
pub struct CodexAuthStatus {
    pub logged_in: bool,
    pub detail: String,
}

#[derive(Serialize)]
pub struct CodexTurnOutput {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CodexStreamEvent {
    TextStart { id: String },
    TextDelta { id: String, delta: String },
    TextEnd { id: String },
    ReasoningStart { id: String },
    ReasoningDelta { id: String, delta: String },
    ReasoningEnd { id: String },
    Step { label: Option<String> },
    Done,
    Error { message: String },
}

#[tauri::command]
pub async fn codex_auth_status() -> Result<CodexAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(codex_auth_status_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_login_chatgpt() -> Result<CodexAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(codex_login_chatgpt_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_logout() -> Result<CodexAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(codex_logout_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_app_server_turn(
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    developer_instructions: Option<String>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<CodexTurnOutput, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("empty Codex prompt".into());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        return Err("Codex app-server provider supports local workspaces only for now.".into());
    }
    let cwd_path = authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;

    tauri::async_runtime::spawn_blocking(move || {
        codex_app_server_turn_blocking(prompt, cwd_path, model, developer_instructions)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_app_server_stream(
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    developer_instructions: Option<String>,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    on_event: Channel<CodexStreamEvent>,
) -> Result<(), String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        let message = "empty Codex prompt".to_string();
        let _ = on_event.send(CodexStreamEvent::Error {
            message: message.clone(),
        });
        return Err(message);
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_wsl() {
        let message =
            "Codex app-server provider supports local workspaces only for now.".to_string();
        let _ = on_event.send(CodexStreamEvent::Error {
            message: message.clone(),
        });
        return Err(message);
    }
    let cwd_path = match authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace) {
        Ok(path) => path,
        Err(e) => {
            let _ = on_event.send(CodexStreamEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    tauri::async_runtime::spawn_blocking(move || {
        codex_app_server_stream_blocking(prompt, cwd_path, model, developer_instructions, on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn codex_auth_status_blocking() -> Result<CodexAuthStatus, String> {
    let exe = resolve_codex_executable()?;
    let mut cmd = Command::new(exe);
    apply_codex_spawn_env(&mut cmd);
    let output = cmd
        .args(["login", "status"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to run codex login status: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stdout.is_empty() { stderr } else { stdout };
    Ok(CodexAuthStatus {
        logged_in: output.status.success() && detail.to_lowercase().contains("logged in"),
        detail,
    })
}

fn codex_login_chatgpt_blocking() -> Result<CodexAuthStatus, String> {
    let mut client = CodexAppServerClient::spawn(None)?;
    client.initialize()?;
    client.send(json!({
        "method": "account/login/start",
        "id": 1,
        "params": {
            "type": "chatgpt",
            "codexStreamlinedLogin": true
        }
    }))?;

    let deadline = Instant::now() + Duration::from_secs(LOGIN_TIMEOUT_SECS);
    let mut opened_url = false;

    loop {
        let msg = client.recv_until(deadline)?;
        if let Some(error) = json_rpc_error(&msg) {
            return Err(error);
        }
        if msg.get("id").and_then(Value::as_i64) == Some(1) {
            let Some(result) = msg.get("result") else {
                continue;
            };
            match result.get("type").and_then(Value::as_str) {
                Some("chatgpt") => {
                    if let Some(url) = result.get("authUrl").and_then(Value::as_str) {
                        open_external_url(url)?;
                        opened_url = true;
                    }
                }
                Some("chatgptDeviceCode") => {
                    if let Some(url) = result.get("verificationUrl").and_then(Value::as_str) {
                        open_external_url(url)?;
                        opened_url = true;
                    }
                }
                Some("apiKey") | Some("chatgptAuthTokens") => {
                    return codex_auth_status_blocking();
                }
                _ => {}
            }
            continue;
        }
        if msg.get("method").and_then(Value::as_str) == Some("account/login/completed") {
            return codex_auth_status_blocking();
        }
        if !opened_url && Instant::now() >= deadline {
            return Err("Codex login did not return an auth URL.".into());
        }
    }
}

fn codex_logout_blocking() -> Result<CodexAuthStatus, String> {
    let exe = resolve_codex_executable()?;
    let mut cmd = Command::new(exe);
    apply_codex_spawn_env(&mut cmd);
    let output = cmd
        .arg("logout")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to run codex logout: {e}"))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "codex logout failed".into()
        } else {
            detail
        });
    }
    codex_auth_status_blocking()
}

fn codex_app_server_turn_blocking(
    prompt: String,
    cwd: Option<PathBuf>,
    model: Option<String>,
    developer_instructions: Option<String>,
) -> Result<CodexTurnOutput, String> {
    let mut client = CodexAppServerClient::spawn(cwd.clone())?;
    client.initialize()?;

    let mut thread_params = json!({
        "cwd": cwd.as_ref().map(|p| p.to_string_lossy().to_string()),
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "ephemeral": true
    });
    if let Some(instructions) = developer_instructions
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        thread_params["developerInstructions"] = Value::String(instructions.to_string());
    }
    if let Some(model) = sanitize_codex_model(model) {
        thread_params["model"] = Value::String(model);
    }

    client.send(json!({
        "method": "thread/start",
        "id": 1,
        "params": thread_params
    }))?;

    let deadline = Instant::now() + Duration::from_secs(TURN_TIMEOUT_SECS);
    let mut text = String::new();

    loop {
        let msg = client.recv_until(deadline)?;
        if let Some(error) = json_rpc_error(&msg) {
            return Err(error);
        }

        if msg.get("id").and_then(Value::as_i64) == Some(1) {
            let thread_id = msg
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let Some(ref id) = thread_id else {
                return Err("Codex app-server did not return a thread id.".into());
            };
            client.send(json!({
                "method": "turn/start",
                "id": 2,
                "params": {
                    "threadId": id,
                    "input": [{
                        "type": "text",
                        "text": prompt,
                        "text_elements": []
                    }],
                    "approvalPolicy": "never",
                    "sandboxPolicy": {
                        "type": "readOnly",
                        "networkAccess": false
                    }
                }
            }))?;
            continue;
        }

        if msg.get("method").and_then(Value::as_str) == Some("item/agentMessage/delta") {
            if let Some(delta) = msg
                .get("params")
                .and_then(|p| p.get("delta"))
                .and_then(Value::as_str)
            {
                text.push_str(delta);
            }
            continue;
        }

        if msg.get("method").and_then(Value::as_str) == Some("turn/completed") {
            return Ok(CodexTurnOutput { text });
        }
    }
}

fn codex_app_server_stream_blocking(
    prompt: String,
    cwd: Option<PathBuf>,
    model: Option<String>,
    developer_instructions: Option<String>,
    on_event: Channel<CodexStreamEvent>,
) -> Result<(), String> {
    let result =
        codex_app_server_stream_inner(prompt, cwd, model, developer_instructions, &on_event);
    match result {
        Ok(()) => Ok(()),
        Err(e) if e == "Codex stream was closed." => Ok(()),
        Err(e) => {
            let _ = on_event.send(CodexStreamEvent::Error { message: e.clone() });
            Err(e)
        }
    }
}

fn codex_app_server_stream_inner(
    prompt: String,
    cwd: Option<PathBuf>,
    model: Option<String>,
    developer_instructions: Option<String>,
    on_event: &Channel<CodexStreamEvent>,
) -> Result<(), String> {
    send_codex_event(
        on_event,
        CodexStreamEvent::Step {
            label: Some("Starting Codex".to_string()),
        },
    )?;

    let mut client = CodexAppServerClient::spawn(cwd.clone())?;
    client.initialize()?;

    let mut thread_params = json!({
        "cwd": cwd.as_ref().map(|p| p.to_string_lossy().to_string()),
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "ephemeral": true
    });
    if let Some(instructions) = developer_instructions
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        thread_params["developerInstructions"] = Value::String(instructions.to_string());
    }
    if let Some(model) = sanitize_codex_model(model) {
        thread_params["model"] = Value::String(model);
    }

    client.send(json!({
        "method": "thread/start",
        "id": 1,
        "params": thread_params
    }))?;

    let deadline = Instant::now() + Duration::from_secs(TURN_TIMEOUT_SECS);
    let mut text_items = HashSet::<String>::new();
    let mut reasoning_items = HashSet::<String>::new();
    let mut reasoning_text = HashMap::<String, String>::new();

    loop {
        let msg = client.recv_until(deadline)?;
        if let Some(error) = json_rpc_error(&msg) {
            return Err(error);
        }

        if msg.get("id").and_then(Value::as_i64) == Some(1) {
            let thread_id = msg
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let Some(ref id) = thread_id else {
                return Err("Codex app-server did not return a thread id.".into());
            };
            send_codex_event(
                on_event,
                CodexStreamEvent::Step {
                    label: Some("Thinking".to_string()),
                },
            )?;
            client.send(json!({
                "method": "turn/start",
                "id": 2,
                "params": {
                    "threadId": id,
                    "input": [{
                        "type": "text",
                        "text": prompt,
                        "text_elements": []
                    }],
                    "approvalPolicy": "never",
                    "sandboxPolicy": {
                        "type": "readOnly",
                        "networkAccess": false
                    }
                }
            }))?;
            continue;
        }

        match msg.get("method").and_then(Value::as_str) {
            Some("item/started") => {
                if let Some(item) = msg.get("params").and_then(|p| p.get("item")) {
                    handle_codex_item_started(
                        item,
                        on_event,
                        &mut text_items,
                        &mut reasoning_items,
                        &mut reasoning_text,
                    )?;
                }
            }
            Some("item/agentMessage/delta") => {
                let item_id = msg
                    .get("params")
                    .and_then(|p| p.get("itemId"))
                    .and_then(Value::as_str)
                    .unwrap_or("codex-text")
                    .to_string();
                if text_items.insert(item_id.clone()) {
                    send_codex_event(
                        on_event,
                        CodexStreamEvent::TextStart {
                            id: item_id.clone(),
                        },
                    )?;
                }
                if let Some(delta) = msg
                    .get("params")
                    .and_then(|p| p.get("delta"))
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                {
                    send_codex_event(
                        on_event,
                        CodexStreamEvent::TextDelta {
                            id: item_id,
                            delta: delta.to_string(),
                        },
                    )?;
                }
            }
            Some("item/completed") => {
                if let Some(item) = msg.get("params").and_then(|p| p.get("item")) {
                    handle_codex_item_completed(
                        item,
                        on_event,
                        &mut text_items,
                        &mut reasoning_items,
                        &mut reasoning_text,
                    )?;
                }
            }
            Some("turn/completed") => {
                for id in text_items.drain() {
                    send_codex_event(on_event, CodexStreamEvent::TextEnd { id })?;
                }
                for id in reasoning_items.drain() {
                    send_codex_event(on_event, CodexStreamEvent::ReasoningEnd { id })?;
                }
                send_codex_event(on_event, CodexStreamEvent::Step { label: None })?;
                send_codex_event(on_event, CodexStreamEvent::Done)?;
                return Ok(());
            }
            Some("turn/failed") => {
                return Err(codex_failure_message(&msg));
            }
            _ => {}
        }
    }
}

fn handle_codex_item_started(
    item: &Value,
    on_event: &Channel<CodexStreamEvent>,
    text_items: &mut HashSet<String>,
    reasoning_items: &mut HashSet<String>,
    reasoning_text: &mut HashMap<String, String>,
) -> Result<(), String> {
    match item.get("type").and_then(Value::as_str) {
        Some("agentMessage") => {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                if text_items.insert(id.to_string()) {
                    send_codex_event(on_event, CodexStreamEvent::TextStart { id: id.to_string() })?;
                }
            }
            send_codex_event(
                on_event,
                CodexStreamEvent::Step {
                    label: Some("Writing".to_string()),
                },
            )?;
        }
        Some("reasoning") => {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                if reasoning_items.insert(id.to_string()) {
                    send_codex_event(
                        on_event,
                        CodexStreamEvent::ReasoningStart { id: id.to_string() },
                    )?;
                }
                send_reasoning_delta(id, item, on_event, reasoning_text)?;
            }
            send_codex_event(
                on_event,
                CodexStreamEvent::Step {
                    label: Some("Thinking".to_string()),
                },
            )?;
        }
        Some("commandExecution") => {
            let command = item
                .get("command")
                .and_then(Value::as_str)
                .map(short_command_label)
                .unwrap_or_else(|| "Running command".to_string());
            send_codex_event(
                on_event,
                CodexStreamEvent::Step {
                    label: Some(command),
                },
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn handle_codex_item_completed(
    item: &Value,
    on_event: &Channel<CodexStreamEvent>,
    text_items: &mut HashSet<String>,
    reasoning_items: &mut HashSet<String>,
    reasoning_text: &mut HashMap<String, String>,
) -> Result<(), String> {
    match item.get("type").and_then(Value::as_str) {
        Some("agentMessage") => {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                if text_items.remove(id) {
                    send_codex_event(on_event, CodexStreamEvent::TextEnd { id: id.to_string() })?;
                }
            }
        }
        Some("reasoning") => {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                send_reasoning_delta(id, item, on_event, reasoning_text)?;
                if reasoning_items.remove(id) {
                    send_codex_event(
                        on_event,
                        CodexStreamEvent::ReasoningEnd { id: id.to_string() },
                    )?;
                }
            }
            send_codex_event(
                on_event,
                CodexStreamEvent::Step {
                    label: Some("Thinking".to_string()),
                },
            )?;
        }
        Some("commandExecution") => {
            send_codex_event(
                on_event,
                CodexStreamEvent::Step {
                    label: Some("Thinking".to_string()),
                },
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn send_reasoning_delta(
    id: &str,
    item: &Value,
    on_event: &Channel<CodexStreamEvent>,
    reasoning_text: &mut HashMap<String, String>,
) -> Result<(), String> {
    let next = reasoning_text_from_item(item);
    if next.is_empty() {
        return Ok(());
    }
    let previous = reasoning_text.get(id).cloned().unwrap_or_default();
    let delta = next
        .strip_prefix(&previous)
        .map(str::to_string)
        .unwrap_or_else(|| next.clone());
    if delta.is_empty() {
        return Ok(());
    }
    reasoning_text.insert(id.to_string(), next);
    send_codex_event(
        on_event,
        CodexStreamEvent::ReasoningDelta {
            id: id.to_string(),
            delta,
        },
    )
}

fn reasoning_text_from_item(item: &Value) -> String {
    let mut parts = Vec::new();
    collect_text_fields(item.get("summary"), &mut parts);
    collect_text_fields(item.get("content"), &mut parts);
    parts
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn collect_text_fields(value: Option<&Value>, out: &mut Vec<String>) {
    match value {
        Some(Value::String(s)) => out.push(s.clone()),
        Some(Value::Array(items)) => {
            for item in items {
                collect_text_fields(Some(item), out);
            }
        }
        Some(Value::Object(map)) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                out.push(text.to_string());
            } else {
                for value in map.values() {
                    collect_text_fields(Some(value), out);
                }
            }
        }
        _ => {}
    }
}

fn short_command_label(command: &str) -> String {
    let compact = command.split_whitespace().collect::<Vec<_>>().join(" ");
    let shown = if compact.chars().count() > 60 {
        let mut s = compact.chars().take(59).collect::<String>();
        s.push_str("...");
        s
    } else {
        compact
    };
    format!("Running {shown}")
}

fn send_codex_event(
    on_event: &Channel<CodexStreamEvent>,
    event: CodexStreamEvent,
) -> Result<(), String> {
    on_event
        .send(event)
        .map_err(|_| "Codex stream was closed.".to_string())
}

fn codex_failure_message(msg: &Value) -> String {
    msg.get("params")
        .and_then(|p| p.get("error"))
        .and_then(Value::as_str)
        .or_else(|| {
            msg.get("params")
                .and_then(|p| p.get("turn"))
                .and_then(|t| t.get("error"))
                .and_then(Value::as_str)
        })
        .unwrap_or("Codex turn failed.")
        .to_string()
}

fn sanitize_codex_model(model: Option<String>) -> Option<String> {
    model
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty() && !m.chars().any(char::is_control))
}

struct CodexAppServerClient {
    stdin: std::process::ChildStdin,
    lines: mpsc::Receiver<Result<String, String>>,
    stderr: mpsc::Receiver<String>,
    child: std::process::Child,
}

impl CodexAppServerClient {
    fn spawn(cwd: Option<PathBuf>) -> Result<Self, String> {
        let exe = resolve_codex_executable()?;
        let mut cmd = Command::new(exe);
        cmd.arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        apply_codex_spawn_env(&mut cmd);
        crate::modules::proc::hide_console(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to start codex app-server: {e}"))?;
        let stdin = child.stdin.take().ok_or_else(|| {
            let _ = child.kill();
            "Codex app-server stdin was unavailable.".to_string()
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            let _ = child.kill();
            "Codex app-server stdout was unavailable.".to_string()
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            let _ = child.kill();
            "Codex app-server stderr was unavailable.".to_string()
        })?;

        let (line_tx, lines) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if line_tx.send(Ok(line)).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = line_tx.send(Err(e.to_string()));
                        break;
                    }
                }
            }
        });

        let (stderr_tx, stderr_rx) = mpsc::channel();
        thread::spawn(move || {
            let mut tail = String::new();
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                tail.push_str(&line);
                tail.push('\n');
                if tail.len() > STDERR_TAIL_LIMIT {
                    let drain = tail.len() - STDERR_TAIL_LIMIT;
                    tail.drain(..drain);
                }
            }
            let _ = stderr_tx.send(tail);
        });

        Ok(Self {
            stdin,
            lines,
            stderr: stderr_rx,
            child,
        })
    }

    fn initialize(&mut self) -> Result<(), String> {
        self.send(json!({
            "method": "initialize",
            "id": 0,
            "params": {
                "clientInfo": {
                    "name": "terax",
                    "title": "Terax",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true
                }
            }
        }))?;
        self.send(json!({ "method": "initialized", "params": {} }))?;

        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let msg = self.recv_until(deadline)?;
            if let Some(error) = json_rpc_error(&msg) {
                return Err(error);
            }
            if msg.get("id").and_then(Value::as_i64) == Some(0) {
                return Ok(());
            }
        }
    }

    fn send(&mut self, value: Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, &value)
            .map_err(|e| format!("failed to encode Codex app-server message: {e}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("failed to write to Codex app-server: {e}"))
    }

    fn recv_until(&mut self, deadline: Instant) -> Result<Value, String> {
        loop {
            let now = Instant::now();
            if now >= deadline {
                let _ = self.child.kill();
                let stderr = self.stderr.try_recv().unwrap_or_default();
                return Err(if stderr.trim().is_empty() {
                    "Timed out waiting for Codex app-server.".into()
                } else {
                    format!("Timed out waiting for Codex app-server:\n{}", stderr.trim())
                });
            }
            let timeout = deadline
                .saturating_duration_since(now)
                .min(Duration::from_secs(1));
            match self.lines.recv_timeout(timeout) {
                Ok(Ok(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    return serde_json::from_str::<Value>(&line).map_err(|e| {
                        format!("Codex app-server returned invalid JSON: {e}\n{line}")
                    });
                }
                Ok(Err(e)) => return Err(format!("failed to read Codex app-server output: {e}")),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(status)) = self.child.try_wait() {
                        let stderr = self.stderr.try_recv().unwrap_or_default();
                        return Err(if stderr.trim().is_empty() {
                            format!("Codex app-server exited with status {status}.")
                        } else {
                            format!(
                                "Codex app-server exited with status {status}:\n{}",
                                stderr.trim()
                            )
                        });
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let stderr = self.stderr.try_recv().unwrap_or_default();
                    return Err(if stderr.trim().is_empty() {
                        "Codex app-server output stream closed.".into()
                    } else {
                        format!("Codex app-server output stream closed:\n{}", stderr.trim())
                    });
                }
            }
        }
    }
}

impl Drop for CodexAppServerClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn json_rpc_error(msg: &Value) -> Option<String> {
    let error = msg.get("error")?;
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Codex app-server error");
    let code = error.get("code").and_then(Value::as_i64);
    Some(match code {
        Some(code) => format!("Codex app-server error {code}: {message}"),
        None => format!("Codex app-server error: {message}"),
    })
}

fn resolve_codex_executable() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_EXECUTABLE").map(PathBuf::from) {
        if is_executable_file(&path) {
            return Ok(path);
        }
    }

    if let Some(path) = find_in_path("codex") {
        return Ok(path);
    }

    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
        PathBuf::from("/usr/bin/codex"),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".codex/bin/codex"));
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
        candidates.push(home.join("Library/pnpm/codex"));
    }
    for path in candidates {
        if is_executable_file(&path) {
            return Ok(path);
        }
    }

    if let Ok(path) = resolve_with_login_shell() {
        if is_executable_file(&path) {
            return Ok(path);
        }
    }

    Err(
        "Codex CLI was not found. Install Codex or set CODEX_EXECUTABLE to the codex binary path."
            .into(),
    )
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let path = dir.join(binary);
        if is_executable_file(&path) {
            return Some(path);
        }
    }
    None
}

fn resolve_with_login_shell() -> Result<PathBuf, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell)
        .args(["-lc", "command -v codex"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("login shell could not find codex".into());
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if path.is_empty() {
        return Err("login shell returned an empty codex path".into());
    }
    Ok(PathBuf::from(path))
}

fn apply_codex_spawn_env(cmd: &mut Command) {
    if let Some(path) = codex_spawn_path() {
        cmd.env("PATH", path);
    }
}

fn codex_spawn_path() -> Option<OsString> {
    static PATH: OnceLock<Option<OsString>> = OnceLock::new();
    PATH.get_or_init(build_codex_spawn_path).clone()
}

fn build_codex_spawn_path() -> Option<OsString> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    if let Ok(path) = login_shell_path() {
        paths.extend(std::env::split_paths(&OsString::from(path)));
    }
    dedupe_paths(&mut paths);
    std::env::join_paths(paths).ok()
}

fn dedupe_paths(paths: &mut Vec<PathBuf>) {
    let mut seen = std::collections::HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
}

fn login_shell_path() -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("login shell did not return PATH".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn is_executable_file(path: &PathBuf) -> bool {
    path.is_file()
}

fn open_external_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", url]);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    };

    crate::modules::proc::hide_console(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to open Codex login URL: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_reasoning_text_from_summary_and_content() {
        let item = json!({
            "type": "reasoning",
            "id": "rs_1",
            "summary": [
                { "type": "summary_text", "text": "Checked the request." }
            ],
            "content": [
                { "type": "reasoning_text", "text": "Prepared the response." }
            ]
        });

        assert_eq!(
            reasoning_text_from_item(&item),
            "Checked the request.\nPrepared the response."
        );
    }

    #[test]
    fn empty_reasoning_item_has_no_text() {
        let item = json!({
            "type": "reasoning",
            "id": "rs_1",
            "summary": [],
            "content": []
        });

        assert_eq!(reasoning_text_from_item(&item), "");
    }
}
