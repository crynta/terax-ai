// Pure SQLite persistence for terminal history. No Tauri command surface here.
// All logic is synchronous (rusqlite is sync); callers hold the Mutex.

use rusqlite::{params, Connection, Result as DbResult};
use std::path::Path;

pub struct FullEntry {
    pub id: i64,
    pub command: String,
    pub timestamp: i64,
    pub exit_code: Option<i32>,
    pub session_id: String,
}

pub struct Db {
    conn: Connection,
}

impl Db {
    /// Open (or create) the history database at `path`. On a corrupt or
    /// unreadable file: rename it to `<path>.bak` and start fresh so the app
    /// never refuses to start because of a bad history file.
    pub fn open(path: &Path) -> DbResult<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = match Connection::open(path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[history] failed to open history db: {e}; rotating to .bak");
                let bak = path.with_extension("db.bak");
                let _ = std::fs::rename(path, bak);
                Connection::open(path)?
            }
        };
        let db = Self { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> DbResult<()> {
        self.conn.execute_batch(
            "
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;

            CREATE TABLE IF NOT EXISTS history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                command    TEXT    NOT NULL,
                timestamp  INTEGER NOT NULL,
                exit_code  INTEGER,
                session_id TEXT    NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_history_ts  ON history(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_history_cmd ON history(command);
            ",
        )
    }

    /// Insert a new entry, returning its row id.
    pub fn insert(
        &self,
        command: &str,
        timestamp: i64,
        exit_code: Option<i32>,
        session_id: &str,
    ) -> DbResult<i64> {
        self.conn.execute(
            "INSERT INTO history (command, timestamp, exit_code, session_id)
             VALUES (?1, ?2, ?3, ?4)",
            params![command, timestamp, exit_code, session_id],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Delete a single entry by id.
    pub fn delete(&self, id: i64) -> DbResult<()> {
        self.conn
            .execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Delete all history entries.
    pub fn clear(&self) -> DbResult<()> {
        self.conn.execute_batch("DELETE FROM history;")?;
        Ok(())
    }

    /// Load all entries as (command, timestamp) pairs, ordered oldest-first,
    /// for seeding the in-memory index.
    pub fn load_all(&self) -> DbResult<Vec<(String, i64)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT command, timestamp FROM history ORDER BY timestamp ASC")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    /// Paginated full-entry listing, most-recent first, filtered by a
    /// case-insensitive substring query.
    pub fn list(
        &self,
        query: &str,
        limit: usize,
        offset: usize,
    ) -> DbResult<Vec<FullEntry>> {
        let pattern = format!("%{}%", query.to_lowercase());
        let mut stmt = self.conn.prepare(
            "SELECT id, command, timestamp, exit_code, session_id
             FROM history
             WHERE lower(command) LIKE ?1
             ORDER BY timestamp DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![pattern, limit as i64, offset as i64], |row| {
            Ok(FullEntry {
                id: row.get(0)?,
                command: row.get(1)?,
                timestamp: row.get(2)?,
                exit_code: row.get(3)?,
                session_id: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    /// Seed the database from existing shell-history pairs. Skips duplicates
    /// (same command + timestamp). Used exactly once when the DB is empty.
    pub fn seed(&self, entries: &[(String, i64)]) -> DbResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        for (cmd, ts) in entries {
            tx.execute(
                "INSERT OR IGNORE INTO history (command, timestamp, session_id)
                 VALUES (?1, ?2, '')",
                params![cmd, ts],
            )?;
        }
        tx.commit()
    }

    pub fn is_empty(&self) -> DbResult<bool> {
        let count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))?;
        Ok(count == 0)
    }

    /// Delete the oldest rows so the total count stays at or below `max`.
    pub fn trim(&self, max: usize) -> DbResult<()> {
        if max == 0 {
            return Ok(());
        }
        self.conn.execute(
            "DELETE FROM history WHERE id IN (
                SELECT id FROM history ORDER BY timestamp ASC, id ASC
                LIMIT MAX(0, (SELECT COUNT(*) FROM history) - ?1)
             )",
            params![max as i64],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn open_temp() -> (TempDir, Db) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("history.db");
        let db = Db::open(&path).unwrap();
        (dir, db)
    }

    #[test]
    fn insert_and_load() {
        let (_dir, db) = open_temp();
        db.insert("git status", 1000, Some(0), "sess-1").unwrap();
        db.insert("ls -la", 2000, None, "sess-1").unwrap();
        let rows = db.load_all().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "git status");
        assert_eq!(rows[1].0, "ls -la");
    }

    #[test]
    fn delete_single() {
        let (_dir, db) = open_temp();
        let id = db.insert("echo hi", 1000, Some(0), "s").unwrap();
        db.delete(id).unwrap();
        assert!(db.load_all().unwrap().is_empty());
    }

    #[test]
    fn clear_all() {
        let (_dir, db) = open_temp();
        db.insert("a", 1, Some(0), "s").unwrap();
        db.insert("b", 2, Some(0), "s").unwrap();
        db.clear().unwrap();
        assert!(db.load_all().unwrap().is_empty());
    }

    #[test]
    fn list_filters_by_query() {
        let (_dir, db) = open_temp();
        db.insert("git push", 3000, Some(0), "s").unwrap();
        db.insert("npm install", 2000, Some(0), "s").unwrap();
        db.insert("git status", 1000, Some(0), "s").unwrap();

        let results = db.list("git", 10, 0).unwrap();
        assert_eq!(results.len(), 2);
        // Most-recent first
        assert_eq!(results[0].command, "git push");
        assert_eq!(results[1].command, "git status");
    }

    #[test]
    fn list_pagination() {
        let (_dir, db) = open_temp();
        for i in 0..5i64 {
            db.insert(&format!("cmd{i}"), i * 100, None, "s").unwrap();
        }
        let page1 = db.list("", 2, 0).unwrap();
        let page2 = db.list("", 2, 2).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page2.len(), 2);
        // Pages must not overlap
        assert_ne!(page1[0].id, page2[0].id);
    }

    #[test]
    fn seed_and_is_empty() {
        let (_dir, db) = open_temp();
        assert!(db.is_empty().unwrap());
        db.seed(&[
            ("cargo build".into(), 1000),
            ("cargo test".into(), 2000),
        ])
        .unwrap();
        assert!(!db.is_empty().unwrap());
        let rows = db.load_all().unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn trim_respects_max() {
        let (_dir, db) = open_temp();
        for i in 0..10i64 {
            db.insert(&format!("cmd{i}"), i, None, "s").unwrap();
        }
        db.trim(5).unwrap();
        assert_eq!(db.load_all().unwrap().len(), 5);
    }

    #[test]
    fn corruption_recovery() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("history.db");
        // Write garbage that looks like a file but is not a valid SQLite DB.
        std::fs::write(&path, b"not a valid sqlite database").unwrap();
        // Must recover without panicking.
        let db = Db::open(&path).unwrap();
        db.insert("recovered", 1, None, "s").unwrap();
        assert_eq!(db.load_all().unwrap().len(), 1);
        // Backup file must exist.
        assert!(path.with_extension("db.bak").exists());
    }

    #[test]
    fn exit_code_roundtrip() {
        let (_dir, db) = open_temp();
        db.insert("false", 1000, Some(1), "s").unwrap();
        db.insert("true", 2000, Some(0), "s").unwrap();
        db.insert("unknown", 3000, None, "s").unwrap();

        let rows = db.list("", 10, 0).unwrap();
        // Most recent first
        assert_eq!(rows[0].exit_code, None);
        assert_eq!(rows[1].exit_code, Some(0));
        assert_eq!(rows[2].exit_code, Some(1));
    }
}
