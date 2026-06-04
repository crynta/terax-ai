//! Cursor usage for the header indicator.
//!
//! Unlike Claude/Codex, Cursor stores its credential as a JWT (not a cookie)
//! in a SQLite DB: `<config>/Cursor/User/globalStorage/state.vscdb`, row
//! `ItemTable` key `cursorAuth/accessToken`. The live usage lives on Cursor's
//! side at `https://cursor.com/api/usage-summary`, which authenticates via a
//! `WorkosCursorSessionToken=<sub>::<jwt>` cookie — where `<sub>` is the JWT's
//! own `sub` claim (the bare WorkOS id, stripped of any `github|`/`auth0|`
//! prefix). So the JWT alone is enough; no browser cookies are read.
//!
//! Same cache + rate-limit discipline as `claude_usage`/`codex_usage`.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

const USAGE_URL: &str = "https://cursor.com/api/usage-summary";
const USER_AGENT: &str = "terax-cursor-usage";
const CACHE_MAX_AGE: u64 = 180;
const LOCK_MAX_AGE: u64 = 30;
const DEFAULT_BACKOFF: u64 = 300;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct UsageWindow {
    pub label: String,
    pub utilization: Option<f64>,
    pub resets_at: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct CursorUsage {
    pub windows: Vec<UsageWindow>,
    pub note: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `<config>/Cursor/User/globalStorage/state.vscdb` — `dirs::config_dir()`
/// already resolves to the right base per-OS (`~/.config`, `~/Library/
/// Application Support`, `%APPDATA%`).
fn vscdb_path() -> Option<PathBuf> {
    Some(
        dirs::config_dir()?
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
    )
}

fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_default().join("terax")
}

fn cache_file() -> PathBuf {
    cache_dir().join("cursor-usage.json")
}

fn lock_file() -> PathBuf {
    cache_dir().join("cursor-usage.lock")
}

fn file_age_secs(path: &PathBuf) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let secs = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(now_secs().saturating_sub(secs))
}

fn read_cache(max_age: Option<u64>) -> Option<CursorUsage> {
    let path = cache_file();
    if let Some(max) = max_age {
        if file_age_secs(&path)? >= max {
            return None;
        }
    } else {
        file_age_secs(&path)?;
    }
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_cache(usage: &CursorUsage) {
    let dir = cache_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(json) = serde_json::to_string(usage) {
        let _ = std::fs::write(cache_file(), json);
    }
}

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

// --- credentials (SQLite + JWT) ---------------------------------------------

/// Read the Cursor access-token JWT from `state.vscdb`. Opened read-only so we
/// don't contend with a running Cursor instance.
fn read_token() -> Option<String> {
    let path = vscdb_path()?;
    let conn = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let token: String = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'",
            [],
            |row| row.get(0),
        )
        .ok()?;
    (!token.is_empty()).then_some(token)
}

/// The bare WorkOS subject from the JWT payload (`github|user_01…` → `user_01…`).
fn jwt_sub(token: &str) -> Option<String> {
    let payload_b64 = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .ok()?;
    #[derive(Deserialize)]
    struct Claims {
        sub: Option<String>,
    }
    let claims: Claims = serde_json::from_slice(&bytes).ok()?;
    let sub = claims.sub?;
    Some(sub.rsplit('|').next().unwrap_or(&sub).to_string())
}

// --- usage-summary response -------------------------------------------------

#[derive(Deserialize)]
struct UsageSummary {
    #[serde(rename = "billingCycleEnd")]
    billing_cycle_end: Option<String>,
    #[serde(rename = "membershipType")]
    membership_type: Option<String>,
    #[serde(rename = "individualUsage")]
    individual_usage: Option<IndividualUsage>,
}

#[derive(Deserialize)]
struct IndividualUsage {
    plan: Option<Plan>,
}

#[derive(Deserialize)]
struct Plan {
    #[serde(rename = "totalPercentUsed")]
    total_percent_used: Option<f64>,
    #[serde(rename = "autoPercentUsed")]
    auto_percent_used: Option<f64>,
    #[serde(rename = "apiPercentUsed")]
    api_percent_used: Option<f64>,
}

fn to_usage(resp: UsageSummary) -> CursorUsage {
    let reset = resp.billing_cycle_end;
    let mut windows = Vec::new();
    if let Some(plan) = resp.individual_usage.and_then(|u| u.plan) {
        let mut push = |label: &str, pct: Option<f64>| {
            windows.push(UsageWindow {
                label: label.to_string(),
                utilization: pct,
                resets_at: reset.clone(),
            });
        };
        push("total", plan.total_percent_used);
        push("auto", plan.auto_percent_used);
        push("api", plan.api_percent_used);
    }
    let note = resp.membership_type.map(|m| format!("{m} plan"));
    CursorUsage { windows, note }
}

enum ApiResult {
    Ok(CursorUsage),
    RateLimited(u64),
    Error,
}

async fn fetch_api(sub: &str, token: &str) -> ApiResult {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return ApiResult::Error,
    };
    // `%3A%3A` (== `::`) is the verified-working separator the server expects.
    let cookie = format!("WorkosCursorSessionToken={sub}%3A%3A{token}");
    let resp = match client
        .get(USAGE_URL)
        .header("Cookie", cookie)
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
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
        Ok(body) => match serde_json::from_str::<UsageSummary>(&body) {
            Ok(u) => ApiResult::Ok(to_usage(u)),
            Err(_) => ApiResult::Error,
        },
        Err(_) => ApiResult::Error,
    }
}

fn stale_or_err(msg: &str) -> Result<CursorUsage, String> {
    read_cache(None).ok_or_else(|| msg.to_string())
}

#[tauri::command]
pub async fn cursor_usage() -> Result<CursorUsage, String> {
    let now = now_secs();

    if let Some(u) = read_cache(Some(CACHE_MAX_AGE)) {
        return Ok(u);
    }
    if read_active_lock(now).is_some() {
        return stale_or_err("rate-limited");
    }
    write_lock(now + LOCK_MAX_AGE);

    let token = match read_token() {
        Some(t) => t,
        None => return stale_or_err("no Cursor credentials"),
    };
    let sub = match jwt_sub(&token) {
        Some(s) => s,
        None => return stale_or_err("unreadable Cursor token"),
    };

    match fetch_api(&sub, &token).await {
        ApiResult::Ok(usage) => {
            write_cache(&usage);
            Ok(usage)
        }
        ApiResult::RateLimited(retry) => {
            write_lock(now + retry);
            stale_or_err("rate-limited")
        }
        ApiResult::Error => stale_or_err("usage unavailable"),
    }
}

/// (installed, authed) for the CLI-detection command.
pub fn detect() -> (bool, bool) {
    let db = vscdb_path();
    let installed = db
        .as_ref()
        .and_then(|p| p.parent().map(|d| d.exists()))
        .unwrap_or(false);
    let authed = db.map(|p| p.is_file()).unwrap_or(false) && read_token().is_some();
    (installed, authed)
}
