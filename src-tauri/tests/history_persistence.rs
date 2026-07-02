// Integration tests for the history persistence layer.
// These complement the unit tests in db.rs by testing realistic workflows
// that cross function boundaries (seed → query → trim → clear etc).
//
// Run with: cargo test --locked --test history_persistence

use std::path::PathBuf;
use tempfile::TempDir;

// Re-open a fresh Db from the same path to verify data survives process-exit.
// We call the same Db::open path that the module uses at runtime.
// The `rusqlite::Connection` is not Send across threads in the way Tauri
// uses it (behind a Mutex), so these tests stay single-threaded.

use terax_lib::modules::history::db::Db;

fn tmp_db() -> (TempDir, Db) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("history.db");
    let db = Db::open(&path).expect("open db");
    (dir, db)
}

#[test]
fn data_survives_reopen() {
    let dir = TempDir::new().unwrap();
    let path: PathBuf = dir.path().join("history.db");
    {
        let db = Db::open(&path).unwrap();
        db.insert("git status", 1000, Some(0), "s1").unwrap();
        db.insert("cargo build", 2000, Some(0), "s1").unwrap();
    }
    // Re-open to simulate a restart.
    let db2 = Db::open(&path).unwrap();
    let rows = db2.load_all().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "git status");
    assert_eq!(rows[1].0, "cargo build");
}

#[test]
fn seed_only_runs_once_when_nonempty() {
    let (_dir, db) = tmp_db();
    db.insert("existing", 9999, Some(0), "pre").unwrap();
    assert!(!db.is_empty().unwrap());
    // Even if we call seed() when DB is non-empty, it must not error.
    db.seed(&[("seed-cmd".into(), 1000)]).unwrap();
    // The pre-existing entry and the seed both present (no dedup across insert/seed).
    let rows = db.load_all().unwrap();
    assert!(rows.len() >= 2);
}

#[test]
fn trim_after_bulk_insert() {
    let (_dir, db) = tmp_db();
    let entries: Vec<(String, i64)> = (0i64..200)
        .map(|i| (format!("cmd-{i}"), i))
        .collect();
    db.seed(&entries).unwrap();
    assert_eq!(db.load_all().unwrap().len(), 200);
    db.trim(100).unwrap();
    let rows = db.load_all().unwrap();
    assert_eq!(rows.len(), 100);
    // Verify that the 100 newest are kept (highest timestamps).
    let kept_ts: Vec<i64> = rows.iter().map(|(_, ts)| *ts).collect();
    assert!(kept_ts.iter().all(|&ts| ts >= 100));
}

#[test]
fn clear_then_reuse() {
    let (_dir, db) = tmp_db();
    db.insert("before", 1, None, "s").unwrap();
    db.clear().unwrap();
    db.insert("after", 2, None, "s").unwrap();
    let rows = db.load_all().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "after");
}

#[test]
fn list_respects_offset() {
    let (_dir, db) = tmp_db();
    for i in 0i64..10 {
        db.insert(&format!("cmd{i}"), i * 100, None, "s").unwrap();
    }
    let page_a = db.list("", 3, 0).unwrap();
    let page_b = db.list("", 3, 3).unwrap();
    let ids_a: Vec<i64> = page_a.iter().map(|e| e.id).collect();
    let ids_b: Vec<i64> = page_b.iter().map(|e| e.id).collect();
    for id in &ids_b {
        assert!(!ids_a.contains(id), "pages must not overlap");
    }
}

#[test]
fn disk_write_failure_graceful() {
    // Point the DB at a path inside a non-existent deeply-nested dir that
    // can't be created on this filesystem — expect open() to return an Err
    // rather than panicking.
    //
    // We simulate this by using a path where a file exists where a directory
    // is expected.
    let dir = TempDir::new().unwrap();
    let blocker = dir.path().join("blocker");
    std::fs::write(&blocker, b"file").unwrap();
    // "blocker" is a file; trying to use it as a directory for the db will fail.
    let bad_path = blocker.join("history.db");
    // The module tries to create parent dirs; this should fail gracefully.
    let result = Db::open(&bad_path);
    assert!(result.is_err());
}
