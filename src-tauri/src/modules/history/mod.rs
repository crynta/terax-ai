mod parse;

use parse::{
    build_index, complete_commands, demetafy, list, parse_bash, parse_fish, parse_zsh, sort_recent,
    suggest, HistEntry,
};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

struct Index {
    entries: Vec<HistEntry>,
    path_cmds: Vec<String>,
}

#[derive(Default)]
pub struct HistoryState {
    inner: Mutex<Option<Index>>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
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

fn ensure(state: &HistoryState) -> Option<std::sync::MutexGuard<'_, Option<Index>>> {
    let mut guard = match state.inner.lock() {
        Ok(guard) => guard,
        Err(error) => {
            log::error!("history index lock failed: {error}");
            return None;
        }
    };
    if guard.is_none() {
        *guard = Some(Index {
            entries: build_index(read_histories()),
            path_cmds: scan_path(),
        });
    }
    Some(guard)
}

#[tauri::command]
pub fn history_suggest(state: tauri::State<'_, HistoryState>, line: String) -> Option<String> {
    let guard = ensure(&state)?;
    suggest(&guard.as_ref()?.entries, &line)
}

#[tauri::command]
pub fn history_commands(
    state: tauri::State<'_, HistoryState>,
    prefix: String,
    limit: Option<usize>,
) -> Vec<String> {
    let Some(guard) = ensure(&state) else {
        return Vec::new();
    };
    match guard.as_ref() {
        Some(idx) => complete_commands(&idx.entries, &idx.path_cmds, &prefix, limit.unwrap_or(50)),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn history_list(
    state: tauri::State<'_, HistoryState>,
    query: String,
    limit: Option<usize>,
) -> Vec<String> {
    let Some(guard) = ensure(&state) else {
        return Vec::new();
    };
    match guard.as_ref() {
        Some(idx) => list(&idx.entries, &query, limit.unwrap_or(200)),
        None => Vec::new(),
    }
}

// Called on every accepted command so in-memory history stays hot without a
// re-read. Only ever fed prompt-mode commands, never raw running-mode input,
// so passwords typed into a running command never enter history.
#[tauri::command]
pub fn history_record(state: tauri::State<'_, HistoryState>, command: String) {
    let cmd = command.trim();
    if cmd.is_empty() {
        return;
    }
    let Some(mut guard) = ensure(&state) else {
        return;
    };
    if let Some(idx) = guard.as_mut() {
        let n = now();
        match idx.entries.iter_mut().find(|e| e.cmd == cmd) {
            Some(e) => {
                e.count += 1;
                e.last = n;
            }
            None => idx.entries.push(HistEntry {
                cmd: cmd.to_string(),
                count: 1,
                last: n,
            }),
        }
        sort_recent(&mut idx.entries);
    }
}
