//! Claude subscription usage for the header indicator.
//!
//! Mirrors how `ccstatusline` sources this data:
//!   1. The OAuth access token is read **locally** from Claude Code's own
//!      credentials (`$CLAUDE_CONFIG_DIR`/`~/.claude/.credentials.json`) — no
//!      login prompt, no separate auth.
//!   2. The live 5-hour / 7-day limit utilization itself only exists on
//!      Anthropic's side, fetched from the undocumented `/api/oauth/usage`
//!      endpoint (same host/path ccstatusline uses). There is no local file
//!      with the live percentages.
//!
//! To stay friendly to that endpoint (and avoid 429 bans) we cache like
//! ccstatusline does: a fresh disk cache is served without any network call,
//! the API is hit at most once per 30s, and 429s back off via Retry-After. If
//! ccstatusline is installed and its cache is fresh, we read that directly —
//! then this is fully network-free.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT: &str = "claude-code/2.0.0";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const CACHE_MAX_AGE: u64 = 180; // serve disk cache without a network call
const LOCK_MAX_AGE: u64 = 30; // hit the API at most once per 30s
const DEFAULT_BACKOFF: u64 = 300; // 429 fallback when no Retry-After

#[derive(Deserialize, Serialize, Default, Clone)]
pub struct UsageWindow {
    pub utilization: Option<f64>,
    pub resets_at: Option<String>,
}

#[derive(Deserialize, Serialize, Default, Clone)]
pub struct ClaudeUsage {
    #[serde(default)]
    pub five_hour: UsageWindow,
    #[serde(default)]
    pub seven_day: UsageWindow,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn claude_config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".claude")
}

fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_default().join("terax")
}

fn cache_file() -> PathBuf {
    cache_dir().join("usage.json")
}

fn lock_file() -> PathBuf {
    cache_dir().join("usage.lock")
}

/// Age of a file in seconds, or None if it doesn't exist / can't be read.
fn file_age_secs(path: &PathBuf) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let secs = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(now_secs().saturating_sub(secs))
}

// --- ccstatusline's cache (already-fetched percentages) ---------------------

#[derive(Deserialize)]
struct CcstatuslineCache {
    #[serde(rename = "sessionUsage")]
    session_usage: Option<f64>,
    #[serde(rename = "sessionResetAt")]
    session_reset_at: Option<String>,
    #[serde(rename = "weeklyUsage")]
    weekly_usage: Option<f64>,
    #[serde(rename = "weeklyResetAt")]
    weekly_reset_at: Option<String>,
}

fn read_ccstatusline_cache() -> Option<ClaudeUsage> {
    let path = dirs::cache_dir()?.join("ccstatusline").join("usage.json");
    if file_age_secs(&path)? >= CACHE_MAX_AGE {
        return None;
    }
    let data = std::fs::read_to_string(&path).ok()?;
    let c: CcstatuslineCache = serde_json::from_str(&data).ok()?;
    if c.session_usage.is_none() && c.weekly_usage.is_none() {
        return None;
    }
    Some(ClaudeUsage {
        five_hour: UsageWindow {
            utilization: c.session_usage,
            resets_at: c.session_reset_at,
        },
        seven_day: UsageWindow {
            utilization: c.weekly_usage,
            resets_at: c.weekly_reset_at,
        },
    })
}

// --- our own cache + rate-limit lock ----------------------------------------

fn read_our_cache(max_age: Option<u64>) -> Option<ClaudeUsage> {
    let path = cache_file();
    if let Some(max) = max_age {
        if file_age_secs(&path)? >= max {
            return None;
        }
    } else {
        file_age_secs(&path)?; // existence check
    }
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_our_cache(usage: &ClaudeUsage) {
    let dir = cache_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(json) = serde_json::to_string(usage) {
        let _ = std::fs::write(cache_file(), json);
    }
}

/// Returns the unix time the lock is active until, if still locked.
fn read_active_lock(now: u64) -> Option<u64> {
    let data = std::fs::read_to_string(lock_file()).ok()?;
    let blocked_until: u64 = data.trim().parse().ok()?;
    (blocked_until > now).then_some(blocked_until)
}

fn write_lock(blocked_until: u64) {
    let dir = cache_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(lock_file(), blocked_until.to_string());
}

fn read_token() -> Option<String> {
    #[derive(Deserialize)]
    struct Credentials {
        #[serde(rename = "claudeAiOauth")]
        claude_ai_oauth: Option<OauthCreds>,
    }
    #[derive(Deserialize)]
    struct OauthCreds {
        #[serde(rename = "accessToken")]
        access_token: Option<String>,
    }
    let path = claude_config_dir().join(".credentials.json");
    let data = std::fs::read_to_string(path).ok()?;
    let creds: Credentials = serde_json::from_str(&data).ok()?;
    creds.claude_ai_oauth.and_then(|o| o.access_token)
}

enum ApiResult {
    Ok(ClaudeUsage),
    RateLimited(u64),
    Error,
}

async fn fetch_api(token: &str) -> ApiResult {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return ApiResult::Error,
    };
    let resp = match client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", OAUTH_BETA)
        .header("User-Agent", USER_AGENT)
        .header("Content-Type", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return ApiResult::Error,
    };
    if resp.status().as_u16() == 429 {
        let retry = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(DEFAULT_BACKOFF);
        return ApiResult::RateLimited(retry);
    }
    if !resp.status().is_success() {
        return ApiResult::Error;
    }
    match resp.text().await {
        Ok(body) => match serde_json::from_str::<ClaudeUsage>(&body) {
            Ok(u) => ApiResult::Ok(u),
            Err(_) => ApiResult::Error,
        },
        Err(_) => ApiResult::Error,
    }
}

/// Stale cache if we have one, else an error string.
fn stale_or_err(msg: &str) -> Result<ClaudeUsage, String> {
    read_our_cache(None).ok_or_else(|| msg.to_string())
}

#[tauri::command]
pub async fn claude_usage() -> Result<ClaudeUsage, String> {
    let now = now_secs();

    // 1. ccstatusline's fresh cache → fully local, no network.
    if let Some(u) = read_ccstatusline_cache() {
        return Ok(u);
    }
    // 2. Our own fresh cache.
    if let Some(u) = read_our_cache(Some(CACHE_MAX_AGE)) {
        return Ok(u);
    }
    // 3. Respect the rate-limit lock — serve stale rather than spam the API.
    if read_active_lock(now).is_some() {
        return stale_or_err("rate-limited");
    }
    // 4. Claim the lock for the next 30s before calling out.
    write_lock(now + LOCK_MAX_AGE);

    let token = match read_token() {
        Some(t) => t,
        None => return stale_or_err("no Claude Code credentials"),
    };

    match fetch_api(&token).await {
        ApiResult::Ok(usage) => {
            write_our_cache(&usage);
            Ok(usage)
        }
        ApiResult::RateLimited(retry) => {
            write_lock(now + retry);
            stale_or_err("rate-limited")
        }
        ApiResult::Error => stale_or_err("usage unavailable"),
    }
}
