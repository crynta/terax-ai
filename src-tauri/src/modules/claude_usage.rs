//! Claude subscription usage for the header indicator.
//!
//! Reads the Claude Code OAuth access token from `~/.claude/.credentials.json`
//! and queries the (undocumented) `/api/oauth/usage` endpoint — the same one
//! Claude Code's own status bar uses — for the 5-hour and 7-day limit
//! utilization. Not an official API; the shape may change without notice.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
// The endpoint hard rate-limits requests without a claude-code User-Agent.
const USER_AGENT: &str = "claude-code/2.0.0";
const OAUTH_BETA: &str = "oauth-2025-04-20";

#[derive(Deserialize)]
struct Credentials {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OauthCreds>,
}

#[derive(Deserialize)]
struct OauthCreds {
    #[serde(rename = "accessToken")]
    access_token: String,
}

#[derive(Deserialize, Serialize, Default)]
pub struct UsageWindow {
    pub utilization: Option<f64>,
    pub resets_at: Option<String>,
}

#[derive(Deserialize, Serialize, Default)]
pub struct ClaudeUsage {
    #[serde(default)]
    pub five_hour: UsageWindow,
    #[serde(default)]
    pub seven_day: UsageWindow,
}

fn read_token() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("no home directory")?;
    let path = home.join(".claude").join(".credentials.json");
    let data =
        std::fs::read_to_string(&path).map_err(|e| format!("read credentials: {e}"))?;
    let creds: Credentials =
        serde_json::from_str(&data).map_err(|e| format!("parse credentials: {e}"))?;
    creds
        .claude_ai_oauth
        .map(|o| o.access_token)
        .ok_or_else(|| "no claudeAiOauth token in credentials".into())
}

#[tauri::command]
pub async fn claude_usage() -> Result<ClaudeUsage, String> {
    let token = read_token()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", OAUTH_BETA)
        .header("User-Agent", USER_AGENT)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("usage endpoint returned {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| format!("parse usage: {e}"))
}
