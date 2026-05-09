use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;

use super::secrets::{self, SecretsState};

const KEYRING_SERVICE: &str = "terax-ai";
const KEYRING_ACCOUNT_GHO: &str = "github-copilot-gho-token";
const KEYRING_ACCOUNT_COPILOT: &str = "github-copilot-token";
const KEYRING_ACCOUNT_EXPIRES: &str = "github-copilot-expires-at";
const COPILOT_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotTokenInfo {
    pub token: String,
    pub expires_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotModel {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenPollResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct CopilotTokenResponse {
    token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Option<Vec<ModelEntry>>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

// ── HTTP helper ─────────────────────────────────────────────────────────

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("reqwest client")
}

// ── Keychain helpers ───────────────────────────────────────────────────

fn secrets_get(app: &AppHandle, state: &SecretsState, account: &str) -> Result<Option<String>, String> {
    secrets::secrets_get_inner(app, state, KEYRING_SERVICE, account)
}

fn secrets_set(app: &AppHandle, state: &SecretsState, account: &str, value: &str) -> Result<(), String> {
    secrets::secrets_set_inner(app, state, KEYRING_SERVICE, account, value)
}

fn secrets_delete(app: &AppHandle, state: &SecretsState, account: &str) -> Result<(), String> {
    secrets::secrets_delete_inner(app, state, KEYRING_SERVICE, account)
}

// ── OAuth Device Flow ──────────────────────────────────────────────────

#[tauri::command]
pub fn copilot_start_device_flow() -> Result<DeviceFlowStart, String> {
    let c = client();
    let body = serde_json::json!({
        "client_id": COPILOT_CLIENT_ID,
        "scope": "read:user",
    });
    let res = c
        .post("https://github.com/login/device/code")
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .header("editor-version", "vscode/1.85.0")
        .header("user-agent", "GithubCopilot/1.155.0")
        .json(&body)
        .send()
        .map_err(|e| format!("Device flow request failed: {e}"))?;
    let status = res.status();
    let parsed: DeviceCodeResponse =
        res.json().map_err(|e| format!("Device flow parse failed ({status}): {e}"))?;
    Ok(DeviceFlowStart {
        device_code: parsed.device_code,
        user_code: parsed.user_code,
        verification_uri: parsed.verification_uri,
        interval: parsed.interval,
    })
}

#[tauri::command]
pub fn copilot_poll_token(device_code: String) -> Result<Option<String>, String> {
    let c = client();
    let body = serde_json::json!({
        "client_id": COPILOT_CLIENT_ID,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    });
    let res = c
        .post("https://github.com/login/oauth/access_token")
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Token poll request failed: {e}"))?;
    let parsed: TokenPollResponse =
        res.json().map_err(|e| format!("Token poll parse failed: {e}"))?;

    if let Some(token) = parsed.access_token {
        return Ok(Some(token));
    }
    match parsed.error.as_deref() {
        Some("authorization_pending") | Some("slow_down") => Ok(None),
        Some("expired_token") => Err("Device flow expired. Please restart.".to_string()),
        Some("access_denied") => Err("Access denied by user.".to_string()),
        Some(other) => Err(format!("GitHub OAuth error: {other}")),
        None => Err("Unknown GitHub OAuth response.".to_string()),
    }
}

// ── Copilot token exchange ─────────────────────────────────────────────

#[tauri::command]
pub fn copilot_exchange_token(gho_token: String) -> Result<CopilotTokenInfo, String> {
    let c = client();
    let res = c
        .get("https://api.github.com/copilot_internal/v2/token")
        .header("authorization", format!("token {}", gho_token))
        .header("Copilot-Integration-Id", "vscode-chat")
        .header("editor-version", "vscode/1.85.0")
        .header("user-agent", "GithubCopilot/1.155.0")
        .send()
        .map_err(|e| format!("Token exchange request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("Copilot token exchange failed with status {status}"));
    }
    let parsed: CopilotTokenResponse =
        res.json().map_err(|e| format!("Token exchange parse failed: {e}"))?;
    Ok(CopilotTokenInfo {
        token: parsed.token,
        expires_at: parsed.expires_at,
    })
}

// ── Model fetching ─────────────────────────────────────────────────────

#[tauri::command]
pub fn copilot_fetch_models(copilot_token: String) -> Result<Vec<CopilotModel>, String> {
    let c = client();
    let res = c
        .get("https://api.githubcopilot.com/models")
        .header("authorization", format!("Bearer {}", copilot_token))
        .header("editor-version", "vscode/1.85.0")
        .header("user-agent", "GithubCopilot/1.155.0")
        .header("Copilot-Integration-Id", "vscode-chat")
        .header("openai-intent", "conversation-panel")
        .send()
        .map_err(|e| format!("Models request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Models fetch failed with status {}", res.status()));
    }
    let parsed: ModelsResponse =
        res.json().map_err(|e| format!("Models parse failed: {e}"))?;
    let entries = parsed.data.unwrap_or_default();
    Ok(entries
        .into_iter()
        .map(|m| CopilotModel {
            name: m.name.unwrap_or_else(|| m.id.clone()),
            id: m.id,
        })
        .collect())
}

// ── Token persistence ──────────────────────────────────────────────────

#[tauri::command]
pub fn copilot_persist_auth(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    gho_token: String,
    copilot_token: String,
    expires_at: u64,
) -> Result<(), String> {
    secrets_set(&app, &state, KEYRING_ACCOUNT_GHO, &gho_token)?;
    secrets_set(&app, &state, KEYRING_ACCOUNT_COPILOT, &copilot_token)?;
    secrets_set(&app, &state, KEYRING_ACCOUNT_EXPIRES, &expires_at.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn copilot_clear_auth(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<(), String> {
    let _ = secrets_delete(&app, &state, KEYRING_ACCOUNT_GHO);
    let _ = secrets_delete(&app, &state, KEYRING_ACCOUNT_COPILOT);
    let _ = secrets_delete(&app, &state, KEYRING_ACCOUNT_EXPIRES);
    Ok(())
}

#[tauri::command]
pub fn copilot_get_auth(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    if let Ok(Some(v)) = secrets_get(&app, &state, KEYRING_ACCOUNT_GHO) {
        out.insert("gho_token".to_string(), v);
    }
    if let Ok(Some(v)) = secrets_get(&app, &state, KEYRING_ACCOUNT_COPILOT) {
        out.insert("copilot_token".to_string(), v);
    }
    if let Ok(Some(v)) = secrets_get(&app, &state, KEYRING_ACCOUNT_EXPIRES) {
        out.insert("expires_at".to_string(), v);
    }
    Ok(out)
}

/// Ensure a valid copilot_token exists, refreshing if needed.
/// Returns the token on success, empty string if not authenticated.
#[tauri::command]
pub fn copilot_ensure_token(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
) -> Result<String, String> {
    let gho = secrets_get(&app, &state, KEYRING_ACCOUNT_GHO)?;
    let gho = match gho {
        Some(t) => t,
        None => return Ok(String::new()),
    };

    let existing = secrets_get(&app, &state, KEYRING_ACCOUNT_COPILOT)?;
    let expires = secrets_get(&app, &state, KEYRING_ACCOUNT_EXPIRES)?
        .and_then(|s| s.parse::<u64>().ok());

    // If existing token is still valid (> 60s buffer), return it.
    if let (Some(token), Some(exp)) = (&existing, expires) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now < exp.saturating_sub(60) {
            return Ok(token.clone());
        }
    }

    // Refresh.
    let info = copilot_exchange_token(gho)?;
    secrets_set(&app, &state, KEYRING_ACCOUNT_COPILOT, &info.token)?;
    secrets_set(&app, &state, KEYRING_ACCOUNT_EXPIRES, &info.expires_at.to_string())?;
    Ok(info.token)
}
