//! Secret storage with platform-appropriate backends.
//!
//! - macOS: macOS Keychain (via `keyring` crate)
//! - Windows: Credential Manager (via `keyring` crate)
//! - Linux: a file in the app's local data dir, mode 0600. The default
//!   `keyring` backend on Linux is the Secret Service over D-Bus, which
//!   silently fails on systems without gnome-keyring/kwallet (and on the
//!   "login" collection not being created). For an open-source desktop
//!   app shipped via AppImage/deb/rpm, we cannot assume a keyring daemon
//!   exists. The file backend is the same approach Brave/Chromium fall
//!   back to in that scenario; user-only file permissions provide the
//!   isolation the secret-service collection would have otherwise.
//!
//! The frontend talks to `secrets_get`, `secrets_set`, `secrets_delete`,
//! and `secrets_get_all` — no platform branching in JS.
//!
//! All commands take `&AppHandle` so we can resolve the data directory
//! once via Tauri's path API.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

#[cfg(any(target_os = "linux", test))]
use std::collections::HashMap;
#[cfg(any(target_os = "linux", test))]
use std::fs;
#[cfg(target_os = "linux")]
use std::path::PathBuf;

#[derive(Default)]
pub struct SecretsState {
    #[cfg(any(target_os = "linux", test))]
    cache: Mutex<Option<HashMap<String, String>>>,
    #[cfg(not(target_os = "linux"))]
    _phantom: Mutex<()>,
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn key(service: &str, account: &str) -> String {
    format!("{}::{}", service, account)
}

#[cfg(target_os = "linux")]
fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.json"))
}

#[cfg(target_os = "linux")]
fn read_store(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    read_store_at(&store_path(app)?)
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn read_store_at(path: &std::path::Path) -> Result<HashMap<String, String>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice::<HashMap<String, String>>(&bytes).map_err(|e| e.to_string())
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn write_store_at(
    path: &std::path::Path,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("secret store has no parent")?;
    let bytes = serde_json::to_vec(map).map_err(|e| e.to_string())?;
    // NamedTempFile uses exclusive creation and mode 0600 on Unix.
    let mut file = tempfile::Builder::new()
        .prefix("secrets.json.tmp-")
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn update_store_at(
    path: &std::path::Path,
    state: &SecretsState,
    update: impl FnOnce(&mut HashMap<String, String>),
) -> Result<(), String> {
    let mut guard = state.cache.lock().map_err(|e| e.to_string())?;
    let mut next = match guard.as_ref() {
        Some(map) => map.clone(),
        None => read_store_at(path)?,
    };
    update(&mut next);
    write_store_at(path, &next)?;
    *guard = Some(next);
    Ok(())
}

#[cfg(target_os = "linux")]
fn with_store<F, R>(app: &AppHandle, state: &SecretsState, f: F) -> Result<R, String>
where
    F: FnOnce(&mut HashMap<String, String>) -> R,
{
    let mut guard = state.cache.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(read_store(app)?);
    }
    let map = guard.as_mut().expect("cache initialized above");
    Ok(f(map))
}

#[cfg(not(target_os = "linux"))]
fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| e.to_string())
}

// The keychain and the Linux file store both block (a locked keychain can wait
// on the user), so every command runs on the blocking pool.
fn blocking_secret<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppHandle, &SecretsState) -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
    crate::modules::fs::blocking(move || {
        let state = app.state::<SecretsState>();
        work(&app, &state)
    })
}

#[tauri::command]
pub async fn secrets_get(
    app: AppHandle,
    service: String,
    account: String,
) -> Result<Option<String>, String> {
    blocking_secret(app, move |app, state| {
        get_secret(app, state, &service, &account)
    })
    .await
}

fn get_secret(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    account: &str,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        let key = key(service, account);
        with_store(app, state, |m| m.get(&key).cloned())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state);
        let e = entry(service, account)?;
        match e.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }
}

#[tauri::command]
pub async fn secrets_set(
    app: AppHandle,
    service: String,
    account: String,
    password: String,
) -> Result<(), String> {
    blocking_secret(app, move |app, state| {
        set_secret(app, state, &service, &account, password)
    })
    .await
}

fn set_secret(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    account: &str,
    password: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let key = key(service, account);
        update_store_at(&store_path(app)?, state, |m| {
            m.insert(key, password);
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state);
        let e = entry(service, account)?;
        e.set_password(&password).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn secrets_delete(
    app: AppHandle,
    service: String,
    account: String,
) -> Result<(), String> {
    blocking_secret(app, move |app, state| {
        delete_secret(app, state, &service, &account)
    })
    .await
}

fn delete_secret(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    account: &str,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let key = key(service, account);
        update_store_at(&store_path(app)?, state, |m| {
            m.remove(&key);
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state);
        let e = entry(service, account)?;
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    use tempfile::TempDir;

    #[cfg(unix)]
    #[test]
    fn a_preexisting_temporary_symlink_cannot_overwrite_another_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let marker = tmp.path().join("marker.txt");
        fs::write(&marker, b"unchanged").unwrap();
        std::os::unix::fs::symlink(&marker, path.with_extension("json.tmp")).unwrap();
        write_store_at(&path, &HashMap::from([("key".into(), "synthetic".into())])).unwrap();
        assert_eq!(fs::read(&marker).unwrap(), b"unchanged");
        assert_eq!(
            read_store_at(&path).unwrap().get("key").unwrap(),
            "synthetic"
        );
    }

    #[test]
    fn failed_persistence_keeps_the_previous_cache_and_disk() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let state = SecretsState::default();
        update_store_at(&path, &state, |map| {
            map.insert("keep".into(), "old".into());
        })
        .unwrap();
        let before = read_store_at(&path).unwrap();
        let impossible = tmp.path().join("missing").join("secrets.json");
        assert!(update_store_at(&impossible, &state, |map| {
            map.remove("keep");
        })
        .is_err());
        assert_eq!(state.cache.lock().unwrap().as_ref(), Some(&before));
        assert_eq!(read_store_at(&path).unwrap(), before);
    }

    #[test]
    fn concurrent_set_and_delete_are_serialized_through_persistence() {
        use std::sync::{mpsc, Arc};
        let tmp = TempDir::new().unwrap();
        let path = Arc::new(tmp.path().join("secrets.json"));
        let state = Arc::new(SecretsState::default());
        update_store_at(&path, &state, |map| {
            map.insert("delete".into(), "old".into());
            map.insert("keep".into(), "unrelated".into());
        })
        .unwrap();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let setter = {
            let (path, state) = (path.clone(), state.clone());
            std::thread::spawn(move || {
                update_store_at(&path, &state, |map| {
                    map.insert("new".into(), "saved".into());
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                })
                .unwrap()
            })
        };
        entered_rx.recv().unwrap();
        assert!(
            state.cache.try_lock().is_err(),
            "transaction must retain the lock"
        );
        let (started_tx, started_rx) = mpsc::channel();
        let deleter = {
            let (path, state) = (path.clone(), state.clone());
            std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                update_store_at(&path, &state, |map| {
                    map.remove("delete");
                })
                .unwrap();
            })
        };
        started_rx.recv().unwrap();
        release_tx.send(()).unwrap();
        setter.join().unwrap();
        deleter.join().unwrap();
        let disk = read_store_at(&path).unwrap();
        assert!(!disk.contains_key("delete"));
        assert_eq!(disk.get("keep").unwrap(), "unrelated");
        assert_eq!(disk.get("new").unwrap(), "saved");
        assert_eq!(state.cache.lock().unwrap().as_ref(), Some(&disk));
    }

    #[test]
    fn key_format_is_service_double_colon_account() {
        assert_eq!(key("openai", "alice"), "openai::alice");
        assert_eq!(key("", ""), "::");
    }

    #[test]
    fn read_store_at_missing_path_is_empty() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("nope.json");
        let map = read_store_at(&p).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn write_then_read_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        let mut m = HashMap::new();
        m.insert(key("svc", "alice"), "p1".into());
        m.insert(key("svc", "bob"), "p2".into());

        write_store_at(&p, &m).unwrap();
        let loaded = read_store_at(&p).unwrap();
        assert_eq!(loaded, m);
    }

    #[cfg(unix)]
    #[test]
    fn write_uses_mode_0600() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        write_store_at(&p, &HashMap::new()).unwrap();

        let mode = fs::metadata(&p).unwrap().mode() & 0o777;
        assert_eq!(mode, 0o600, "secrets file must be user-only readable");
    }

    #[test]
    fn write_does_not_leave_tmp_file_on_success() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        write_store_at(&p, &HashMap::new()).unwrap();

        let tmp_path = p.with_extension("json.tmp");
        assert!(
            !tmp_path.exists(),
            "tmp file must be renamed away on success"
        );
    }

    #[test]
    fn write_overwrites_existing_atomically() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");

        let mut first = HashMap::new();
        first.insert("a".into(), "1".into());
        write_store_at(&p, &first).unwrap();

        let mut second = HashMap::new();
        second.insert("b".into(), "2".into());
        write_store_at(&p, &second).unwrap();

        let loaded = read_store_at(&p).unwrap();
        assert_eq!(loaded, second);
        assert!(!loaded.contains_key("a"));
    }

    #[test]
    fn read_store_at_garbage_file_errors() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        fs::write(&p, b"not json").unwrap();
        assert!(read_store_at(&p).is_err());
    }
}

/// Batch read — single IPC roundtrip for the cold-boot fan-out.
#[tauri::command]
pub async fn secrets_get_all(
    app: AppHandle,
    service: String,
    accounts: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    blocking_secret(app, move |app, state| {
        get_all_secrets(app, state, &service, accounts)
    })
    .await
}

fn get_all_secrets(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    accounts: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    #[cfg(target_os = "linux")]
    {
        with_store(app, state, |m| {
            accounts
                .iter()
                .map(|a| m.get(&key(service, a)).cloned())
                .collect()
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state);
        Ok(accounts
            .into_iter()
            .map(|a| {
                keyring::Entry::new(service, &a)
                    .ok()
                    .and_then(|e| e.get_password().ok())
            })
            .collect())
    }
}
