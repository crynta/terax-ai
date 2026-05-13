use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};
use tauri::ipc::Channel;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountState {
    pub auth_mode: Option<String>,
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub requires_openai_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStart {
    #[serde(rename = "type")]
    pub login_type: String,
    pub login_id: Option<String>,
    pub auth_url: Option<String>,
    pub verification_url: Option<String>,
    pub user_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CodexStreamEvent {
    AgentMessageStart { item_id: String },
    AgentMessageDelta { item_id: String, delta: String },
    AgentMessageEnd { item_id: String },
    ReasoningStart { item_id: String },
    ReasoningDelta { item_id: String, delta: String },
    ReasoningEnd { item_id: String },
    End,
    Error { message: String },
}

#[tauri::command]
pub async fn codex_account_read(refresh_token: Option<bool>) -> Result<CodexAccountState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = call_codex_app_server(
            "account/read",
            json!({ "refreshToken": refresh_token.unwrap_or(false) }),
        )?;
        parse_account_read(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_login_start(device_code: Option<bool>) -> Result<CodexLoginStart, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let params = if device_code.unwrap_or(false) {
            json!({ "type": "chatgptDeviceCode" })
        } else {
            json!({ "type": "chatgpt", "codexStreamlinedLogin": true })
        };
        let result = call_codex_app_server("account/login/start", params)?;
        parse_login_start(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_logout() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = call_codex_app_server("account/logout", Value::Null)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_chat_once(
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_codex_turn(&prompt, cwd.as_deref(), model.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_chat_stream(
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    on_event: Channel<CodexStreamEvent>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_codex_turn_stream(&prompt, cwd.as_deref(), model.as_deref(), on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn call_codex_app_server(method: &str, params: Value) -> Result<Value, String> {
    let mut child = Command::new("codex")
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start `codex app-server`: {e}"))?;

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to capture codex app-server stdout".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to capture codex app-server stderr".to_string());
        }
    };

    let (tx, rx) = mpsc::channel::<Result<Value, String>>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(e) => {
                    let _ = tx.send(Err(format!("Failed reading codex app-server: {e}")));
                    return;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => {
                    let _ = tx.send(Ok(value));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Invalid codex app-server JSON: {e}")));
                    return;
                }
            }
        }
    });

    let (err_tx, err_rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut out = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&line);
        }
        let _ = err_tx.send(out);
    });

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open codex app-server stdin".to_string())?;
    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "terax",
                    "title": "Terax",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "experimentalApi": true }
            }
        }),
    )?;

    loop {
        let message = rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|_| "Timed out waiting for codex app-server".to_string())??;
        if message.get("id").and_then(Value::as_i64) == Some(1) {
            parse_json_rpc_response(message)?;
            break;
        }
    }

    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": method,
            "params": params
        }),
    )?;

    let result = loop {
        let message = rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|_| "Timed out waiting for codex app-server".to_string())??;
        if message.get("id").and_then(Value::as_i64) == Some(2) {
            break parse_json_rpc_response(message);
        }
    };

    let _ = child.kill();
    let _ = child.wait();

    result.map_err(|e| {
        let stderr = err_rx.try_recv().unwrap_or_default();
        if stderr.trim().is_empty() {
            e
        } else {
            format!("{e}: {}", stderr.trim())
        }
    })
}

fn run_codex_turn(prompt: &str, cwd: Option<&str>, model: Option<&str>) -> Result<String, String> {
    let mut child = Command::new("codex")
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start `codex app-server`: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture codex app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture codex app-server stderr".to_string())?;

    let (tx, rx) = mpsc::channel::<Result<Value, String>>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(e) => {
                    let _ = tx.send(Err(format!("Failed reading codex app-server: {e}")));
                    return;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => {
                    let _ = tx.send(Ok(value));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Invalid codex app-server JSON: {e}")));
                    return;
                }
            }
        }
    });

    let (err_tx, err_rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut out = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&line);
        }
        let _ = err_tx.send(out);
    });

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open codex app-server stdin".to_string())?;

    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "terax",
                    "title": "Terax",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": { "experimentalApi": true }
            }
        }),
    )?;
    wait_for_response(&rx, 1)?;

    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "account/read",
            "params": { "refreshToken": true }
        }),
    )?;
    let account = parse_account_read(wait_for_response(&rx, 2)?)?;
    if account.auth_mode.as_deref() != Some("chatgpt") {
        return Err(
            "Codex ChatGPT account is not connected. Open Settings -> Models -> Codex account."
                .to_string(),
        );
    }

    let actual_model = model.map(to_codex_model_id).unwrap_or("gpt-5.3-codex");
    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "thread/start",
            "params": {
                "cwd": cwd,
                "ephemeral": true,
                "model": actual_model,
                "modelProvider": "openai",
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "threadSource": "user",
                "sessionStartSource": "startup"
            }
        }),
    )?;
    let thread_id = parse_thread_start(wait_for_response(&rx, 3)?)?;

    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "cwd": cwd,
                "model": actual_model,
                "approvalPolicy": "never",
                "input": [
                    { "type": "text", "text": prompt }
                ]
            }
        }),
    )?;
    wait_for_response(&rx, 4)?;

    let mut answer = String::new();
    let result = loop {
        let message = rx
            .recv_timeout(Duration::from_secs(180))
            .map_err(|_| "Timed out waiting for Codex response".to_string())??;
        if let Some(delta) = agent_message_delta(&message) {
            answer.push_str(delta);
            continue;
        }
        if is_turn_completed(&message) {
            break Ok(answer);
        }
        if let Some(error) = error_notification(&message) {
            break Err(error);
        }
    };

    let _ = child.kill();
    let _ = child.wait();

    result.map_err(|e| {
        let stderr = err_rx.try_recv().unwrap_or_default();
        if stderr.trim().is_empty() {
            e
        } else {
            format!("{e}: {}", stderr.trim())
        }
    })
}

fn run_codex_turn_stream(
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    on_event: Channel<CodexStreamEvent>,
) -> Result<(), String> {
    let mut child = Command::new("codex")
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start `codex app-server`: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture codex app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture codex app-server stderr".to_string())?;

    let (tx, rx) = mpsc::channel::<Result<Value, String>>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(e) => {
                    let _ = tx.send(Err(format!("Failed reading codex app-server: {e}")));
                    return;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => {
                    let _ = tx.send(Ok(value));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Invalid codex app-server JSON: {e}")));
                    return;
                }
            }
        }
    });

    let (err_tx, err_rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut out = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&line);
        }
        let _ = err_tx.send(out);
    });

    let result = (|| -> Result<(), String> {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open codex app-server stdin".to_string())?;

        write_json_line(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "terax",
                        "title": "Terax",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": { "experimentalApi": true }
                }
            }),
        )?;
        wait_for_response(&rx, 1)?;

        write_json_line(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "account/read",
                "params": { "refreshToken": true }
            }),
        )?;
        let account = parse_account_read(wait_for_response(&rx, 2)?)?;
        if account.auth_mode.as_deref() != Some("chatgpt") {
            return Err(
                "Codex ChatGPT account is not connected. Open Settings -> Models -> Codex account."
                    .to_string(),
            );
        }

        let actual_model = model.map(to_codex_model_id).unwrap_or("gpt-5.3-codex");
        write_json_line(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "thread/start",
                "params": {
                    "cwd": cwd,
                    "ephemeral": true,
                    "model": actual_model,
                    "modelProvider": "openai",
                    "approvalPolicy": "never",
                    "sandbox": "read-only",
                    "threadSource": "user",
                    "sessionStartSource": "startup"
                }
            }),
        )?;
        let thread_id = parse_thread_start(wait_for_response(&rx, 3)?)?;

        write_json_line(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "turn/start",
                "params": {
                    "threadId": thread_id,
                    "cwd": cwd,
                    "model": actual_model,
                    "approvalPolicy": "never",
                    "effort": "medium",
                    "summary": "concise",
                    "input": [
                        { "type": "text", "text": prompt }
                    ]
                }
            }),
        )?;
        wait_for_response(&rx, 4)?;

        loop {
            let message = rx
                .recv_timeout(Duration::from_secs(180))
                .map_err(|_| "Timed out waiting for Codex response".to_string())??;
            if let Some(event) = codex_stream_event(&message) {
                if on_event.send(event).is_err() {
                    break Ok(());
                }
                continue;
            }
            if is_turn_completed(&message) {
                let _ = on_event.send(CodexStreamEvent::End);
                break Ok(());
            }
            if let Some(error) = error_notification(&message) {
                let _ = on_event.send(CodexStreamEvent::Error {
                    message: error.clone(),
                });
                break Err(error);
            }
        }
    })();

    let _ = child.kill();
    let _ = child.wait();

    result.map_err(|e| {
        let stderr = err_rx.try_recv().unwrap_or_default();
        if stderr.trim().is_empty() {
            e
        } else {
            format!("{e}: {}", stderr.trim())
        }
    })
}

fn wait_for_response(rx: &mpsc::Receiver<Result<Value, String>>, id: i64) -> Result<Value, String> {
    loop {
        let message = rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|_| format!("Timed out waiting for codex app-server response {id}"))??;
        if message.get("id").and_then(Value::as_i64) == Some(id) {
            return parse_json_rpc_response(message);
        }
    }
}

fn write_json_line(stdin: &mut std::process::ChildStdin, value: Value) -> Result<(), String> {
    let line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("Failed writing to codex app-server: {e}"))
}

fn parse_json_rpc_response(value: Value) -> Result<Value, String> {
    if let Some(error) = value.get("error") {
        return Err(error.to_string());
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| format!("codex app-server response missing result: {value}"))
}

fn parse_account_read(value: Value) -> Result<CodexAccountState, String> {
    let requires_openai_auth = value
        .get("requiresOpenaiAuth")
        .and_then(Value::as_bool)
        .ok_or_else(|| "account/read response missing requiresOpenaiAuth".to_string())?;
    let account = value.get("account").filter(|v| !v.is_null());
    Ok(CodexAccountState {
        auth_mode: account
            .and_then(|v| v.get("type"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        email: account
            .and_then(|v| v.get("email"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        plan_type: account
            .and_then(|v| v.get("planType"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        requires_openai_auth,
    })
}

fn parse_login_start(value: Value) -> Result<CodexLoginStart, String> {
    let login_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "account/login/start response missing type".to_string())?
        .to_string();
    Ok(CodexLoginStart {
        login_type,
        login_id: value
            .get("loginId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        auth_url: value
            .get("authUrl")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        verification_url: value
            .get("verificationUrl")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        user_code: value
            .get("userCode")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn parse_thread_start(value: Value) -> Result<String, String> {
    value
        .get("thread")
        .and_then(|v| v.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "thread/start response missing thread.id".to_string())
}

fn agent_message_delta(value: &Value) -> Option<&str> {
    if value.get("method").and_then(Value::as_str) != Some("item/agentMessage/delta") {
        return None;
    }
    value
        .get("params")
        .and_then(|v| v.get("delta"))
        .and_then(Value::as_str)
}

fn codex_stream_event(value: &Value) -> Option<CodexStreamEvent> {
    let method = value.get("method").and_then(Value::as_str)?;
    match method {
        "item/started" => item_lifecycle_event(value, true),
        "item/completed" => item_lifecycle_event(value, false),
        "item/agentMessage/delta" => {
            let params = value.get("params")?;
            Some(CodexStreamEvent::AgentMessageDelta {
                item_id: params
                    .get("itemId")
                    .and_then(Value::as_str)
                    .unwrap_or("codex-text")
                    .to_string(),
                delta: params.get("delta").and_then(Value::as_str)?.to_string(),
            })
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            let params = value.get("params")?;
            Some(CodexStreamEvent::ReasoningDelta {
                item_id: params
                    .get("itemId")
                    .and_then(Value::as_str)
                    .unwrap_or("codex-reasoning")
                    .to_string(),
                delta: params.get("delta").and_then(Value::as_str)?.to_string(),
            })
        }
        _ => None,
    }
}

fn item_lifecycle_event(value: &Value, started: bool) -> Option<CodexStreamEvent> {
    let item = value.get("params")?.get("item")?;
    let item_type = item.get("type").and_then(Value::as_str)?;
    let item_id = item.get("id").and_then(Value::as_str)?.to_string();
    match (item_type, started) {
        ("agentMessage", true) => Some(CodexStreamEvent::AgentMessageStart { item_id }),
        ("agentMessage", false) => Some(CodexStreamEvent::AgentMessageEnd { item_id }),
        ("reasoning", true) => Some(CodexStreamEvent::ReasoningStart { item_id }),
        ("reasoning", false) => Some(CodexStreamEvent::ReasoningEnd { item_id }),
        _ => None,
    }
}

fn is_turn_completed(value: &Value) -> bool {
    value.get("method").and_then(Value::as_str) == Some("turn/completed")
}

fn error_notification(value: &Value) -> Option<String> {
    if value.get("method").and_then(Value::as_str) != Some("error") {
        return None;
    }
    value
        .get("params")
        .and_then(|v| v.get("message"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| Some(value.to_string()))
}

fn to_codex_model_id(model: &str) -> &str {
    model.strip_suffix("-chatgpt").unwrap_or(model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_connected_chatgpt_account_response() {
        let value = json!({
            "account": {
                "type": "chatgpt",
                "email": "dev@example.com",
                "planType": "plus"
            },
            "requiresOpenaiAuth": true
        });

        let account = parse_account_read(value).expect("account response");

        assert_eq!(account.auth_mode, Some("chatgpt".to_string()));
        assert_eq!(account.email, Some("dev@example.com".to_string()));
        assert_eq!(account.plan_type, Some("plus".to_string()));
        assert!(account.requires_openai_auth);
    }

    #[test]
    fn parses_empty_account_response() {
        let value = json!({
            "account": null,
            "requiresOpenaiAuth": true
        });

        let account = parse_account_read(value).expect("account response");

        assert_eq!(account.auth_mode, None);
        assert_eq!(account.email, None);
        assert_eq!(account.plan_type, None);
        assert!(account.requires_openai_auth);
    }

    #[test]
    fn parses_thread_start_response_id() {
        let value = json!({
            "thread": {
                "id": "thread-123"
            }
        });

        assert_eq!(
            parse_thread_start(value).expect("thread id"),
            "thread-123".to_string()
        );
    }

    #[test]
    fn collects_agent_message_delta_notification() {
        let value = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "delta": "hello",
                "threadId": "thread-123",
                "turnId": "turn-123",
                "itemId": "item-123"
            }
        });

        assert_eq!(agent_message_delta(&value), Some("hello"));
    }

    #[test]
    fn maps_agent_message_delta_to_stream_event() {
        let value = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "delta": "hello",
                "itemId": "item-123"
            }
        });

        assert_eq!(
            codex_stream_event(&value),
            Some(CodexStreamEvent::AgentMessageDelta {
                item_id: "item-123".to_string(),
                delta: "hello".to_string(),
            })
        );
    }

    #[test]
    fn maps_reasoning_summary_delta_to_stream_event() {
        let value = json!({
            "method": "item/reasoning/summaryTextDelta",
            "params": {
                "delta": "checking",
                "itemId": "reasoning-123",
                "summaryIndex": 0
            }
        });

        assert_eq!(
            codex_stream_event(&value),
            Some(CodexStreamEvent::ReasoningDelta {
                item_id: "reasoning-123".to_string(),
                delta: "checking".to_string(),
            })
        );
    }

    #[test]
    fn maps_reasoning_lifecycle_to_stream_events() {
        let started = json!({
            "method": "item/started",
            "params": {
                "item": { "type": "reasoning", "id": "reasoning-123" }
            }
        });
        let completed = json!({
            "method": "item/completed",
            "params": {
                "item": { "type": "reasoning", "id": "reasoning-123" }
            }
        });

        assert_eq!(
            codex_stream_event(&started),
            Some(CodexStreamEvent::ReasoningStart {
                item_id: "reasoning-123".to_string(),
            })
        );
        assert_eq!(
            codex_stream_event(&completed),
            Some(CodexStreamEvent::ReasoningEnd {
                item_id: "reasoning-123".to_string(),
            })
        );
    }

    #[test]
    fn serializes_stream_event_fields_as_camel_case() {
        let value = serde_json::to_value(CodexStreamEvent::AgentMessageStart {
            item_id: "item-123".to_string(),
        })
        .expect("stream event json");

        assert_eq!(
            value,
            json!({
                "kind": "agentMessageStart",
                "itemId": "item-123"
            })
        );
    }

    #[test]
    fn maps_terax_chatgpt_model_ids_to_codex_model_ids() {
        assert_eq!(to_codex_model_id("gpt-5.5-chatgpt"), "gpt-5.5");
        assert_eq!(to_codex_model_id("gpt-5.3-codex-chatgpt"), "gpt-5.3-codex");
        assert_eq!(to_codex_model_id("gpt-5.3-codex"), "gpt-5.3-codex");
    }
}
