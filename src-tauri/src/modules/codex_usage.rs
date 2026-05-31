//! OpenAI Codex CLI subscription usage for the header indicator.
//!
//! Mirrors how CodexBar sources this: the ChatGPT OAuth access token is read
//! **locally** from Codex's own credentials (`$CODEX_HOME/auth.json`, default
//! `~/.codex/auth.json`) — no login prompt. The live rate-limit utilization
//! only exists on OpenAI's side, fetched from the same undocumented endpoint
//! the `codex` app uses: `https://chatgpt.com/backend-api/wham/usage`.
//!
//! There is no local file with the live percentages, so — exactly like
//! `claude_usage` — we cache to disk (served without a network call while
//! fresh), hit the API at most once per 30s, and back off on 429.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const USER_AGENT: &str = "terax-codex-usage";
const CACHE_MAX_AGE: u64 = 180; // serve disk cache without a network call
const LOCK_MAX_AGE: u64 = 30; // hit the API at most once per 30s
const DEFAULT_BACKOFF: u64 = 300; // 429 fallback when no Retry-After

/// One rate-limit window, normalized for the header. `resets_at` is either an
/// ISO-8601 string or epoch-millis digits — the frontend accepts both.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct UsageWindow {
    pub label: String,
    pub utilization: Option<f64>,
    pub resets_at: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct CodexUsage {
    pub windows: Vec<UsageWindow>,
    /// Free-form extra line (e.g. credits balance), shown in the tooltip.
    pub note: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn codex_home() -> PathBuf {
    if let Ok(dir) = std::env::var("CODEX_HOME") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".codex")
}

fn auth_file() -> PathBuf {
    codex_home().join("auth.json")
}

fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_default().join("terax")
}

fn cache_file() -> PathBuf {
    cache_dir().join("codex-usage.json")
}

fn lock_file() -> PathBuf {
    cache_dir().join("codex-usage.lock")
}

/// Age of a file in seconds, or None if it doesn't exist / can't be read.
fn file_age_secs(path: &PathBuf) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let secs = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(now_secs().saturating_sub(secs))
}

fn read_cache(max_age: Option<u64>) -> Option<CodexUsage> {
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

fn write_cache(usage: &CodexUsage) {
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

// --- Codex credentials ------------------------------------------------------

#[derive(Deserialize)]
struct CodexAuth {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: Option<CodexTokens>,
}

#[derive(Deserialize)]
struct CodexTokens {
    access_token: Option<String>,
    account_id: Option<String>,
}

fn read_auth() -> Option<CodexAuth> {
    let data = std::fs::read_to_string(auth_file()).ok()?;
    serde_json::from_str(&data).ok()
}

// --- usage endpoint response ------------------------------------------------

#[derive(Deserialize)]
struct WhamUsage {
    rate_limit: Option<RateLimit>,
    credits: Option<Credits>,
}

#[derive(Deserialize)]
struct RateLimit {
    primary_window: Option<Window>,
    secondary_window: Option<Window>,
}

#[derive(Deserialize)]
struct Window {
    used_percent: Option<f64>,
    reset_at: Option<i64>, // epoch seconds
    limit_window_seconds: Option<i64>,
}

#[derive(Deserialize)]
struct Credits {
    has_credits: Option<bool>,
    unlimited: Option<bool>,
    balance: Option<serde_json::Value>,
}

/// "5h" / "7d" / "30m" from a window length in seconds, else `fallback`.
fn window_label(secs: Option<i64>, fallback: &str) -> String {
    match secs {
        Some(s) if s > 0 && s % 86_400 == 0 => format!("{}d", s / 86_400),
        Some(s) if s > 0 && s % 3_600 == 0 => format!("{}h", s / 3_600),
        Some(s) if s > 0 => format!("{}m", s / 60),
        _ => fallback.to_string(),
    }
}

fn map_window(w: Window, fallback: &str) -> UsageWindow {
    UsageWindow {
        label: window_label(w.limit_window_seconds, fallback),
        utilization: w.used_percent,
        resets_at: w.reset_at.map(|s| (s * 1000).to_string()),
    }
}

fn to_usage(resp: WhamUsage) -> CodexUsage {
    let mut windows = Vec::new();
    if let Some(rl) = resp.rate_limit {
        if let Some(p) = rl.primary_window {
            windows.push(map_window(p, "5h"));
        }
        if let Some(s) = rl.secondary_window {
            windows.push(map_window(s, "7d"));
        }
    }

    let note = resp.credits.and_then(|c| {
        if c.unlimited == Some(true) {
            return Some("credits: unlimited".to_string());
        }
        if c.has_credits == Some(true) {
            return c.balance.map(|b| match b {
                serde_json::Value::String(s) => format!("credits: {s}"),
                serde_json::Value::Number(n) => format!("credits: {n}"),
                _ => "credits available".to_string(),
            });
        }
        None
    });

    CodexUsage { windows, note }
}

enum ApiResult {
    Ok(CodexUsage),
    RateLimited(u64),
    Error,
}

async fn fetch_api(token: &str, account_id: Option<&str>) -> ApiResult {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return ApiResult::Error,
    };
    let mut req = client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT);
    if let Some(id) = account_id {
        req = req.header("ChatGPT-Account-Id", id);
    }
    let resp = match req.send().await {
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
        Ok(body) => match serde_json::from_str::<WhamUsage>(&body) {
            Ok(u) => ApiResult::Ok(to_usage(u)),
            Err(_) => ApiResult::Error,
        },
        Err(_) => ApiResult::Error,
    }
}

/// Stale cache if we have one, else an error string.
fn stale_or_err(msg: &str) -> Result<CodexUsage, String> {
    read_cache(None).ok_or_else(|| msg.to_string())
}

#[tauri::command]
pub async fn codex_usage() -> Result<CodexUsage, String> {
    let now = now_secs();

    // 1. Our own fresh cache.
    if let Some(u) = read_cache(Some(CACHE_MAX_AGE)) {
        return Ok(u);
    }
    // 2. Respect the rate-limit lock — serve stale rather than spam the API.
    if read_active_lock(now).is_some() {
        return stale_or_err("rate-limited");
    }
    // 3. Claim the lock for the next 30s before calling out.
    write_lock(now + LOCK_MAX_AGE);

    let auth = match read_auth() {
        Some(a) => a,
        None => return stale_or_err("no Codex credentials"),
    };
    let tokens = auth.tokens.unwrap_or(CodexTokens {
        access_token: None,
        account_id: None,
    });
    let token = match tokens.access_token {
        Some(t) if !t.is_empty() => t,
        // API-key logins can't query the ChatGPT usage endpoint.
        _ if auth.openai_api_key.is_some() => {
            return Err("Codex is in API-key mode — usage not available".to_string());
        }
        _ => return stale_or_err("no Codex credentials"),
    };

    match fetch_api(&token, tokens.account_id.as_deref()).await {
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

// --- CLI detection ----------------------------------------------------------

#[derive(Serialize)]
pub struct CliStatus {
    /// Binary found on `$PATH`.
    pub installed: bool,
    /// Local credentials present (so usage can actually be shown).
    pub authed: bool,
}

#[derive(Serialize)]
pub struct AgentClis {
    pub claude: CliStatus,
    pub codex: CliStatus,
    pub cursor: CliStatus,
}

/// True if `name` (or, on Windows, `name.exe`/`name.cmd`) is on `$PATH`.
fn bin_on_path(name: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    let exts: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    std::env::split_paths(&path).any(|dir| {
        exts.iter().any(|ext| {
            let candidate = dir.join(format!("{name}{ext}"));
            candidate.is_file()
        })
    })
}

fn claude_creds_present() -> bool {
    let dir = std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".claude"));
    dir.join(".credentials.json").is_file()
}

fn codex_creds_present() -> bool {
    auth_file().is_file()
}

#[tauri::command]
pub fn agent_usage_clis() -> AgentClis {
    let (cursor_installed, cursor_authed) = crate::modules::cursor_usage::detect();
    AgentClis {
        claude: CliStatus {
            installed: bin_on_path("claude"),
            authed: claude_creds_present(),
        },
        codex: CliStatus {
            installed: bin_on_path("codex"),
            authed: codex_creds_present(),
        },
        cursor: CliStatus {
            installed: cursor_installed,
            authed: cursor_authed,
        },
    }
}
