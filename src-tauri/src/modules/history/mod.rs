mod index;
mod parse;

use index::HistoryIndex;
use parse::{demetafy, parse_bash, parse_fish, parse_zsh};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct Inner {
    index: Mutex<Option<HistoryIndex>>,
    /// Flips once the (slow) first build has finished; later calls are cheap
    /// enough to answer without leaving the async worker.
    ready: AtomicBool,
    /// PATH executables, scanned only when command-name completion asks.
    path_cmds: OnceLock<Vec<String>>,
}

#[derive(Default, Clone)]
pub struct HistoryState(Arc<Inner>);

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

impl HistoryState {
    fn with_index<T>(&self, f: impl FnOnce(&mut HistoryIndex) -> T) -> T {
        let mut guard = self.0.index.lock().unwrap_or_else(|e| e.into_inner());
        let index = guard.get_or_insert_with(|| HistoryIndex::build(read_histories()));
        self.0.ready.store(true, Ordering::Release);
        f(index)
    }

    fn path_commands(&self) -> &[String] {
        self.0.path_cmds.get_or_init(scan_path)
    }

    /// Whether a query can be answered without a slow first-time build.
    fn is_warm(&self, needs_path: bool) -> bool {
        self.0.ready.load(Ordering::Acquire) && (!needs_path || self.0.path_cmds.get().is_some())
    }
}

/// The first call parses every history file; once warm, queries are
/// microseconds and run inline instead of paying for a pool hop per keystroke.
async fn run<T, F>(state: &HistoryState, needs_path: bool, work: F) -> Option<T>
where
    T: Send + 'static,
    F: FnOnce(&HistoryState) -> T + Send + 'static,
{
    if state.is_warm(needs_path) {
        return Some(work(state));
    }
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || work(&state))
        .await
        .ok()
}

#[tauri::command]
pub async fn history_suggest(
    state: tauri::State<'_, HistoryState>,
    line: String,
) -> Result<Option<String>, String> {
    Ok(run(state.inner(), false, move |s| {
        s.with_index(|i| i.suggest(&line))
    })
    .await
    .flatten())
}

#[tauri::command]
pub async fn history_commands(
    state: tauri::State<'_, HistoryState>,
    prefix: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    Ok(run(state.inner(), true, move |s| {
        // Warm the index first so the PATH scan is the only cold cost left.
        s.with_index(|_| ());
        let path = s.path_commands();
        s.with_index(|i| i.complete_commands(path, &prefix, limit.unwrap_or(50)))
    })
    .await
    .unwrap_or_default())
}

#[tauri::command]
pub async fn history_list(
    state: tauri::State<'_, HistoryState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    Ok(run(state.inner(), false, move |s| {
        s.with_index(|i| i.list(&query, limit.unwrap_or(200)))
    })
    .await
    .unwrap_or_default())
}

// Called on every accepted command so in-memory history stays hot without a
// re-read. Only ever fed prompt-mode commands, never raw running-mode input,
// so passwords typed into a running command never enter history.
#[tauri::command]
pub async fn history_record(
    state: tauri::State<'_, HistoryState>,
    command: String,
) -> Result<(), String> {
    run(state.inner(), false, move |s| {
        s.with_index(|i| i.record(&command, now()))
    })
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cold_builds_leave_the_async_worker() {
        let state = HistoryState::default();
        assert!(!state.is_warm(false), "nothing parsed yet");
        state.0.ready.store(true, Ordering::Release);
        assert!(state.is_warm(false));
        assert!(
            !state.is_warm(true),
            "command-name completion also needs the PATH scan"
        );
        state.0.path_cmds.set(Vec::new()).unwrap();
        assert!(state.is_warm(true));
    }
}

#[cfg(test)]
mod mod_tests {
    use super::*;

    #[test]
    fn zsh_histfile_prefers_an_existing_env_override() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path().join("custom_zhistory");
        std::fs::write(&custom, b"").unwrap();
        std::env::set_var("HISTFILE", &custom);

        let got = zsh_histfile(Some(&tmp.path().join("home")));

        std::env::remove_var("HISTFILE");
        assert_eq!(got, Some(custom));
    }

    #[test]
    fn zsh_histfile_falls_back_to_home_when_the_override_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("HISTFILE", tmp.path().join("missing"));

        let got = zsh_histfile(Some(&home));

        std::env::remove_var("HISTFILE");
        assert_eq!(got, Some(home.join(".zsh_history")));
    }

    #[test]
    fn fish_histfile_prefers_xdg_then_falls_back_to_default_location() {
        let tmp = tempfile::tempdir().unwrap();
        let xdg = tmp.path().join("xdg-data");
        std::fs::create_dir_all(xdg.join("fish")).unwrap();
        let fish_file = xdg.join("fish").join("fish_history");
        std::fs::write(&fish_file, b"").unwrap();
        let home = tmp.path().join("home");

        std::env::set_var("XDG_DATA_HOME", &xdg);
        assert_eq!(fish_histfile(Some(&home)), Some(fish_file));

        std::env::set_var("XDG_DATA_HOME", tmp.path().join("empty-xdg"));
        assert_eq!(
            fish_histfile(Some(&home)),
            Some(home.join(".local/share/fish/fish_history"))
        );

        std::env::remove_var("XDG_DATA_HOME");
        assert_eq!(
            fish_histfile(Some(&home)),
            Some(home.join(".local/share/fish/fish_history"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_executable_detection_matches_launcher_extensions_only() {
        let tmp = tempfile::tempdir().unwrap();
        for name in [
            "cargo.exe",
            "RUN.CMD",
            "tool.bat",
            "legacy.com",
            "script.ps1",
            "readme.txt",
            "noext",
        ] {
            std::fs::write(tmp.path().join(name), b"").unwrap();
        }

        let mut found: Vec<(String, bool)> = Vec::new();
        for entry in std::fs::read_dir(tmp.path()).unwrap().flatten() {
            found.push((entry.file_name().to_string_lossy().into_owned(), is_executable(&entry)));
        }
        found.sort();

        let is_exec = |name: &str| {
            found
                .iter()
                .find(|(n, _)| n.eq_ignore_ascii_case(name))
                .map(|(_, e)| *e)
                .unwrap()
        };
        assert!(is_exec("cargo.exe"));
        assert!(is_exec("run.cmd"));
        assert!(is_exec("tool.bat"));
        assert!(is_exec("legacy.com"));
        assert!(is_exec("script.ps1"));
        assert!(!is_exec("readme.txt"));
        assert!(!is_exec("noext"));
    }
}
