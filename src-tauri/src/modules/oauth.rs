use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::modules::secrets::SecretsState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER: &str = "https://auth.openai.com";
const OPENAI_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const OPENAI_SCOPE: &str =
    "openid profile email offline_access api.connectors.read api.connectors.invoke";
const CALLBACK_HTML: &str = r#"<!doctype html><meta charset="utf-8"><title>Terax</title><body style="font:14px system-ui;margin:40px">OpenAI sign-in complete. You can close this tab and return to Terax.</body>"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAiOAuthToken {
    pub id_token: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAiOAuthCredentials {
    pub access_token: String,
    pub account_id: Option<String>,
    pub is_fedramp_account: bool,
}

#[derive(Debug, Deserialize)]
struct CodexJsonLine {
    #[serde(rename = "type")]
    event_type: String,
    item: Option<CodexJsonItem>,
}

#[derive(Debug, Deserialize)]
struct CodexJsonItem {
    #[serde(rename = "type")]
    item_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    #[serde(rename = "https://api.openai.com/auth", default)]
    auth: Option<AuthClaims>,
}

#[derive(Debug, Deserialize)]
struct AuthClaims {
    #[serde(default)]
    chatgpt_account_id: Option<String>,
    #[serde(default)]
    chatgpt_account_is_fedramp: bool,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

struct PkceCodes {
    verifier: String,
    challenge: String,
}

#[tauri::command]
pub async fn openai_oauth_login(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<OpenAiOAuthToken, String> {
    let pkce = generate_pkce();
    let expected_state = random_urlsafe(32);
    let auth_url = build_authorize_url(&pkce, &expected_state);

    let listener = TcpListener::bind("127.0.0.1:1455")
        .map_err(|e| format!("Could not start OAuth callback server on port 1455: {e}"))?;
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("Could not open browser: {e}"))?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, expected_state))
        .await
        .map_err(|e| e.to_string())??;

    let token = exchange_code_for_token(&code, &pkce.verifier).await?;
    save_openai_oauth_token(&app, &state, &token).await?;
    Ok(token)
}

#[tauri::command]
pub async fn openai_oauth_access_token(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<Option<String>, String> {
    get_openai_oauth_access_token(&app, &state).await
}

#[tauri::command]
pub async fn openai_oauth_credentials(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<Option<OpenAiOAuthCredentials>, String> {
    get_openai_oauth_credentials(&app, &state).await
}

pub async fn get_openai_oauth_access_token(
    app: &AppHandle,
    state: &SecretsState,
) -> Result<Option<String>, String> {
    let _ = state;
    let Some(token) = load_openai_oauth_token(app)? else {
        return Ok(None);
    };
    if token.expires_at > now_ms().saturating_add(60_000) {
        return Ok(Some(token.access_token));
    }

    let refreshed = refresh_token(&token.refresh_token).await?;
    save_openai_oauth_token(app, state, &refreshed).await?;
    Ok(Some(refreshed.access_token))
}

pub async fn get_openai_oauth_credentials(
    app: &AppHandle,
    state: &SecretsState,
) -> Result<Option<OpenAiOAuthCredentials>, String> {
    let _ = state;
    let Some(mut token) = load_openai_oauth_token(app)? else {
        return Ok(None);
    };
    if token.expires_at <= now_ms().saturating_add(60_000) {
        token = refresh_token(&token.refresh_token).await?;
        save_openai_oauth_token(app, state, &token).await?;
    }
    let claims = parse_jwt_claims(&token.id_token)
        .or_else(|_| parse_jwt_claims(&token.access_token))
        .unwrap_or(None);
    Ok(Some(OpenAiOAuthCredentials {
        access_token: token.access_token,
        account_id: claims
            .as_ref()
            .and_then(|claims| claims.auth.as_ref())
            .and_then(|auth| auth.chatgpt_account_id.clone()),
        is_fedramp_account: claims
            .and_then(|claims| claims.auth)
            .is_some_and(|auth| auth.chatgpt_account_is_fedramp),
    }))
}

pub async fn delete_openai_oauth_token(
    app: &AppHandle,
    state: &SecretsState,
) -> Result<(), String> {
    let _ = state;
    let path = token_path(app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub async fn openai_oauth_logout(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<(), String> {
    delete_openai_oauth_token(&app, &state).await
}

#[tauri::command]
pub async fn openai_codex_exec(prompt: String, model: String) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt is empty".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || run_codex_exec(&prompt, &model))
        .await
        .map_err(|e| e.to_string())?
}

async fn save_openai_oauth_token(
    app: &AppHandle,
    state: &SecretsState,
    token: &OpenAiOAuthToken,
) -> Result<(), String> {
    let raw = serde_json::to_string(token).map_err(|e| e.to_string())?;
    let _ = state;
    let path = token_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn load_openai_oauth_token(app: &AppHandle) -> Result<Option<OpenAiOAuthToken>, String> {
    let path = token_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string())
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("openai-oauth.json"))
}

fn parse_jwt_claims(jwt: &str) -> Result<Option<JwtClaims>, String> {
    let mut parts = jwt.split('.');
    let _header = parts.next();
    let Some(payload) = parts.next() else {
        return Ok(None);
    };
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string())
}

fn build_authorize_url(pkce: &PkceCodes, state: &str) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer
        .append_pair("response_type", "code")
        .append_pair("client_id", OPENAI_CLIENT_ID)
        .append_pair("redirect_uri", OPENAI_REDIRECT_URI)
        .append_pair("scope", OPENAI_SCOPE)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("state", state)
        .append_pair("originator", "codex_cli_rs");
    format!("{OPENAI_ISSUER}/oauth/authorize?{}", serializer.finish())
}

fn wait_for_callback(listener: TcpListener, expected_state: String) -> Result<String, String> {
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;

    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let first_line = request.lines().next().unwrap_or_default();
    let target = first_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "OAuth callback was malformed".to_string())?;

    let url = url::Url::parse(&format!("http://localhost{target}")).map_err(|e| e.to_string())?;
    let params = url.query_pairs().into_owned().collect::<Vec<_>>();
    let state = params
        .iter()
        .find(|(k, _)| k == "state")
        .map(|(_, v)| v.as_str())
        .unwrap_or_default();
    if state != expected_state {
        write_http_response(&mut stream, "OAuth state mismatch.");
        return Err("OAuth state mismatch".to_string());
    }
    if let Some((_, err)) = params.iter().find(|(k, _)| k == "error") {
        write_http_response(&mut stream, "OpenAI sign-in failed.");
        return Err(format!("OpenAI OAuth error: {err}"));
    }
    let code = params
        .iter()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .ok_or_else(|| "OAuth callback did not include a code".to_string())?;
    write_http_response(&mut stream, CALLBACK_HTML);
    Ok(code)
}

fn write_http_response(stream: &mut std::net::TcpStream, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.flush();
}

async fn exchange_code_for_token(code: &str, verifier: &str) -> Result<OpenAiOAuthToken, String> {
    let body = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
        urlencoding::encode(code),
        urlencoding::encode(OPENAI_REDIRECT_URI),
        urlencoding::encode(OPENAI_CLIENT_ID),
        urlencoding::encode(verifier),
    );
    let token = post_token_form(body).await?;
    Ok(OpenAiOAuthToken {
        id_token: token.id_token.unwrap_or_default(),
        access_token: token.access_token,
        refresh_token: token
            .refresh_token
            .ok_or_else(|| "OpenAI did not return a refresh token".to_string())?,
        expires_at: now_ms() + token.expires_in.unwrap_or(3600) * 1000,
    })
}

async fn refresh_token(refresh_token: &str) -> Result<OpenAiOAuthToken, String> {
    let body = format!(
        "grant_type=refresh_token&client_id={}&refresh_token={}",
        urlencoding::encode(OPENAI_CLIENT_ID),
        urlencoding::encode(refresh_token),
    );
    let token = post_token_form(body).await?;
    Ok(OpenAiOAuthToken {
        id_token: token.id_token.unwrap_or_default(),
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_else(|| refresh_token.to_string()),
        expires_at: now_ms() + token.expires_in.unwrap_or(3600) * 1000,
    })
}

async fn post_token_form(body: String) -> Result<TokenResponse, String> {
    let resp = reqwest::Client::new()
        .post(format!("{OPENAI_ISSUER}/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("OpenAI token exchange failed ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn run_codex_exec(prompt: &str, model: &str) -> Result<String, String> {
    let codex = std::env::var("APPDATA")
        .ok()
        .map(PathBuf::from)
        .map(|p| p.join("npm").join("codex.cmd"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("codex.cmd"));

    let mut args = vec![
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
    ];
    if !model.trim().is_empty() {
        args.push("--model");
        args.push(model.trim());
    }
    let mut command = Command::new(codex);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not run Codex CLI: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("Could not write to Codex CLI: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Could not read Codex CLI output: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let detail = stderr.trim();
        return Err(if detail.is_empty() {
            format!("Codex CLI failed with status {}", output.status)
        } else {
            detail.to_string()
        });
    }

    let mut text = String::new();
    for line in stdout.lines() {
        let Ok(event) = serde_json::from_str::<CodexJsonLine>(line) else {
            continue;
        };
        if event.event_type == "item.completed" {
            if let Some(item) = event.item {
                if item.item_type == "agent_message" {
                    if let Some(part) = item.text {
                        text.push_str(&part);
                    }
                }
            }
        }
    }

    if text.trim().is_empty() {
        Err("Codex CLI completed without an assistant message".to_string())
    } else {
        Ok(text)
    }
}

fn generate_pkce() -> PkceCodes {
    let verifier = random_urlsafe(32);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    PkceCodes {
        verifier,
        challenge,
    }
}

fn random_urlsafe(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
