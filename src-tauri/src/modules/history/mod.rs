pub mod db;
mod parse;

use db::Db;
use parse::{
    build_index, complete_commands, demetafy, list, parse_bash, parse_fish, parse_zsh, sort_recent,
    suggest, HistEntry,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use regex::Regex;

struct Index {
    entries: Vec<HistEntry>,
    path_cmds: Vec<String>,
}

struct Inner {
    index: Option<Index>,
    db: Option<Db>,
}

#[derive(Default)]
pub struct HistoryState {
    inner: Mutex<Option<Inner>>,
}

#[derive(Serialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub command: String,
    pub timestamp: i64,
    pub exit_code: Option<i32>,
    pub session_id: String,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_histories() -> Vec<(String, i64)> {
    let mut all = Vec::new();
    let home = dirs::home_dir();

    if let Some(path) = zsh_histfile(home.as_ref()) {
        if let Ok(bytes) = std::fs::read(&path) {
            let content = String::from_utf8_lossy(&demetafy(&bytes)).into_owned();
            all.extend(parse_zsh(&content));
        }
    }
    if let Some(home) = home.as_ref() {
        if let Ok(content) = std::fs::read_to_string(home.join(".bash_history")) {
            all.extend(parse_bash(&content));
        }
    }
    if let Some(path) = fish_histfile(home.as_ref()) {
        if let Ok(content) = std::fs::read_to_string(&path) {
            all.extend(parse_fish(&content));
        }
    }
    all
}

fn zsh_histfile(home: Option<&PathBuf>) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HISTFILE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    home.map(|h| h.join(".zsh_history"))
}

fn fish_histfile(home: Option<&PathBuf>) -> Option<PathBuf> {
    if let Ok(data) = std::env::var("XDG_DATA_HOME") {
        let pb = PathBuf::from(data).join("fish/fish_history");
        if pb.exists() {
            return Some(pb);
        }
    }
    home.map(|h| h.join(".local/share/fish/fish_history"))
}

fn scan_path() -> Vec<String> {
    use std::collections::HashSet;
    let mut set: HashSet<String> = HashSet::new();
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in rd.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                if is_executable(&entry) {
                    if let Some(name) = entry.file_name().to_str() {
                        set.insert(name.to_string());
                    }
                }
            }
        }
    }
    let mut v: Vec<String> = set.into_iter().collect();
    v.sort();
    v
}

#[cfg(unix)]
fn is_executable(entry: &std::fs::DirEntry) -> bool {
    use std::os::unix::fs::PermissionsExt;
    entry
        .metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(entry: &std::fs::DirEntry) -> bool {
    match entry.file_name().to_str() {
        Some(name) => {
            let lower = name.to_ascii_lowercase();
            [".exe", ".cmd", ".bat", ".com", ".ps1"]
                .iter()
                .any(|e| lower.ends_with(e))
        }
        None => false,
    }
}

fn history_db_path(custom_path: &str) -> PathBuf {
    if !custom_path.is_empty() {
        return PathBuf::from(custom_path);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".terax-ai")
        .join("history.db")
}

fn ensure(
    state: &HistoryState,
    app: &tauri::AppHandle,
) -> std::sync::MutexGuard<'_, Option<Inner>> {
    use tauri_plugin_store::StoreExt;
    let (db_path, max_entries) = if let Some(store) = app.get_store("terax-settings.json") {
        let db_path = store
            .get("historyDbPath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let max_entries = store
            .get("historyMaxEntries")
            .and_then(|v| v.as_u64().map(|n| n as usize))
            .unwrap_or(50_000);
        (db_path, max_entries)
    } else {
        ("".to_string(), 50_000)
    };
    ensure_with_config(state, &db_path, max_entries)
}

fn ensure_with_config<'a>(
    state: &'a HistoryState,
    db_path: &str,
    max_entries: usize,
) -> std::sync::MutexGuard<'a, Option<Inner>> {
    let mut guard = state.inner.lock().unwrap();
    if guard.is_none() {
        let path = history_db_path(db_path);
        
        let mut db_conn_opt = None;
        let mut entries = Vec::new();

        match Db::open(&path) {
            Ok(db_conn) => {
                let is_empty = db_conn.is_empty().unwrap_or(true);
                if is_empty {
                    let shell_entries = read_histories();
                    if !shell_entries.is_empty() {
                        if let Err(e) = db_conn.seed(&shell_entries) {
                            log::warn!("[history] seed failed: {e}");
                        }
                    }
                }
                if let Err(e) = db_conn.trim(max_entries) {
                    log::warn!("[history] initial trim failed: {e}");
                }
                
                match db_conn.load_all() {
                    Ok(rows) => {
                        entries = rows;
                    }
                    Err(e) => {
                        log::error!("[history] failed to load entries from db: {e}");
                    }
                }
                db_conn_opt = Some(db_conn);
            }
            Err(e) => {
                log::error!("[history] could not open history db: {e}");
                entries = read_histories();
            }
        }

        let index = Index {
            entries: build_index(entries),
            path_cmds: scan_path(),
        };

        *guard = Some(Inner {
            index: Some(index),
            db: db_conn_opt,
        });
    }
    guard
}

#[tauri::command]
pub fn history_suggest(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
    line: String,
) -> Option<String> {
    let guard = ensure(&state, &app);
    let inner = guard.as_ref()?;
    suggest(&inner.index.as_ref()?.entries, &line)
}

#[tauri::command]
pub fn history_commands(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
    prefix: String,
    limit: Option<usize>,
) -> Vec<String> {
    let guard = ensure(&state, &app);
    match guard.as_ref().and_then(|i| i.index.as_ref()) {
        Some(idx) => complete_commands(&idx.entries, &idx.path_cmds, &prefix, limit.unwrap_or(50)),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn history_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
    query: String,
    limit: Option<usize>,
) -> Vec<String> {
    let guard = ensure(&state, &app);
    match guard.as_ref().and_then(|i| i.index.as_ref()) {
        Some(idx) => list(&idx.entries, &query, limit.unwrap_or(200)),
        None => Vec::new(),
    }
}

// Returns full entries (with id, timestamp, exit_code, session_id) from the DB
// for the history management UI. Falls back to an empty list if the DB is
// unavailable.
#[tauri::command]
pub fn history_list_full(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Vec<HistoryEntry> {
    let guard = ensure(&state, &app);
    let Some(inner) = guard.as_ref() else {
        return Vec::new();
    };
    let Some(db) = &inner.db else {
        return Vec::new();
    };
    match db.list(&query, limit.unwrap_or(200), offset.unwrap_or(0)) {
        Ok(rows) => rows
            .into_iter()
            .map(|e| HistoryEntry {
                id: e.id,
                command: e.command,
                timestamp: e.timestamp,
                exit_code: e.exit_code,
                session_id: e.session_id,
            })
            .collect(),
        Err(e) => {
            log::warn!("[history] history_list_full query failed: {e}");
            Vec::new()
        }
    }
}

fn redact_command(cmd: &str) -> String {
    static RE_PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let patterns = RE_PATTERNS.get_or_init(|| {
        vec![
            (Regex::new(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b").unwrap(), "<REDACTED:openai-key>"),
            (Regex::new(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b").unwrap(), "<REDACTED:anthropic-key>"),
            (Regex::new(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b").unwrap(), "<REDACTED:aws-access-key>"),
            (Regex::new(r"\bgh[opsur]_[A-Za-z0-9]{36,}\b").unwrap(), "<REDACTED:github-token>"),
            (Regex::new(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b").unwrap(), "<REDACTED:github-pat>"),
            (Regex::new(r"\bAIza[0-9A-Za-z_-]{35}\b").unwrap(), "<REDACTED:google-api-key>"),
            (Regex::new(r"\bxox[bpsare]-[A-Za-z0-9-]{10,}\b").unwrap(), "<REDACTED:slack-token>"),
            (Regex::new(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b").unwrap(), "<REDACTED:stripe-key>"),
            (Regex::new(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b").unwrap(), "<REDACTED:jwt>"),
            (Regex::new(r"\bBearer\s+[A-Za-z0-9._-]{20,}").unwrap(), "<REDACTED:bearer>"),
        ]
    });

    let mut out = cmd.to_string();
    for (re, replacement) in patterns {
        out = re.replace_all(&out, *replacement).into_owned();
    }
    
    static RE_ENV: OnceLock<Regex> = OnceLock::new();
    let re_env = RE_ENV.get_or_init(|| {
        Regex::new(r"(?i)\b((?:[A-Z][A-Z0-9_]*)?(?:API[_-]?KEY|SECRET(?:[_-]?KEY)?|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET)[A-Z0-9_]*)\s*[:=]\s*(['\"]?)([^\s'\"`;|&]+)\2").unwrap()
    });
    out = re_env.replace_all(&out, |caps: &regex::Captures| {
        let name = &caps[1];
        let q = &caps[2];
        format!("{}={}<REDACTED>{}", name, q, q)
    }).into_owned();

    out
}

// Called on every accepted command so in-memory history stays hot without a
// re-read. Only ever fed prompt-mode commands, never raw running-mode input,
// so passwords typed into a running command never enter history.
#[tauri::command]
pub fn history_record(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
    command: String,
    exit_code: Option<i32>,
    session_id: Option<String>,
    max_entries: Option<usize>,
) {
    let cmd = command.trim();
    if cmd.is_empty() {
        return;
    }
    let cmd = redact_command(cmd);
    
    let mut guard = ensure(&state, &app);
    let Some(inner) = guard.as_mut() else {
        return;
    };

    let n = now();
    let sess = session_id.as_deref().unwrap_or("");
    let max = max_entries.unwrap_or(50_000);

    // Persist to disk first.
    if let Some(db) = &inner.db {
        match db.insert(&cmd, n, exit_code, sess) {
            Ok(_) => {
                if let Err(e) = db.trim(max) {
                    log::warn!("[history] trim failed: {e}");
                }
            }
            Err(e) => log::warn!("[history] insert failed: {e}"),
        }
    }

    // Update the in-memory index for fast completions.
    if let Some(idx) = &mut inner.index {
        match idx.entries.iter_mut().find(|e| e.cmd == cmd) {
            Some(e) => {
                e.count += 1;
                e.last = n;
            }
            None => idx.entries.push(HistEntry {
                cmd: cmd.clone(),
                count: 1,
                last: n,
            }),
        }
        sort_recent(&mut idx.entries);
    }
}

#[tauri::command]
pub fn history_clear(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
) -> Result<(), String> {
    let mut guard = ensure(&state, &app);
    let Some(inner) = guard.as_mut() else {
        return Ok(());
    };

    if let Some(db) = &inner.db {
        db.clear().map_err(|e| e.to_string())?;
    }

    // Wipe the in-memory index too so completions reflect the cleared state.
    if let Some(idx) = &mut inner.index {
        idx.entries.clear();
    }

    Ok(())
}

#[tauri::command]
pub fn history_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, HistoryState>,
    id: i64,
) -> Result<(), String> {
    let mut guard = ensure(&state, &app);
    let Some(inner) = guard.as_mut() else {
        return Ok(());
    };

    let mut cmd_to_delete = None;
    if let Some(db) = &inner.db {
        if let Ok(Some(cmd)) = db.get_command(id) {
            cmd_to_delete = Some(cmd);
        }
        db.delete(id).map_err(|e| e.to_string())?;
    }

    if let Some(cmd) = cmd_to_delete {
        if let Some(idx) = &mut inner.index {
            if let Some(pos) = idx.entries.iter().position(|e| e.cmd == cmd) {
                if idx.entries[pos].count <= 1 {
                    idx.entries.remove(pos);
                } else {
                    idx.entries[pos].count -= 1;
                }
            }
        }
    }

    Ok(())
}
