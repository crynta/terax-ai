use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT,
};
use reqwest::redirect::Policy;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::AppHandle;

use crate::modules::net::AiStreamEvent;
use crate::modules::secrets::{
    delete_secret_value, get_secret_value, set_secret_value, SecretsState,
};

const KEYRING_SERVICE: &str = "terax-ai";
const CODEX_SECRET_ACCOUNT: &str = "openai-codex-oauth";
const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_AUTH_BASE_URL: &str = "https://auth.openai.com/api/accounts";
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const DEVICE_EXPIRES_AFTER_MS: u64 = 15 * 60 * 1000;
const REFRESH_SKEW_MS: u64 = 2 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS: u64 = 60 * 1000;
const UPSTREAM_ERROR_DETAIL_MAX_CHARS: usize = 180;

pub struct CodexAuthState {
    pending: Mutex<HashMap<String, PendingDeviceLogin>>,
    next_login_id: AtomicU64,
    client: Client,
}

impl Default for CodexAuthState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            next_login_id: AtomicU64::new(1),
            client: Client::builder()
                .redirect(Policy::none())
                .build()
                .expect("Codex HTTP client should build"),
        }
    }
}

#[derive(Debug, Clone)]
struct PendingDeviceLogin {
    device_auth_id: String,
    user_code: String,
    expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAuthStatus {
    pub signed_in: bool,
    pub needs_relogin: bool,
    pub rate_limited_until_ms: Option<u64>,
    pub account_email: Option<String>,
    pub plan_type: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub last_refresh_ms: Option<u64>,
    pub message: Option<String>,
}

impl CodexAuthStatus {
    fn signed_out() -> Self {
        Self {
            signed_in: false,
            needs_relogin: false,
            rate_limited_until_ms: None,
            account_email: None,
            plan_type: None,
            expires_at_ms: None,
            last_refresh_ms: None,
            message: None,
        }
    }

    fn needs_relogin(message: impl Into<String>) -> Self {
        Self {
            signed_in: false,
            needs_relogin: true,
            rate_limited_until_ms: None,
            account_email: None,
            plan_type: None,
            expires_at_ms: None,
            last_refresh_ms: None,
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDeviceStart {
    login_id: String,
    verification_url: String,
    user_code: String,
    expires_at_ms: u64,
    poll_interval_secs: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPollResult {
    status: String,
    auth: Option<CodexAuthStatus>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCodexSession {
    access_token: String,
    refresh_token: String,
    id_token: Option<String>,
    expires_at_ms: Option<u64>,
    account_email: Option<String>,
    plan_type: Option<String>,
    last_refresh_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DeviceUserCodeResp {
    device_auth_id: String,
    #[serde(alias = "usercode")]
    user_code: String,
    #[serde(
        default = "default_poll_interval_secs",
        deserialize_with = "deserialize_interval"
    )]
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceTokenResp {
    authorization_code: String,
    code_verifier: String,
}

#[derive(Debug, Deserialize)]
struct TokenResp {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: Option<u64>,
}

#[tauri::command]
pub async fn openai_codex_auth_start_device(
    state: tauri::State<'_, CodexAuthState>,
) -> Result<CodexDeviceStart, String> {
    let resp = request_device_user_code(&state.client).await?;
    let now = now_ms();
    let login_id = state.next_login_id.fetch_add(1, Ordering::Relaxed);
    let login_id = format!("codex-{now}-{login_id}");
    let expires_at_ms = now.saturating_add(DEVICE_EXPIRES_AFTER_MS);
    let poll_interval_secs = resp.interval.clamp(1, 15);
    let pending = PendingDeviceLogin {
        device_auth_id: resp.device_auth_id,
        user_code: resp.user_code.clone(),
        expires_at_ms,
    };
    state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(login_id.clone(), pending);

    Ok(CodexDeviceStart {
        login_id,
        verification_url: DEVICE_VERIFICATION_URL.to_string(),
        user_code: resp.user_code,
        expires_at_ms,
        poll_interval_secs,
    })
}

#[tauri::command]
pub async fn openai_codex_auth_poll(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    state: tauri::State<'_, CodexAuthState>,
    login_id: String,
) -> Result<CodexPollResult, String> {
    let pending = {
        let guard = state.pending.lock().map_err(|e| e.to_string())?;
        guard.get(&login_id).cloned()
    };
    let Some(pending) = pending else {
        return Ok(CodexPollResult {
            status: "expired".to_string(),
            auth: None,
            message: Some("Device login expired. Start a new sign-in.".to_string()),
        });
    };
    if pending.expires_at_ms <= now_ms() {
        let _ = state
            .pending
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&login_id);
        return Ok(CodexPollResult {
            status: "expired".to_string(),
            auth: None,
            message: Some("Device login expired. Start a new sign-in.".to_string()),
        });
    }

    match poll_device_token(&state.client, &pending).await? {
        DevicePoll::Pending => Ok(CodexPollResult {
            status: "pending".to_string(),
            auth: None,
            message: None,
        }),
        DevicePoll::Complete(code) => {
            let session = exchange_authorization_code(&state.client, &code).await?;
            save_session(&app, &secrets, &session)?;
            let _ = state
                .pending
                .lock()
                .map_err(|e| e.to_string())?
                .remove(&login_id);
            Ok(CodexPollResult {
                status: "complete".to_string(),
                auth: Some(status_from_session(&session)),
                message: None,
            })
        }
    }
}

#[tauri::command]
pub async fn openai_codex_auth_cancel(
    state: tauri::State<'_, CodexAuthState>,
    login_id: String,
) -> Result<(), String> {
    let _ = state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&login_id);
    Ok(())
}

#[tauri::command]
pub async fn openai_codex_auth_status(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    state: tauri::State<'_, CodexAuthState>,
) -> Result<CodexAuthStatus, String> {
    Ok(resolve_status(&app, &secrets, &state.client).await)
}

#[tauri::command]
pub async fn openai_codex_auth_logout(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
) -> Result<(), String> {
    delete_secret_value(&app, &secrets, KEYRING_SERVICE, CODEX_SECRET_ACCOUNT)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn openai_codex_responses_stream(
    app: AppHandle,
    secrets: tauri::State<'_, SecretsState>,
    state: tauri::State<'_, CodexAuthState>,
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    let parsed = match validate_codex_responses_url(&url, &method) {
        Ok(parsed) => parsed,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            return Err(e);
        }
    };
    let token = match fresh_access_token(&app, &secrets, &state.client).await {
        Ok(token) => token,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    let mut header_map = match sanitize_codex_headers(headers) {
        Ok(headers) => headers,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            return Err(e);
        }
    };
    let bearer = format!("Bearer {token}");
    header_map.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&bearer).map_err(|e| e.to_string())?,
    );
    header_map
        .entry(CONTENT_TYPE)
        .or_insert(HeaderValue::from_static("application/json"));
    header_map
        .entry(ACCEPT)
        .or_insert(HeaderValue::from_static("text/event-stream"));
    header_map
        .entry(USER_AGENT)
        .or_insert(HeaderValue::from_static("codex_cli_rs/0.0.0 (Terax)"));
    header_map.insert(
        HeaderName::from_static("originator"),
        HeaderValue::from_static("codex_cli_rs"),
    );

    let mut req = state.client.post(parsed).headers(header_map);
    if let Some(body) = body {
        req = req.body(body);
    }
    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error {
                message: e.to_string(),
            });
            return Err(e.to_string());
        }
    };

    let status = resp.status().as_u16();
    let headers = codex_response_headers_to_strings(resp.headers());
    let _ = on_event.send(AiStreamEvent::Headers { status, headers });

    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        match item {
            Ok(chunk) => {
                let bytes: Bytes = chunk;
                if on_event
                    .send(AiStreamEvent::Chunk {
                        bytes: bytes.to_vec(),
                    })
                    .is_err()
                {
                    return Ok(());
                }
            }
            Err(e) => {
                let _ = on_event.send(AiStreamEvent::Error {
                    message: e.to_string(),
                });
                return Err(e.to_string());
            }
        }
    }

    let _ = on_event.send(AiStreamEvent::End);
    Ok(())
}

async fn request_device_user_code(client: &Client) -> Result<DeviceUserCodeResp, String> {
    let url = format!("{DEVICE_AUTH_BASE_URL}/deviceauth/usercode");
    let body = serde_json::json!({ "client_id": CODEX_CLIENT_ID }).to_string();
    let resp = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        if status == StatusCode::NOT_FOUND {
            return Err(
                "Codex device-code login is not enabled for this account or workspace.".into(),
            );
        }
        return Err(upstream_auth_error(
            "Codex device-code request failed",
            status,
            &text,
        ));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

enum DevicePoll {
    Pending,
    Complete(DeviceTokenResp),
}

async fn poll_device_token(
    client: &Client,
    pending: &PendingDeviceLogin,
) -> Result<DevicePoll, String> {
    let url = format!("{DEVICE_AUTH_BASE_URL}/deviceauth/token");
    let body = serde_json::json!({
        "device_auth_id": pending.device_auth_id.as_str(),
        "user_code": pending.user_code.as_str(),
    })
    .to_string();
    let resp = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND {
        return Ok(DevicePoll::Pending);
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(upstream_auth_error(
            "Codex device-code poll failed",
            status,
            &text,
        ));
    }
    let token = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(DevicePoll::Complete(token))
}

async fn exchange_authorization_code(
    client: &Client,
    code: &DeviceTokenResp,
) -> Result<StoredCodexSession, String> {
    let body = token_exchange_body(&code.authorization_code, &code.code_verifier);
    let resp = client
        .post(TOKEN_URL)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(upstream_auth_error(
            "Codex token exchange failed",
            status,
            &text,
        ));
    }
    let token: TokenResp = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    session_from_token_response(token, None)
}

async fn refresh_session(
    client: &Client,
    current: &StoredCodexSession,
) -> Result<StoredCodexSession, RefreshError> {
    let body = token_refresh_body(&current.refresh_token);
    let resp = client
        .post(TOKEN_URL)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| RefreshError::Transient(e.to_string()))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| RefreshError::Transient(e.to_string()))?;
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(RefreshError::RateLimited);
    }
    if !status.is_success() {
        let code = extract_error_code(&text);
        if status == StatusCode::UNAUTHORIZED
            || status == StatusCode::FORBIDDEN
            || status == StatusCode::BAD_REQUEST
            || is_permanent_refresh_code(code.as_deref())
        {
            return Err(RefreshError::Permanent(
                "Your Codex session expired. Sign in again.".to_string(),
            ));
        }
        return Err(RefreshError::Transient(upstream_auth_error(
            "Codex token refresh failed",
            status,
            &text,
        )));
    }
    let token: TokenResp =
        serde_json::from_str(&text).map_err(|e| RefreshError::Transient(e.to_string()))?;
    session_from_token_response(token, Some(current))
        .map_err(|e| RefreshError::Transient(e.to_string()))
}

async fn resolve_status(
    app: &AppHandle,
    secrets: &SecretsState,
    client: &Client,
) -> CodexAuthStatus {
    match fresh_session(app, secrets, client).await {
        Ok(Some(session)) => status_from_session(&session),
        Ok(None) => CodexAuthStatus::signed_out(),
        Err(RefreshError::RateLimited) => CodexAuthStatus {
            signed_in: true,
            needs_relogin: false,
            rate_limited_until_ms: Some(now_ms().saturating_add(RATE_LIMIT_BACKOFF_MS)),
            account_email: None,
            plan_type: None,
            expires_at_ms: None,
            last_refresh_ms: None,
            message: Some("Codex token refresh is rate limited. Try again shortly.".to_string()),
        },
        Err(RefreshError::Permanent(message)) => CodexAuthStatus::needs_relogin(message),
        Err(RefreshError::Transient(message)) => CodexAuthStatus {
            signed_in: false,
            needs_relogin: false,
            rate_limited_until_ms: None,
            account_email: None,
            plan_type: None,
            expires_at_ms: None,
            last_refresh_ms: None,
            message: Some(message),
        },
    }
}

async fn fresh_access_token(
    app: &AppHandle,
    secrets: &SecretsState,
    client: &Client,
) -> Result<String, String> {
    match fresh_session(app, secrets, client).await {
        Ok(Some(session)) => Ok(session.access_token),
        Ok(None) => Err("OpenAI Codex is not signed in. Open Settings and sign in.".to_string()),
        Err(RefreshError::RateLimited) => {
            Err("Codex token refresh is rate limited. Try again shortly.".to_string())
        }
        Err(RefreshError::Permanent(message)) | Err(RefreshError::Transient(message)) => {
            Err(message)
        }
    }
}

async fn fresh_session(
    app: &AppHandle,
    secrets: &SecretsState,
    client: &Client,
) -> Result<Option<StoredCodexSession>, RefreshError> {
    let Some(mut session) = load_session(app, secrets).map_err(RefreshError::Transient)? else {
        return Ok(None);
    };
    hydrate_session_metadata(&mut session);
    if !session_needs_refresh(&session) {
        return Ok(Some(session));
    }
    let refreshed = refresh_session(client, &session).await?;
    save_session(app, secrets, &refreshed).map_err(RefreshError::Transient)?;
    Ok(Some(refreshed))
}

fn session_needs_refresh(session: &StoredCodexSession) -> bool {
    match session.expires_at_ms {
        Some(expires_at) => expires_at <= now_ms().saturating_add(REFRESH_SKEW_MS),
        None => true,
    }
}

fn session_from_token_response(
    token: TokenResp,
    previous: Option<&StoredCodexSession>,
) -> Result<StoredCodexSession, String> {
    let expires_at_ms = parse_jwt_expiration_ms(&token.access_token).or_else(|| {
        token
            .expires_in
            .map(|secs| now_ms().saturating_add(secs * 1000))
    });
    let mut session = StoredCodexSession {
        access_token: token.access_token,
        refresh_token: token
            .refresh_token
            .or_else(|| previous.map(|s| s.refresh_token.clone()))
            .ok_or_else(|| "Codex token response did not include a refresh token".to_string())?,
        id_token: token
            .id_token
            .or_else(|| previous.and_then(|s| s.id_token.clone())),
        expires_at_ms,
        account_email: previous.and_then(|s| s.account_email.clone()),
        plan_type: previous.and_then(|s| s.plan_type.clone()),
        last_refresh_ms: Some(now_ms()),
    };
    hydrate_session_metadata(&mut session);
    Ok(session)
}

fn hydrate_session_metadata(session: &mut StoredCodexSession) {
    if session.expires_at_ms.is_none() {
        session.expires_at_ms = parse_jwt_expiration_ms(&session.access_token);
    }
    if let Some(id_token) = session.id_token.as_deref() {
        if session.account_email.is_none() {
            session.account_email = parse_chatgpt_claim(id_token, &["email"]).or_else(|| {
                parse_nested_chatgpt_claim(id_token, "https://api.openai.com/profile", "email")
            });
        }
        if session.plan_type.is_none() {
            session.plan_type = parse_nested_chatgpt_claim(
                id_token,
                "https://api.openai.com/auth",
                "chatgpt_plan_type",
            );
        }
    }
}

fn status_from_session(session: &StoredCodexSession) -> CodexAuthStatus {
    CodexAuthStatus {
        signed_in: true,
        needs_relogin: false,
        rate_limited_until_ms: None,
        account_email: session.account_email.clone(),
        plan_type: session.plan_type.clone(),
        expires_at_ms: session.expires_at_ms,
        last_refresh_ms: session.last_refresh_ms,
        message: None,
    }
}

fn load_session(
    app: &AppHandle,
    secrets: &SecretsState,
) -> Result<Option<StoredCodexSession>, String> {
    let Some(raw) = get_secret_value(app, secrets, KEYRING_SERVICE, CODEX_SECRET_ACCOUNT)? else {
        return Ok(None);
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| format!("Stored Codex session is unreadable: {e}"))
}

fn save_session(
    app: &AppHandle,
    secrets: &SecretsState,
    session: &StoredCodexSession,
) -> Result<(), String> {
    let raw = serde_json::to_string(session).map_err(|e| e.to_string())?;
    set_secret_value(app, secrets, KEYRING_SERVICE, CODEX_SECRET_ACCOUNT, raw)
}

#[derive(Debug)]
enum RefreshError {
    RateLimited,
    Permanent(String),
    Transient(String),
}

fn validate_codex_responses_url(url: &str, method: &str) -> Result<reqwest::Url, String> {
    if !method.eq_ignore_ascii_case("POST") {
        return Err("Codex bridge only allows POST requests".to_string());
    }
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Codex bridge only allows HTTPS".to_string());
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err("userinfo in url is not allowed".to_string());
    }
    if parsed.host_str() != Some("chatgpt.com") {
        return Err("Codex bridge only allows chatgpt.com".to_string());
    }
    if parsed.port().is_some() {
        return Err("Codex bridge does not allow custom ports".to_string());
    }
    if parsed.path() != "/backend-api/codex/responses" {
        return Err("Codex bridge only allows the Responses endpoint".to_string());
    }
    Ok(parsed)
}

fn sanitize_codex_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    let Some(headers) = headers else {
        return Ok(map);
    };
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "authorization"
                | "cookie"
                | "host"
                | "content-length"
                | "connection"
                | "proxy-authorization"
                | "proxy-connection"
                | "te"
                | "transfer-encoding"
                | "upgrade"
                | "trailer"
                | "expect"
        ) {
            continue;
        }
        if value
            .as_bytes()
            .iter()
            .any(|b| matches!(b, 0 | b'\r' | b'\n'))
        {
            return Err(format!("header value contains control bytes: {name}"));
        }
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|e| e.to_string())?;
        let header_value = HeaderValue::from_str(&value).map_err(|e| e.to_string())?;
        map.insert(header_name, header_value);
    }
    Ok(map)
}

fn codex_response_headers_to_strings(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (k, v) in headers {
        let name = k.as_str().to_ascii_lowercase();
        if !codex_response_header_allowed(&name) {
            continue;
        }
        if let Ok(s) = v.to_str() {
            out.insert(name, s.to_string());
        }
    }
    out
}

fn codex_response_header_allowed(name: &str) -> bool {
    matches!(
        name,
        "content-type"
            | "x-request-id"
            | "request-id"
            | "x-ratelimit-limit-requests"
            | "x-ratelimit-remaining-requests"
            | "x-ratelimit-reset-requests"
            | "x-ratelimit-limit-tokens"
            | "x-ratelimit-remaining-tokens"
            | "x-ratelimit-reset-tokens"
    )
}

fn upstream_auth_error(prefix: &str, status: StatusCode, body: &str) -> String {
    match safe_upstream_error_detail(body) {
        Some(detail) => format!("{prefix}: {status}: {detail}"),
        None => format!("{prefix}: {status}"),
    }
}

fn safe_upstream_error_detail(body: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(body).ok()?;
    let detail = extract_error_detail(&value)?;
    let redacted = redact_sensitive_error_text(&detail);
    let trimmed = redacted.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_chars(trimmed, UPSTREAM_ERROR_DETAIL_MAX_CHARS))
}

fn extract_error_detail(value: &Value) -> Option<String> {
    let error = value.get("error");
    if let Some(error) = error {
        if let Some(code) = error.as_str() {
            return Some(code.to_string());
        }
        if let Some(code) = error.get("code").and_then(Value::as_str) {
            if let Some(message) = error.get("message").and_then(Value::as_str) {
                return Some(format!("{code}: {message}"));
            }
            return Some(code.to_string());
        }
        if let Some(message) = error.get("message").and_then(Value::as_str) {
            return Some(message.to_string());
        }
    }
    if let Some(code) = value.get("error_code").and_then(Value::as_str) {
        return Some(code.to_string());
    }
    if let Some(message) = value.get("message").and_then(Value::as_str) {
        return Some(message.to_string());
    }
    None
}

fn redact_sensitive_error_text(value: &str) -> String {
    let mut out = Vec::new();
    let mut redact_next = false;

    for part in value.split_whitespace() {
        let lower = part.to_ascii_lowercase();
        let sensitive_marker = is_sensitive_error_marker(&lower);
        let redact_current = redact_next || sensitive_marker || looks_like_secret_fragment(part);
        out.push(if redact_current {
            "[redacted]".to_string()
        } else {
            part.to_string()
        });
        redact_next = sensitive_marker && !lower.contains('=') && !lower.contains(':');
    }

    out.join(" ")
}

fn is_sensitive_error_marker(lower: &str) -> bool {
    lower.contains("access_token")
        || lower.contains("refresh_token")
        || lower.contains("id_token")
        || lower.contains("authorization")
        || lower.contains("bearer")
        || lower.contains("client_secret")
        || lower.contains("device_auth_id")
        || lower.contains("authorization_code")
        || lower.contains("code_verifier")
}

fn looks_like_secret_fragment(value: &str) -> bool {
    let trimmed = value.trim_matches(|c: char| {
        matches!(
            c,
            '"' | '\'' | ',' | ':' | ';' | '(' | ')' | '[' | ']' | '{' | '}'
        )
    });
    if trimmed.len() < 24 {
        return false;
    }
    let allowed = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '=' | '/' | '+'));
    allowed
        && (trimmed.contains('.')
            || trimmed.contains('_')
            || trimmed.contains('-')
            || trimmed.len() >= 40)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(value.len().min(max_chars));
    for (i, ch) in value.chars().enumerate() {
        if i >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn form_body(fields: &[(&str, &str)]) -> String {
    fields
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn token_exchange_body(authorization_code: &str, code_verifier: &str) -> String {
    form_body(&[
        ("grant_type", "authorization_code"),
        ("code", authorization_code),
        ("redirect_uri", DEVICE_REDIRECT_URI),
        ("client_id", CODEX_CLIENT_ID),
        ("code_verifier", code_verifier),
    ])
}

fn token_refresh_body(refresh_token: &str) -> String {
    form_body(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CODEX_CLIENT_ID),
    ])
}

fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn parse_jwt_payload(jwt: &str) -> Option<Value> {
    let mut parts = jwt.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let _sig = parts.next()?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn parse_jwt_expiration_ms(jwt: &str) -> Option<u64> {
    let payload = parse_jwt_payload(jwt)?;
    payload
        .get("exp")?
        .as_u64()
        .map(|secs| secs.saturating_mul(1000))
}

fn parse_chatgpt_claim(jwt: &str, path: &[&str]) -> Option<String> {
    let payload = parse_jwt_payload(jwt)?;
    let mut value = &payload;
    for segment in path {
        value = value.get(*segment)?;
    }
    value.as_str().map(str::to_string)
}

fn parse_nested_chatgpt_claim(jwt: &str, parent: &str, child: &str) -> Option<String> {
    parse_chatgpt_claim(jwt, &[parent, child])
}

fn extract_error_code(body: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(body).ok()?;
    value
        .get("error")
        .and_then(|e| {
            if let Some(code) = e.as_str() {
                return Some(code);
            }
            e.get("code").and_then(Value::as_str)
        })
        .or_else(|| value.get("error_code").and_then(Value::as_str))
        .map(str::to_string)
}

fn is_permanent_refresh_code(code: Option<&str>) -> bool {
    let normalized = code.map(str::to_ascii_lowercase);
    matches!(
        normalized.as_deref(),
        Some(
            "invalid_grant"
                | "invalid_token"
                | "refresh_token_expired"
                | "refresh_token_reused"
                | "refresh_token_invalidated"
        )
    )
}

fn default_poll_interval_secs() -> u64 {
    5
}

fn deserialize_interval<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Number(n) => n
            .as_u64()
            .ok_or_else(|| serde::de::Error::custom("interval must be an integer")),
        Value::String(s) => s.trim().parse::<u64>().map_err(serde::de::Error::custom),
        _ => Err(serde::de::Error::custom(
            "interval must be a string or integer",
        )),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_jwt(payload: Value) -> String {
        let header = serde_json::json!({ "alg": "none", "typ": "JWT" });
        let enc = |value: &Value| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(value).unwrap())
        };
        format!("{}.{}.sig", enc(&header), enc(&payload))
    }

    #[test]
    fn parses_jwt_expiration_and_claims() {
        let jwt = fake_jwt(serde_json::json!({
            "exp": 1_700_000_000_u64,
            "email": "user@example.com",
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "pro"
            }
        }));

        assert_eq!(parse_jwt_expiration_ms(&jwt), Some(1_700_000_000_000));
        assert_eq!(
            parse_chatgpt_claim(&jwt, &["email"]).as_deref(),
            Some("user@example.com")
        );
        assert_eq!(
            parse_nested_chatgpt_claim(&jwt, "https://api.openai.com/auth", "chatgpt_plan_type")
                .as_deref(),
            Some("pro")
        );
    }

    #[test]
    fn validates_codex_responses_url() {
        assert!(validate_codex_responses_url(
            "https://chatgpt.com/backend-api/codex/responses",
            "POST"
        )
        .is_ok());
        assert!(validate_codex_responses_url(
            "https://chatgpt.com/backend-api/codex/responses",
            "GET"
        )
        .is_err());
        assert!(validate_codex_responses_url(
            "http://chatgpt.com/backend-api/codex/responses",
            "POST"
        )
        .is_err());
        assert!(validate_codex_responses_url(
            "https://example.com/backend-api/codex/responses",
            "POST"
        )
        .is_err());
        assert!(validate_codex_responses_url(
            "https://chatgpt.com/backend-api/codex/models",
            "POST"
        )
        .is_err());
        assert!(validate_codex_responses_url(
            "https://user:pass@chatgpt.com/backend-api/codex/responses",
            "POST"
        )
        .is_err());
    }

    #[test]
    fn codex_headers_strip_sensitive_values() {
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Bearer fake".to_string());
        headers.insert("cookie".to_string(), "a=b".to_string());
        headers.insert("content-type".to_string(), "application/json".to_string());

        let sanitized = sanitize_codex_headers(Some(headers)).unwrap();
        assert!(!sanitized.contains_key("authorization"));
        assert!(!sanitized.contains_key("cookie"));
        assert_eq!(
            sanitized.get("content-type").and_then(|v| v.to_str().ok()),
            Some("application/json")
        );
    }

    #[test]
    fn codex_headers_reject_crlf() {
        let mut headers = HashMap::new();
        headers.insert("x-test".to_string(), "ok\r\nbad: yes".to_string());
        assert!(sanitize_codex_headers(Some(headers)).is_err());
    }

    #[test]
    fn codex_response_headers_only_expose_allowlisted_values() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
        headers.insert(
            HeaderName::from_static("x-request-id"),
            HeaderValue::from_static("req_123"),
        );
        headers.insert(
            HeaderName::from_static("set-cookie"),
            HeaderValue::from_static("session=secret"),
        );
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer secret"));
        headers.insert(
            HeaderName::from_static("www-authenticate"),
            HeaderValue::from_static("Bearer error=\"invalid_token\""),
        );

        let sanitized = codex_response_headers_to_strings(&headers);
        assert_eq!(
            sanitized.get("content-type").map(String::as_str),
            Some("text/event-stream")
        );
        assert_eq!(
            sanitized.get("x-request-id").map(String::as_str),
            Some("req_123")
        );
        assert!(!sanitized.contains_key("set-cookie"));
        assert!(!sanitized.contains_key("authorization"));
        assert!(!sanitized.contains_key("www-authenticate"));
    }

    #[test]
    fn upstream_auth_errors_do_not_echo_raw_sensitive_body() {
        let body = serde_json::json!({
            "refresh_token": "raw-refresh-secret",
            "error": {
                "code": "invalid_grant",
                "message": "refresh_token raw-refresh-secret Bearer eyJhbGciOiJIUzI1NiJ9.secret.payload"
            }
        })
        .to_string();

        let message =
            upstream_auth_error("Codex token refresh failed", StatusCode::BAD_REQUEST, &body);

        assert!(message.contains("invalid_grant"));
        assert!(message.contains("[redacted]"));
        assert!(!message.contains("raw-refresh-secret"));
        assert!(!message.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(!message.contains("refresh_token"));
        assert!(!message.contains("Bearer"));
    }

    #[test]
    fn upstream_auth_errors_drop_unparseable_raw_body() {
        let message = upstream_auth_error(
            "Codex token exchange failed",
            StatusCode::BAD_GATEWAY,
            "refresh_token raw-refresh-secret",
        );

        assert_eq!(message, "Codex token exchange failed: 502 Bad Gateway");
    }

    #[test]
    fn form_body_percent_encodes_values() {
        assert_eq!(
            form_body(&[(
                "redirect_uri",
                "https://auth.openai.com/deviceauth/callback"
            )]),
            "redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback"
        );
    }

    #[test]
    fn codex_token_payloads_are_form_encoded() {
        assert_eq!(
            token_exchange_body("auth code", "verifier/value"),
            "grant_type=authorization_code&code=auth%20code&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback&client_id=app_EMoamEEZ73f0CkXaXp7hrann&code_verifier=verifier%2Fvalue"
        );
        assert_eq!(
            token_refresh_body("refresh token"),
            "grant_type=refresh_token&refresh_token=refresh%20token&client_id=app_EMoamEEZ73f0CkXaXp7hrann"
        );
    }

    #[test]
    fn refreshed_session_keeps_previous_refresh_token_when_not_rotated() {
        let previous = StoredCodexSession {
            access_token: "old".to_string(),
            refresh_token: "refresh-old".to_string(),
            id_token: Some(fake_jwt(serde_json::json!({ "email": "old@example.com" }))),
            expires_at_ms: Some(1),
            account_email: Some("old@example.com".to_string()),
            plan_type: None,
            last_refresh_ms: Some(1),
        };
        let token = TokenResp {
            access_token: fake_jwt(serde_json::json!({ "exp": 1_700_000_000_u64 })),
            refresh_token: None,
            id_token: None,
            expires_in: None,
        };

        let session = session_from_token_response(token, Some(&previous)).unwrap();
        assert_eq!(session.refresh_token, "refresh-old");
        assert_eq!(session.account_email.as_deref(), Some("old@example.com"));
        assert_eq!(session.expires_at_ms, Some(1_700_000_000_000));
    }

    #[test]
    fn refresh_error_codes_are_classified_as_permanent() {
        let body = serde_json::json!({
            "error": {
                "code": "refresh_token_reused"
            }
        })
        .to_string();
        let code = extract_error_code(&body);
        assert_eq!(code.as_deref(), Some("refresh_token_reused"));
        assert!(is_permanent_refresh_code(code.as_deref()));
        assert!(is_permanent_refresh_code(Some("invalid_grant")));
    }
}
