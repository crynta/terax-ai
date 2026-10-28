//! Conversation message files, one atomically replaced file per session.
//!
//! Messages cross the IPC boundary as raw UTF-8 JSON bytes and are written
//! verbatim: nothing here builds a JSON document tree, so a save costs one
//! streaming validation pass plus the write. Every save flushes the new file's
//! data to the drive before the rename that publishes it (a plain `fsync`, the
//! cheap flush), so a power cut can leave the old file or the new one but never
//! an empty or truncated replacement. The turn-end, switch, migration and close
//! saves ask for `durable`, which upgrades that to a full flush (`F_FULLFSYNC`
//! on Apple) and also syncs the directory so the rename itself survives.
//!
//! Each replace keeps the version it replaces as `session-<id>.json.bak`. A
//! load that finds the main file missing or unreadable falls back to it before
//! giving a conversation up, so one bad write costs at most the last few
//! seconds of a stream instead of the whole conversation.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::ipc::{Request, Response};
use tauri::{Manager, State};

use super::ipc_body;

/// A conversation larger than this is refused rather than held in memory.
const MAX_CONVERSATION_BYTES: usize = 128 * 1024 * 1024;
const MAX_OPTIONS_BYTES: usize = 1024;
const LEGACY_BACKUP: &str = "terax-ai-sessions.before-message-files.json";
const LEGACY_STORE: &str = "terax-ai-sessions.json";
const LEGACY_KEY_PREFIX: &str = "messages:";

#[derive(Default)]
pub struct SessionFilesState {
    gate: Arc<tokio::sync::Mutex<()>>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn message_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid conversation id".into());
    }
    Ok(root
        .join("conversations")
        .join(format!("session-{id}.json")))
}

fn quarantine_path(path: &Path) -> PathBuf {
    sibling(path, ".corrupt")
}

/// The previous version of a message file.
fn backup_path(path: &Path) -> PathBuf {
    sibling(path, ".bak")
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Cheap structural check without building a document: the bytes must be one
/// complete, valid JSON array. `IgnoredAny` streams over the value and skips
/// allocating it, and `from_slice` also rejects invalid UTF-8 and trailing
/// data.
fn validate_conversation(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_CONVERSATION_BYTES {
        return Err(format!(
            "conversation exceeds {} MiB",
            MAX_CONVERSATION_BYTES / (1024 * 1024)
        ));
    }
    let first = bytes.iter().find(|b| !b.is_ascii_whitespace());
    let last = bytes.iter().rev().find(|b| !b.is_ascii_whitespace());
    if first != Some(&b'[') || last != Some(&b']') {
        return Err("conversation messages must be an array".into());
    }
    serde_json::from_slice::<serde::de::IgnoredAny>(bytes)
        .map(|_| ())
        .map_err(|e| format!("conversation is not valid JSON: {e}"))
}

enum Stored {
    Missing,
    Valid(Vec<u8>),
    Invalid(String),
}

fn read_stored(path: &Path) -> Result<Stored, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Stored::Missing),
        Err(error) => return Err(error.to_string()),
    };
    if bytes.len() > MAX_CONVERSATION_BYTES {
        return Err("conversation is too large to open".into());
    }
    Ok(match validate_conversation(&bytes) {
        Ok(()) => Stored::Valid(bytes),
        Err(reason) => Stored::Invalid(reason),
    })
}

/// Reads one conversation. A missing file is `None`. A file that does not
/// validate is moved aside (kept for recovery) and the previous version
/// (`.bak`) is tried before the conversation is given up; only when that is
/// unusable too is it reported as `corrupt:`, so a later save starts a fresh
/// file instead of failing forever, and one bad file never affects another
/// session. A conversation recovered from the previous version is written back
/// as the main file.
fn read_messages(root: &Path, id: &str) -> Result<Option<Vec<u8>>, String> {
    let path = message_path(root, id)?;
    let mut damage = None;
    match read_stored(&path)? {
        Stored::Valid(bytes) => return Ok(Some(bytes)),
        Stored::Missing => {}
        Stored::Invalid(reason) => {
            let moved = fs::rename(&path, quarantine_path(&path));
            log::warn!("conversation {id} is unreadable ({reason}); quarantined: {moved:?}");
            damage = Some(reason);
        }
    }
    let backup = backup_path(&path);
    match read_stored(&backup)? {
        Stored::Valid(bytes) => {
            log::warn!("conversation {id} restored from its previous version");
            let restored = atomic_write(
                &path,
                &bytes,
                Commit {
                    replace: false,
                    durable: true,
                    keep_previous: false,
                },
            );
            if let Err(error) = restored {
                log::warn!("conversation {id} could not be rewritten from its backup: {error}");
            }
            Ok(Some(bytes))
        }
        Stored::Missing => damage.map_or(Ok(None), |reason| Err(format!("corrupt: {reason}"))),
        Stored::Invalid(reason) => {
            let moved = fs::rename(&backup, quarantine_path(&backup));
            log::warn!("conversation {id} backup is unreadable ({reason}); quarantined: {moved:?}");
            Err(format!("corrupt: {}", damage.unwrap_or(reason)))
        }
    }
}

fn message_file_is_valid(root: &Path, id: &str) -> bool {
    message_path(root, id)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .is_some_and(|bytes| validate_conversation(&bytes).is_ok())
}

#[derive(Clone, Copy)]
struct Commit {
    /// Replace an existing file. Migration passes false so it never clobbers
    /// a newer file written after a failed run.
    replace: bool,
    /// Full flush (`F_FULLFSYNC` on Apple) and a directory sync.
    durable: bool,
    /// Keep the file being replaced as `.bak`.
    keep_previous: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Flush {
    /// The file's data is on the drive before it is renamed into place.
    Routine,
    /// Also forces the drive's own write cache.
    Full,
}

fn flush_file(file: &fs::File, flush: Flush) -> std::io::Result<()> {
    match flush {
        Flush::Full => file.sync_all(),
        Flush::Routine => routine_sync(file),
    }
}

/// `fsync(2)` itself. Rust's `sync_data` and `sync_all` both issue
/// `F_FULLFSYNC` on Apple, which waits for the drive's cache and costs far more
/// than a save every few seconds should.
#[cfg(unix)]
fn routine_sync(file: &fs::File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    loop {
        // SAFETY: the descriptor is open for the duration of the call.
        if unsafe { libc::fsync(file.as_raw_fd()) } == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

#[cfg(not(unix))]
fn routine_sync(file: &fs::File) -> std::io::Result<()> {
    file.sync_data()
}

fn atomic_write(path: &Path, bytes: &[u8], commit: Commit) -> Result<(), String> {
    let parent = path.parent().ok_or("missing conversation directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    commit_file(temporary, path, commit)
}

fn commit_file(
    temporary: tempfile::NamedTempFile,
    path: &Path,
    commit: Commit,
) -> Result<(), String> {
    commit_with(temporary, path, commit, flush_file)
}

fn commit_with(
    temporary: tempfile::NamedTempFile,
    path: &Path,
    commit: Commit,
    flush: impl Fn(&fs::File, Flush) -> std::io::Result<()>,
) -> Result<(), String> {
    let level = if commit.durable {
        Flush::Full
    } else {
        Flush::Routine
    };
    flush(temporary.as_file(), level).map_err(|e| e.to_string())?;
    if commit.replace {
        if commit.keep_previous {
            keep_previous(path);
        }
        temporary.persist(path).map_err(|e| e.error.to_string())?;
    } else if let Err(error) = temporary.persist_noclobber(path) {
        if error.error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(error.error.to_string());
        }
    }
    #[cfg(unix)]
    if commit.durable {
        fs::File::open(path.parent().ok_or("missing conversation directory")?)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Moves the current main file to `.bak`, replacing the older backup. It is a
/// rename, not a copy, so it costs no data. A file that is not plausibly a
/// complete array (empty, torn) is left alone: it must not push a good backup
/// out. Failing to keep the previous version never fails the save.
fn keep_previous(path: &Path) {
    if !looks_complete(path) {
        return;
    }
    if let Err(error) = fs::rename(path, backup_path(path)) {
        log::warn!("could not keep the previous version of {path:?}: {error}");
    }
}

/// First and last bytes only: a torn or zero-filled file fails this without
/// reading a multi-megabyte conversation.
fn looks_complete(path: &Path) -> bool {
    const EDGE: u64 = 64;
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let Ok(length) = file.metadata().map(|m| m.len()) else {
        return false;
    };
    let mut head: Vec<u8> = Vec::new();
    let mut tail: Vec<u8> = Vec::new();
    let read = (&mut file)
        .take(EDGE)
        .read_to_end(&mut head)
        .and_then(|_| file.seek(SeekFrom::Start(length.saturating_sub(EDGE))))
        .and_then(|_| (&mut file).take(EDGE).read_to_end(&mut tail));
    let first = head.iter().find(|b| !b.is_ascii_whitespace());
    let last = tail.iter().rev().find(|b| !b.is_ascii_whitespace());
    read.is_ok() && first == Some(&b'[') && last == Some(&b']')
}

/// Keeps the pre-migration store next to the new files until the migration is
/// verified, so an interrupted run can still be recovered by hand.
fn ensure_backup(root: &Path) -> Result<(), String> {
    let backup = root.join(LEGACY_BACKUP);
    if backup.exists() {
        return Ok(());
    }
    let mut legacy = fs::File::open(root.join(LEGACY_STORE)).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    std::io::copy(&mut legacy, temporary.as_file_mut()).map_err(|e| e.to_string())?;
    commit_file(
        temporary,
        &backup,
        Commit {
            replace: false,
            durable: true,
            keep_previous: false,
        },
    )
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SaveOptions {
    id: String,
    migrate: bool,
    durable: bool,
}

fn write_messages(
    root: &Path,
    id: &str,
    bytes: &[u8],
    migrate: bool,
    durable: bool,
) -> Result<(), String> {
    validate_conversation(bytes)?;
    let path = message_path(root, id)?;
    if migrate {
        ensure_backup(root)?;
        // A readable file already there is newer than the legacy record.
        if read_messages(root, id)?.is_some() {
            return Ok(());
        }
    }
    atomic_write(
        &path,
        bytes,
        Commit {
            replace: !migrate,
            durable: durable || migrate,
            keep_previous: !migrate,
        },
    )
}

/// Drops a session from the pre-migration copy, if it still exists, so deleting
/// a conversation does not leave its text behind in the backup.
fn scrub_backup(root: &Path, id: &str) -> Result<(), String> {
    let backup = root.join(LEGACY_BACKUP);
    let bytes = match fs::read(&backup) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let Ok(mut entries) = serde_json::from_slice::<Map<String, Value>>(&bytes) else {
        // An unreadable backup cannot be edited; it must not outlive the data.
        return fs::remove_file(&backup).map_err(|e| e.to_string());
    };
    if entries
        .remove(&format!("{LEGACY_KEY_PREFIX}{id}"))
        .is_none()
    {
        return Ok(());
    }
    if entries
        .keys()
        .all(|key| !key.starts_with(LEGACY_KEY_PREFIX))
    {
        return fs::remove_file(&backup).map_err(|e| e.to_string());
    }
    let rewritten = serde_json::to_vec(&entries).map_err(|e| e.to_string())?;
    atomic_write(
        &backup,
        &rewritten,
        Commit {
            replace: true,
            durable: false,
            keep_previous: false,
        },
    )
}

fn delete_messages(root: &Path, id: &str) -> Result<(), String> {
    let path = message_path(root, id)?;
    let backup = backup_path(&path);
    for target in [
        quarantine_path(&path),
        quarantine_path(&backup),
        backup,
        path,
    ] {
        match fs::remove_file(target) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    scrub_backup(root, id)
}

/// What a JSON value is, without building it: only the legacy store's
/// `messages:*` entries that are arrays ever became message files.
struct IsArray(bool);

impl<'de> Deserialize<'de> for IsArray {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::{IgnoredAny, MapAccess, SeqAccess, Visitor};
        struct Probe;
        impl<'de> Visitor<'de> for Probe {
            type Value = IsArray;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("any JSON value")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<IsArray, A::Error> {
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(IsArray(true))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<IsArray, A::Error> {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(IsArray(false))
            }
            fn visit_bool<E>(self, _: bool) -> Result<IsArray, E> {
                Ok(IsArray(false))
            }
            fn visit_i64<E>(self, _: i64) -> Result<IsArray, E> {
                Ok(IsArray(false))
            }
            fn visit_u64<E>(self, _: u64) -> Result<IsArray, E> {
                Ok(IsArray(false))
            }
            fn visit_f64<E>(self, _: f64) -> Result<IsArray, E> {
                Ok(IsArray(false))
            }
            fn visit_str<E>(self, _: &str) -> Result<IsArray, E> {
                Ok(IsArray(false))
            }
            fn visit_unit<E>(self) -> Result<IsArray, E> {
                Ok(IsArray(false))
            }
        }
        deserializer.deserialize_any(Probe)
    }
}

/// The conversations the pre-migration copy holds that migration turns into
/// files: valid ids whose stored value is an array. `None` when the copy
/// exists but cannot be read, so nothing can be verified against it.
fn legacy_conversation_ids(root: &Path) -> Result<Option<Vec<String>>, String> {
    let bytes = match fs::read(root.join(LEGACY_BACKUP)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Some(Vec::new())),
        Err(error) => return Err(error.to_string()),
    };
    let Ok(entries) = serde_json::from_slice::<std::collections::HashMap<String, IsArray>>(&bytes)
    else {
        return Ok(None);
    };
    Ok(Some(
        entries
            .into_iter()
            .filter(|(_, value)| value.0)
            .filter_map(|(key, _)| key.strip_prefix(LEGACY_KEY_PREFIX).map(str::to_string))
            .filter(|id| valid_id(id))
            .collect(),
    ))
}

/// Deletes the pre-migration copy once every conversation in it, and every id
/// the caller reports, reads back valid. The copy itself says what must have
/// migrated: a short or wrong list from the caller can add requirements but
/// never remove one. Returns whether it is gone; any doubt keeps it.
fn finish_migration(root: &Path, ids: &[String]) -> Result<bool, String> {
    if ids.is_empty() {
        return Err("no migrated conversations to verify".into());
    }
    let Some(mut required) = legacy_conversation_ids(root)? else {
        return Ok(false);
    };
    required.extend(ids.iter().cloned());
    if !required.iter().all(|id| message_file_is_valid(root, id)) {
        return Ok(false);
    }
    remove_backup(root)
}

fn remove_backup(root: &Path) -> Result<bool, String> {
    match fs::remove_file(root.join(LEGACY_BACKUP)) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error.to_string()),
    }
}

/// Backups left by an earlier build, where nothing is waiting to migrate, are
/// removed once they are old enough.
fn prune_backup(root: &Path, max_age: Duration, now: SystemTime) -> Result<bool, String> {
    let modified = match fs::metadata(root.join(LEGACY_BACKUP)).and_then(|m| m.modified()) {
        Ok(modified) => modified,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    if now.duration_since(modified).unwrap_or_default() < max_age {
        return Ok(false);
    }
    remove_backup(root)
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_session_load(
    app: tauri::AppHandle,
    state: State<'_, SessionFilesState>,
    id: String,
) -> Result<Response, String> {
    let root = data_dir(&app)?;
    let guard = state.gate.clone().lock_owned().await;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        read_messages(&root, &id)
    })
    .await
    .map_err(|e| e.to_string())??;
    // An empty body means "no such conversation".
    Ok(Response::new(bytes.unwrap_or_default()))
}

/// Body: the conversation as raw JSON bytes. Header `x-terax-session`:
/// `{ "id", "migrate"?, "durable"? }`.
#[tauri::command]
pub async fn ai_session_save(
    app: tauri::AppHandle,
    state: State<'_, SessionFilesState>,
    request: Request<'_>,
) -> Result<(), String> {
    let options: SaveOptions = request
        .headers()
        .get("x-terax-session")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= MAX_OPTIONS_BYTES)
        .ok_or("missing or oversized conversation options")
        .and_then(|value| {
            serde_json::from_str(value).map_err(|_| "invalid conversation options")
        })?;
    // The task outlives the borrowed IPC buffer; conversations are small
    // relative to the cost of keeping the borrow across a blocking write.
    let bytes = ipc_body::bytes_of(
        request.body(),
        MAX_CONVERSATION_BYTES,
        ipc_body::JSON_FALLBACK_MAX_BYTES,
    )?
    .into_owned();
    let root = data_dir(&app)?;
    let guard = state.gate.clone().lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        write_messages(&root, &options.id, &bytes, options.migrate, options.durable)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ai_session_delete(
    app: tauri::AppHandle,
    state: State<'_, SessionFilesState>,
    id: String,
) -> Result<(), String> {
    let root = data_dir(&app)?;
    let guard = state.gate.clone().lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        delete_messages(&root, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Verifies the migrated conversations and removes the pre-migration copy.
#[tauri::command]
pub async fn ai_session_finish_migration(
    app: tauri::AppHandle,
    state: State<'_, SessionFilesState>,
    ids: Vec<String>,
) -> Result<bool, String> {
    let root = data_dir(&app)?;
    let guard = state.gate.clone().lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        finish_migration(&root, &ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ai_session_prune_backup(
    app: tauri::AppHandle,
    state: State<'_, SessionFilesState>,
    max_age_secs: u64,
) -> Result<bool, String> {
    let root = data_dir(&app)?;
    let guard = state.gate.clone().lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        prune_backup(&root, Duration::from_secs(max_age_secs), SystemTime::now())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(text: &str) -> Vec<u8> {
        text.as_bytes().to_vec()
    }

    fn save(root: &Path, id: &str, text: &str) -> Result<(), String> {
        write_messages(root, id, text.as_bytes(), false, false)
    }

    fn read(root: &Path, id: &str) -> Option<String> {
        read_messages(root, id)
            .unwrap()
            .map(|bytes| String::from_utf8(bytes).unwrap())
    }

    #[test]
    fn messages_are_independent_atomic_files_and_missing_sessions_are_empty() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(read(root.path(), "one"), None);
        save(root.path(), "one", r#"[{"text":"old"}]"#).unwrap();
        save(root.path(), "two", r#"[{"text":"other"}]"#).unwrap();
        save(root.path(), "one", r#"[{"text":"new"}]"#).unwrap();
        assert_eq!(
            read(root.path(), "one").as_deref(),
            Some(r#"[{"text":"new"}]"#)
        );
        assert_eq!(
            read(root.path(), "two").as_deref(),
            Some(r#"[{"text":"other"}]"#)
        );
        let mut names: Vec<_> = fs::read_dir(root.path().join("conversations"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "session-one.json",
                "session-one.json.bak",
                "session-two.json"
            ],
            "only the files and one previous version; no temporary files"
        );
    }

    #[test]
    fn bytes_are_written_verbatim_without_reserialization() {
        let root = tempfile::tempdir().unwrap();
        let exact = "[ {\"b\": 1,\n \"a\" : \"\\u00e9\"} ]\n";
        save(root.path(), "one", exact).unwrap();
        assert_eq!(read(root.path(), "one").as_deref(), Some(exact));
    }

    #[test]
    fn validation_rejects_anything_but_one_complete_json_array() {
        for good in ["[]", " [1, 2] \n", r#"[{"a":[{}]}]"#] {
            assert!(validate_conversation(good.as_bytes()).is_ok(), "{good}");
        }
        for bad in [
            "",
            "{}",
            "null",
            "[",
            "[1,]",
            "[] []",
            "[1] x",
            "\"[]\"",
            "[\"\u{0}\"]",
        ] {
            assert!(validate_conversation(bad.as_bytes()).is_err(), "{bad:?}");
        }
        assert!(
            validate_conversation(&[b'[', 0xff, b']']).is_err(),
            "invalid UTF-8"
        );
        // Skipping values is iterative, so pathological nesting cannot overflow
        // the small blocking-pool stack.
        let nested = format!("{}{}", "[".repeat(200_000), "]".repeat(200_000));
        assert!(validate_conversation(nested.as_bytes()).is_ok());
        assert!(validate_conversation(&nested.as_bytes()[1..]).is_err());
        let oversized = vec![b' '; MAX_CONVERSATION_BYTES + 1];
        assert!(validate_conversation(&oversized)
            .unwrap_err()
            .contains("exceeds"));
    }

    #[test]
    fn invalid_ids_and_non_arrays_never_reach_the_disk() {
        let root = tempfile::tempdir().unwrap();
        for id in ["", "../escape", "a/b", "a\\b", ".", &"x".repeat(129)] {
            assert!(message_path(root.path(), id).is_err(), "{id:?}");
            assert!(save(root.path(), id, "[]").is_err(), "{id:?}");
        }
        assert_eq!(
            message_path(root.path(), "CON")
                .unwrap()
                .file_name()
                .unwrap(),
            "session-CON.json"
        );
        assert!(save(root.path(), "one", "{}").is_err());
        assert!(!root.path().join("conversations").exists());
    }

    #[test]
    fn a_corrupt_file_is_quarantined_so_other_sessions_and_later_saves_still_work() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "good", "[1]").unwrap();
        save(root.path(), "bad", "[2]").unwrap();
        let bad = message_path(root.path(), "bad").unwrap();
        fs::write(&bad, b"{ not json").unwrap();

        let error = read_messages(root.path(), "bad").unwrap_err();
        assert!(error.starts_with("corrupt:"), "{error}");
        assert_eq!(fs::read(quarantine_path(&bad)).unwrap(), b"{ not json");
        assert!(!bad.exists());

        assert_eq!(read(root.path(), "good").as_deref(), Some("[1]"));
        assert_eq!(
            read(root.path(), "bad"),
            None,
            "the damaged session reads as empty now"
        );
        save(root.path(), "bad", "[3]").unwrap();
        assert_eq!(read(root.path(), "bad").as_deref(), Some("[3]"));
        assert!(
            quarantine_path(&bad).exists(),
            "the damaged copy is kept for recovery"
        );
    }

    #[test]
    fn deleting_a_session_also_removes_its_quarantined_copy() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        let path = message_path(root.path(), "one").unwrap();
        fs::write(&path, b"broken").unwrap();
        let _ = read_messages(root.path(), "one");
        assert!(quarantine_path(&path).exists());
        delete_messages(root.path(), "one").unwrap();
        assert!(!quarantine_path(&path).exists());
        delete_messages(root.path(), "one").expect("deleting nothing is fine");
    }

    #[test]
    fn migration_preserves_a_backup_and_never_overwrites_newer_messages() {
        let root = tempfile::tempdir().unwrap();
        let legacy = br#"{"messages:one":[{"text":"legacy"}]}"#;
        fs::write(root.path().join(LEGACY_STORE), legacy).unwrap();
        write_messages(
            root.path(),
            "one",
            &json(r#"[{"text":"legacy"}]"#),
            true,
            false,
        )
        .unwrap();
        save(root.path(), "one", r#"[{"text":"newer"}]"#).unwrap();
        write_messages(
            root.path(),
            "one",
            &json(r#"[{"text":"legacy"}]"#),
            true,
            false,
        )
        .unwrap();
        assert_eq!(
            read(root.path(), "one").as_deref(),
            Some(r#"[{"text":"newer"}]"#)
        );
        assert_eq!(fs::read(root.path().join(LEGACY_BACKUP)).unwrap(), legacy);
    }

    #[test]
    fn a_corrupt_target_fails_migration_without_discarding_legacy_data() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(LEGACY_STORE), b"{}").unwrap();
        fs::create_dir(root.path().join("conversations")).unwrap();
        let target = message_path(root.path(), "one").unwrap();
        fs::write(&target, b"invalid").unwrap();
        let result = write_messages(root.path(), "one", &json("[]"), true, false);
        assert!(result.unwrap_err().starts_with("corrupt:"));
        assert_eq!(fs::read(quarantine_path(&target)).unwrap(), b"invalid");
        assert!(root.path().join(LEGACY_BACKUP).exists());
    }

    fn legacy_with(root: &Path, text: &str) -> PathBuf {
        fs::write(root.join(LEGACY_STORE), text).unwrap();
        root.join(LEGACY_BACKUP)
    }

    #[test]
    fn the_backup_is_removed_only_after_every_migrated_session_reads_back() {
        let root = tempfile::tempdir().unwrap();
        let backup = legacy_with(
            root.path(),
            r#"{"messages:a":[1],"messages:b":[2],"sessions":[]}"#,
        );
        write_messages(root.path(), "a", &json("[1]"), true, false).unwrap();
        write_messages(root.path(), "b", &json("[2]"), true, false).unwrap();
        assert!(backup.exists());

        let ids = vec!["a".to_string(), "b".to_string(), "missing".to_string()];
        assert_eq!(finish_migration(root.path(), &ids), Ok(false));
        assert!(backup.exists(), "an unverifiable session keeps the backup");

        fs::write(message_path(root.path(), "b").unwrap(), b"torn").unwrap();
        assert_eq!(
            finish_migration(root.path(), &["a".into(), "b".into()]),
            Ok(false)
        );
        assert!(
            backup.exists(),
            "an unreadable migrated file keeps the backup"
        );

        save(root.path(), "b", "[2]").unwrap();
        assert_eq!(
            finish_migration(root.path(), &["a".into(), "b".into()]),
            Ok(true)
        );
        assert!(!backup.exists());
        assert_eq!(
            finish_migration(root.path(), &["a".into()]),
            Ok(true),
            "idempotent"
        );
    }

    #[test]
    fn the_backup_itself_decides_what_must_have_migrated_not_the_caller() {
        let root = tempfile::tempdir().unwrap();
        let backup = legacy_with(
            root.path(),
            r#"{"messages:a":[1],"messages:b":[2],"messages:c":[3]}"#,
        );
        write_messages(root.path(), "a", &json("[1]"), true, false).unwrap();
        assert!(backup.exists());

        // The caller names only the conversation that did migrate.
        assert_eq!(finish_migration(root.path(), &["a".into()]), Ok(false));
        assert!(backup.exists(), "b and c have no file yet");
        // An id the backup does not hold cannot stand in for one it does.
        assert_eq!(
            finish_migration(root.path(), &["a".into(), "x".into()]),
            Ok(false)
        );
        write_messages(root.path(), "b", &json("[2]"), true, false).unwrap();
        assert_eq!(
            finish_migration(root.path(), &["a".into(), "b".into()]),
            Ok(false)
        );
        assert!(backup.exists(), "c is still missing");

        write_messages(root.path(), "c", &json("[3]"), true, false).unwrap();
        assert_eq!(finish_migration(root.path(), &["a".into()]), Ok(true));
        assert!(!backup.exists());
    }

    #[test]
    fn an_empty_id_list_is_refused_and_removes_nothing() {
        let root = tempfile::tempdir().unwrap();
        let backup = legacy_with(root.path(), r#"{"messages:a":[1]}"#);
        write_messages(root.path(), "a", &json("[1]"), true, false).unwrap();
        let error = finish_migration(root.path(), &[]).unwrap_err();
        assert!(error.contains("no migrated"), "{error}");
        assert!(backup.exists());
    }

    #[test]
    fn entries_that_never_became_files_do_not_block_removing_the_backup() {
        let root = tempfile::tempdir().unwrap();
        let backup = legacy_with(
            root.path(),
            r#"{"messages:a":[1],"messages:bad id":[1],"messages:text":"x","messages:nothing":null,"messages:obj":{},"messages:":[],"other:a":[1],"sessions":[{"id":"a"}]}"#,
        );
        write_messages(root.path(), "a", &json("[1]"), true, false).unwrap();
        assert!(backup.exists());
        assert_eq!(finish_migration(root.path(), &["a".into()]), Ok(true));
        assert!(!backup.exists());
    }

    #[test]
    fn an_unreadable_backup_cannot_be_verified_so_it_is_kept() {
        let root = tempfile::tempdir().unwrap();
        let backup = root.path().join(LEGACY_BACKUP);
        write_messages(root.path(), "a", &json("[1]"), false, false).unwrap();
        for text in ["not json", "[]", "\"x\"", "{\"messages:a\": [1"] {
            fs::write(&backup, text).unwrap();
            assert_eq!(
                finish_migration(root.path(), &["a".into()]),
                Ok(false),
                "{text}"
            );
            assert!(backup.exists());
        }
    }

    #[test]
    fn an_old_leftover_backup_is_pruned_but_a_recent_one_is_kept() {
        let root = tempfile::tempdir().unwrap();
        let day = Duration::from_secs(24 * 60 * 60);
        assert_eq!(
            prune_backup(root.path(), 7 * day, SystemTime::now()),
            Ok(false)
        );
        fs::write(root.path().join(LEGACY_BACKUP), b"{}").unwrap();
        assert_eq!(
            prune_backup(root.path(), 7 * day, SystemTime::now()),
            Ok(false)
        );
        assert!(root.path().join(LEGACY_BACKUP).exists());
        let later = SystemTime::now() + 8 * day;
        assert_eq!(prune_backup(root.path(), 7 * day, later), Ok(true));
        assert!(!root.path().join(LEGACY_BACKUP).exists());
    }

    #[test]
    fn deleting_a_session_scrubs_its_text_from_the_backup() {
        let root = tempfile::tempdir().unwrap();
        let legacy = r#"{"sessions":[{"id":"a"}],"messages:a":[{"text":"secret"}],"messages:b":[{"text":"keep"}]}"#;
        fs::write(root.path().join(LEGACY_STORE), legacy).unwrap();
        write_messages(root.path(), "a", &json("[1]"), true, false).unwrap();
        write_messages(root.path(), "b", &json("[2]"), true, false).unwrap();

        delete_messages(root.path(), "a").unwrap();
        let backup = fs::read_to_string(root.path().join(LEGACY_BACKUP)).unwrap();
        assert!(!backup.contains("secret"));
        assert!(backup.contains("keep"));
        assert!(!message_path(root.path(), "a").unwrap().exists());

        delete_messages(root.path(), "b").unwrap();
        assert!(
            !root.path().join(LEGACY_BACKUP).exists(),
            "the backup goes once it holds no conversations"
        );
    }

    #[test]
    fn an_unparseable_backup_does_not_survive_a_session_delete() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(LEGACY_BACKUP), b"not json at all").unwrap();
        delete_messages(root.path(), "a").unwrap();
        assert!(!root.path().join(LEGACY_BACKUP).exists());
    }

    #[test]
    fn replacing_an_existing_session_leaves_no_partial_file_even_when_not_durable() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        let big = format!("[{}]", "0,".repeat(200_000) + "0");
        save(root.path(), "one", &big).unwrap();
        assert_eq!(read(root.path(), "one").unwrap().len(), big.len());
        write_messages(root.path(), "one", b"[2]", false, true).unwrap();
        assert_eq!(read(root.path(), "one").as_deref(), Some("[2]"));
    }

    fn bak(root: &Path, id: &str) -> PathBuf {
        backup_path(&message_path(root, id).unwrap())
    }

    #[test]
    fn each_replace_keeps_exactly_the_previous_version() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        assert!(!bak(root.path(), "one").exists(), "nothing to keep yet");
        save(root.path(), "one", "[2]").unwrap();
        assert_eq!(fs::read(bak(root.path(), "one")).unwrap(), b"[1]");
        save(root.path(), "one", "[3]").unwrap();
        assert_eq!(fs::read(bak(root.path(), "one")).unwrap(), b"[2]");
        assert_eq!(read(root.path(), "one").as_deref(), Some("[3]"));
        write_messages(root.path(), "one", b"[4]", false, true).unwrap();
        assert_eq!(fs::read(bak(root.path(), "one")).unwrap(), b"[3]");
    }

    #[test]
    fn data_is_flushed_before_it_is_renamed_into_place_at_every_durability_level() {
        for (durable, expected) in [(false, Flush::Routine), (true, Flush::Full)] {
            let root = tempfile::tempdir().unwrap();
            let path = message_path(root.path(), "one").unwrap();
            atomic_write(
                &path,
                b"[\"old\"]",
                Commit {
                    replace: true,
                    durable: false,
                    keep_previous: true,
                },
            )
            .unwrap();
            let parent = path.parent().unwrap();
            let mut temporary = tempfile::NamedTempFile::new_in(parent).unwrap();
            temporary.write_all(b"[\"new\"]").unwrap();
            let temporary_path = temporary.path().to_path_buf();
            let seen = std::cell::RefCell::new(Vec::new());
            commit_with(
                temporary,
                &path,
                Commit {
                    replace: true,
                    durable,
                    keep_previous: true,
                },
                |file, level| {
                    // The flush sees the complete new data while the main file
                    // still holds the old version: it precedes the rename.
                    let mut contents = String::new();
                    let mut file = file.try_clone().unwrap();
                    file.seek(SeekFrom::Start(0)).unwrap();
                    file.read_to_string(&mut contents).unwrap();
                    seen.borrow_mut().push((
                        level,
                        contents,
                        fs::read_to_string(&path).unwrap(),
                        temporary_path.exists(),
                    ));
                    Ok(())
                },
            )
            .unwrap();
            assert_eq!(
                seen.into_inner(),
                [(
                    expected,
                    "[\"new\"]".to_string(),
                    "[\"old\"]".to_string(),
                    true
                )]
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), "[\"new\"]");
        }
    }

    #[test]
    fn a_failed_flush_aborts_the_save_and_leaves_the_existing_file_untouched() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        save(root.path(), "one", "[2]").unwrap();
        let path = message_path(root.path(), "one").unwrap();
        let mut temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap()).unwrap();
        temporary.write_all(b"[3]").unwrap();
        let result = commit_with(
            temporary,
            &path,
            Commit {
                replace: true,
                durable: false,
                keep_previous: true,
            },
            |_, _| Err(std::io::Error::other("disk full")),
        );
        assert!(result.unwrap_err().contains("disk full"));
        assert_eq!(read(root.path(), "one").as_deref(), Some("[2]"));
        assert_eq!(fs::read(bak(root.path(), "one")).unwrap(), b"[1]");
    }

    #[test]
    fn the_real_flushes_succeed_on_a_real_file() {
        let root = tempfile::tempdir().unwrap();
        let file = fs::File::create(root.path().join("f")).unwrap();
        flush_file(&file, Flush::Routine).unwrap();
        flush_file(&file, Flush::Full).unwrap();
    }

    #[test]
    fn a_torn_main_file_falls_back_to_the_previous_version_and_is_quarantined() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", r#"[{"text":"first"}]"#).unwrap();
        save(root.path(), "one", r#"[{"text":"second"}]"#).unwrap();
        let path = message_path(root.path(), "one").unwrap();
        fs::write(&path, br#"[{"text":"sec"#).unwrap();

        assert_eq!(
            read(root.path(), "one").as_deref(),
            Some(r#"[{"text":"first"}]"#),
            "the previous version is served instead of an error"
        );
        assert_eq!(
            fs::read(quarantine_path(&path)).unwrap(),
            br#"[{"text":"sec"#,
            "the damaged file is kept for recovery"
        );
        // The main file is whole again, so later loads and saves are ordinary.
        assert_eq!(fs::read(&path).unwrap(), br#"[{"text":"first"}]"#);
        assert_eq!(
            read(root.path(), "one").as_deref(),
            Some(r#"[{"text":"first"}]"#)
        );
        save(root.path(), "one", r#"[{"text":"third"}]"#).unwrap();
        assert_eq!(
            read(root.path(), "one").as_deref(),
            Some(r#"[{"text":"third"}]"#)
        );
    }

    #[test]
    fn a_zero_length_main_file_after_power_loss_does_not_lose_the_conversation() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        save(root.path(), "one", "[2]").unwrap();
        fs::write(message_path(root.path(), "one").unwrap(), b"").unwrap();
        assert_eq!(read(root.path(), "one").as_deref(), Some("[1]"));
    }

    #[test]
    fn a_crash_between_keeping_the_previous_version_and_publishing_the_new_one_is_recoverable() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        save(root.path(), "one", "[2]").unwrap();
        let path = message_path(root.path(), "one").unwrap();
        fs::rename(&path, backup_path(&path)).unwrap();
        assert!(!path.exists());
        assert_eq!(read(root.path(), "one").as_deref(), Some("[2]"));
        assert!(path.exists(), "restored as the main file");
    }

    #[test]
    fn a_conversation_with_both_files_unreadable_is_reported_once_then_starts_fresh() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        save(root.path(), "one", "[2]").unwrap();
        let path = message_path(root.path(), "one").unwrap();
        fs::write(&path, b"{ nope").unwrap();
        fs::write(backup_path(&path), b"[ also nope").unwrap();

        let error = read_messages(root.path(), "one").unwrap_err();
        assert!(error.starts_with("corrupt:"), "{error}");
        assert!(quarantine_path(&path).exists());
        assert!(quarantine_path(&backup_path(&path)).exists());
        assert_eq!(read(root.path(), "one"), None);
        save(root.path(), "one", "[3]").unwrap();
        assert_eq!(read(root.path(), "one").as_deref(), Some("[3]"));
    }

    #[test]
    fn a_torn_main_file_is_not_rotated_over_a_good_previous_version() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        save(root.path(), "one", "[2]").unwrap();
        let path = message_path(root.path(), "one").unwrap();
        for torn in [&b""[..], b"[2", b"   ", b"{\"a\":1}", &[0u8; 4096][..]] {
            fs::write(&path, torn).unwrap();
            save(root.path(), "one", "[9]").unwrap();
            assert_eq!(fs::read(backup_path(&path)).unwrap(), b"[1]", "{torn:?}");
            assert_eq!(read(root.path(), "one").as_deref(), Some("[9]"));
            fs::write(&path, b"[2]").unwrap();
        }
    }

    #[test]
    fn plausibility_checks_only_the_edges_of_large_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("big.json");
        let big = format!("[{}0]", "0,".repeat(5_000_000));
        fs::write(&path, &big).unwrap();
        assert!(looks_complete(&path));
        fs::write(&path, &big[..big.len() - 1]).unwrap();
        assert!(!looks_complete(&path));
        fs::write(&path, "  \n[1]\n  ").unwrap();
        assert!(looks_complete(&path));
        assert!(!looks_complete(&root.path().join("missing.json")));
    }

    #[test]
    fn deleting_a_session_removes_its_previous_version_so_it_cannot_resurface() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "one", "[1]").unwrap();
        save(root.path(), "one", "[2]").unwrap();
        let path = message_path(root.path(), "one").unwrap();
        fs::write(&path, b"torn").unwrap();
        let _ = read_messages(root.path(), "one");
        fs::write(&path, b"torn again").unwrap();
        fs::write(backup_path(&path), b"also torn").unwrap();
        let _ = read_messages(root.path(), "one");
        save(root.path(), "one", "[3]").unwrap();
        save(root.path(), "one", "[4]").unwrap();

        delete_messages(root.path(), "one").unwrap();
        assert_eq!(
            fs::read_dir(root.path().join("conversations"))
                .unwrap()
                .count(),
            0,
            "nothing of the conversation is left"
        );
        assert_eq!(read(root.path(), "one"), None);
    }

    #[test]
    fn migration_and_the_legacy_copy_never_gain_previous_versions() {
        let root = tempfile::tempdir().unwrap();
        let legacy = r#"{"messages:a":[1],"messages:b":[2]}"#;
        fs::write(root.path().join(LEGACY_STORE), legacy).unwrap();
        write_messages(root.path(), "a", &json("[1]"), true, true).unwrap();
        write_messages(root.path(), "b", &json("[2]"), true, true).unwrap();
        delete_messages(root.path(), "a").unwrap();
        let names: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert!(
            names.iter().all(|name| !name.ends_with(".bak")),
            "{names:?}"
        );
        assert!(!bak(root.path(), "b").exists());
    }

    #[test]
    fn options_deserialize_with_defaults_so_a_plain_save_is_not_durable() {
        let options: SaveOptions = serde_json::from_str(r#"{"id":"s-1"}"#).unwrap();
        assert!(!options.migrate && !options.durable);
        let options: SaveOptions =
            serde_json::from_str(r#"{"id":"s-1","durable":true,"migrate":true}"#).unwrap();
        assert!(options.migrate && options.durable);
    }
}
