use serde::Serialize;
use std::process::{Command, Stdio};
use std::time::Duration;

// GitHub OAuth App client ID used for the Device Flow.
// This is the public GitHub CLI client ID, widely used for desktop/CLI OAuth flows.
// To use a dedicated "Terax" app instead, register one at
// https://github.com/settings/developers and replace this constant.
const GITHUB_CLIENT_ID: &str = "178c6fc778ccc68e1d6a";

// ─── CLI Status ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotCliStatus {
    available: bool,
    version: Option<String>,
}

#[tauri::command]
pub fn copilot_cli_status() -> CopilotCliStatus {
    match copilot_version() {
        Ok(version) => CopilotCliStatus {
            available: true,
            version: Some(version),
        },
        Err(e) => {
            log::debug!("copilot cli status check failed: {e}");
            CopilotCliStatus {
                available: false,
                version: None,
            }
        }
    }
}

// ─── OAuth Device Flow ─────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowStart {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u32,
    interval: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowPoll {
    /// Non-null when authentication completed successfully.
    access_token: Option<String>,
    /// "pending", "slow_down", "expired_token", "access_denied", "error"
    status: String,
}

#[tauri::command]
pub async fn copilot_oauth_start() -> Result<DeviceFlowStart, String> {
    let client = build_https_client()?;
    let body = format!("client_id={}&scope=read%3Auser", GITHUB_CLIENT_ID);
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse error: {e}\nbody: {text}"))?;

    Ok(DeviceFlowStart {
        device_code: str_field(&v, "device_code")?,
        user_code: str_field(&v, "user_code")?,
        verification_uri: str_field(&v, "verification_uri")?,
        expires_in: v
            .get("expires_in")
            .and_then(|x| x.as_u64())
            .unwrap_or(900) as u32,
        interval: v
            .get("interval")
            .and_then(|x| x.as_u64())
            .unwrap_or(5) as u32,
    })
}

#[tauri::command]
pub async fn copilot_oauth_poll(device_code: String) -> Result<DeviceFlowPoll, String> {
    let client = build_https_client()?;
    let body = format!(
        "client_id={}&device_code={}&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
        GITHUB_CLIENT_ID, device_code
    );
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse error: {e}"))?;

    if let Some(token) = v.get("access_token").and_then(|x| x.as_str()) {
        return Ok(DeviceFlowPoll {
            access_token: Some(token.to_string()),
            status: "done".to_string(),
        });
    }

    let status = v
        .get("error")
        .and_then(|x| x.as_str())
        .unwrap_or("error")
        .to_string();

    Ok(DeviceFlowPoll {
        access_token: None,
        status,
    })
}

/// Try to extract an already-authenticated token from the `gh` CLI.
/// Returns `Some(token)` on success, `None` if gh is not installed or not logged in.
#[tauri::command]
pub fn copilot_try_gh_token() -> Option<String> {
    let output = gh_token_command()
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() || token.contains(' ') {
        None
    } else {
        Some(token)
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

fn build_https_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn str_field(v: &serde_json::Value, key: &str) -> Result<String, String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("missing field `{key}`"))
}

// ─── copilot_version / CLI helpers (unchanged) ────────────────────────────────

fn copilot_version() -> Result<String, String> {
    run_version_command(direct_copilot_command()).or_else(|direct_err| {
        run_version_command(shell_copilot_command()).map_err(|shell_err| {
            format!("direct copilot failed: {direct_err}; shell copilot failed: {shell_err}")
        })
    })
}

fn run_version_command(mut command: Command) -> Result<String, String> {
    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("failed to run copilot --version: {e}"))?;
    if !output.status.success() {
        return Err(format!("copilot --version exited with {}", output.status));
    }
    let text = String::from_utf8_lossy(if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    })
    .trim()
    .to_string();
    Ok(if text.is_empty() {
        "GitHub Copilot CLI".to_string()
    } else {
        text
    })
}

fn direct_copilot_command() -> Command {
    let mut command = command_no_window("copilot");
    command.arg("--version");
    command
}

#[cfg(target_os = "windows")]
fn shell_copilot_command() -> Command {
    let mut command = command_no_window("powershell.exe");
    command.args(["-NoProfile", "-Command", "copilot --version"]);
    command
}

#[cfg(not(target_os = "windows"))]
fn shell_copilot_command() -> Command {
    let mut command = command_no_window("sh");
    command.args(["-lc", "copilot --version"]);
    command
}

#[cfg(target_os = "windows")]
fn gh_token_command() -> Command {
    let mut command = command_no_window("powershell.exe");
    command.args(["-NoProfile", "-Command", "gh auth token"]);
    command
}

#[cfg(not(target_os = "windows"))]
fn gh_token_command() -> Command {
    let mut command = command_no_window("sh");
    command.args(["-lc", "gh auth token"]);
    command
}

#[cfg(target_os = "windows")]
fn command_no_window(program: &str) -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(target_os = "windows"))]
fn command_no_window(program: &str) -> Command {
    Command::new(program)
}
