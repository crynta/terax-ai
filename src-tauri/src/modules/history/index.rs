// In-memory shell-history index. Pure: no I/O, no clock (callers pass `now`).
//
// Recording a command used to find-then-sort the whole vector on every accepted
// line. Here every command is one slab entry, found through a hash map, and its
// recency position lives in an ordered set, so recording is O(log n) and the
// queries walk in recency order and stop early.

use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

/// Distinct commands kept. Older ones are evicted as new ones arrive.
pub const MAX_ENTRIES: usize = 100_000;
/// Longest command stored; anything longer is a pasted blob, not history.
pub const MAX_COMMAND_BYTES: usize = 8 * 1024;

struct Entry {
    cmd: Arc<str>,
    count: u32,
    last: i64,
}

type Rank = (Reverse<i64>, Reverse<u32>, u32);

#[derive(Default)]
pub struct HistoryIndex {
    entries: Vec<Entry>,
    free: Vec<u32>,
    by_cmd: HashMap<Arc<str>, u32>,
    recency: BTreeSet<Rank>,
    first_words: HashMap<Arc<str>, u32>,
}

fn first_word(cmd: &str) -> &str {
    cmd.split_whitespace().next().unwrap_or("")
}

fn contains_ignore_case(haystack: &str, needle_lower: &str) -> bool {
    if needle_lower.is_ascii() {
        let needle = needle_lower.as_bytes();
        if needle.is_empty() {
            return true;
        }
        return haystack
            .as_bytes()
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle));
    }
    haystack.to_lowercase().contains(needle_lower)
}

impl HistoryIndex {
    /// `raw` is `(command, unix seconds)` in any order, duplicates allowed.
    pub fn build(raw: Vec<(String, i64)>) -> Self {
        let mut merged: HashMap<String, (u32, i64)> = HashMap::new();
        for (cmd, ts) in raw {
            if cmd.len() > MAX_COMMAND_BYTES {
                continue;
            }
            let slot = merged.entry(cmd).or_insert((0, 0));
            slot.0 += 1;
            slot.1 = slot.1.max(ts);
        }
        let mut ranked: Vec<(String, u32, i64)> = merged
            .into_iter()
            .map(|(cmd, (count, last))| (cmd, count, last))
            .collect();
        ranked.sort_by(|a, b| {
            b.2.cmp(&a.2)
                .then(b.1.cmp(&a.1))
                .then_with(|| a.0.cmp(&b.0))
        });
        ranked.truncate(MAX_ENTRIES);

        let mut index = Self::default();
        index.entries.reserve(ranked.len());
        for (cmd, count, last) in ranked {
            index.insert_new(Arc::from(cmd), count, last);
        }
        index
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.by_cmd.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.by_cmd.is_empty()
    }

    fn rank(&self, id: u32) -> Rank {
        let entry = &self.entries[id as usize];
        (Reverse(entry.last), Reverse(entry.count), id)
    }

    fn insert_new(&mut self, cmd: Arc<str>, count: u32, last: i64) {
        let entry = Entry {
            cmd: cmd.clone(),
            count,
            last,
        };
        let id = match self.free.pop() {
            Some(id) => {
                self.entries[id as usize] = entry;
                id
            }
            None => {
                self.entries.push(entry);
                (self.entries.len() - 1) as u32
            }
        };
        self.by_cmd.insert(cmd.clone(), id);
        self.recency.insert(self.rank(id));
        self.add_to_word(first_word(&cmd), count);
    }

    fn add_to_word(&mut self, word: &str, count: u32) {
        if word.is_empty() {
            return;
        }
        match self.first_words.get_mut(word) {
            Some(total) => *total += count,
            None => {
                self.first_words.insert(Arc::from(word), count);
            }
        }
    }

    fn evict_oldest(&mut self) {
        let Some(&oldest) = self.recency.last() else {
            return;
        };
        self.recency.remove(&oldest);
        let id = oldest.2;
        let cmd = self.entries[id as usize].cmd.clone();
        let count = self.entries[id as usize].count;
        self.by_cmd.remove(&cmd);
        let word = first_word(&cmd);
        if let Some(total) = self.first_words.get_mut(word) {
            *total = total.saturating_sub(count);
            if *total == 0 {
                self.first_words.remove(word);
            }
        }
        self.entries[id as usize].cmd = Arc::from("");
        self.free.push(id);
    }

    /// Records one accepted command: O(log n).
    pub fn record(&mut self, cmd: &str, now: i64) {
        let cmd = cmd.trim();
        if cmd.is_empty() || cmd.len() > MAX_COMMAND_BYTES {
            return;
        }
        if let Some(&id) = self.by_cmd.get(cmd) {
            let old_rank = self.rank(id);
            self.recency.remove(&old_rank);
            let entry = &mut self.entries[id as usize];
            entry.count += 1;
            entry.last = now;
            self.add_to_word(first_word(cmd), 1);
            let new_rank = self.rank(id);
            self.recency.insert(new_rank);
            return;
        }
        if self.by_cmd.len() >= MAX_ENTRIES {
            self.evict_oldest();
        }
        self.insert_new(Arc::from(cmd), 1, now);
    }

    /// Entries from most to least recent (ties: more frequent first).
    fn recent(&self) -> impl Iterator<Item = &Entry> {
        self.recency
            .iter()
            .map(|&(_, _, id)| &self.entries[id as usize])
    }

    /// fish-style autosuggestion: the most recent full command that extends
    /// `line`.
    pub fn suggest(&self, line: &str) -> Option<String> {
        if line.is_empty() {
            return None;
        }
        self.recent()
            .find(|e| e.cmd.len() > line.len() && e.cmd.starts_with(line))
            .map(|e| e.cmd.to_string())
    }

    /// Command-name candidates for the current token: history first-words (by
    /// frequency) first, then PATH executables (alphabetical), deduped.
    pub fn complete_commands(
        &self,
        path_cmds: &[String],
        prefix: &str,
        limit: usize,
    ) -> Vec<String> {
        let mut hist_words: Vec<(&str, u32)> = self
            .first_words
            .iter()
            .filter(|(word, _)| word.starts_with(prefix))
            .map(|(word, count)| (&**word, *count))
            .collect();
        hist_words.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));

        let mut seen: HashSet<&str> = HashSet::new();
        let mut out: Vec<String> = Vec::new();
        for (word, _) in hist_words {
            if seen.insert(word) {
                out.push(word.to_string());
                if out.len() >= limit {
                    return out;
                }
            }
        }
        let mut paths: Vec<&String> = path_cmds.iter().filter(|c| c.starts_with(prefix)).collect();
        paths.sort();
        for cmd in paths {
            if seen.insert(cmd) {
                out.push(cmd.clone());
                if out.len() >= limit {
                    break;
                }
            }
        }
        out
    }

    /// Recency-ranked, deduped commands for the Ctrl-R style popover.
    /// Substring, case-insensitive.
    pub fn list(&self, query: &str, limit: usize) -> Vec<String> {
        let q = query.trim().to_lowercase();
        self.recent()
            .filter(|e| q.is_empty() || contains_ignore_case(&e.cmd, &q))
            .take(limit)
            .map(|e| e.cmd.to_string())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(raw: &[(&str, i64)]) -> HistoryIndex {
        HistoryIndex::build(raw.iter().map(|(c, t)| ((*c).to_string(), *t)).collect())
    }

    #[test]
    fn build_dedups_counts_and_orders_by_recency() {
        let idx = index(&[("ls", 10), ("git st", 20), ("ls", 30)]);
        assert_eq!(idx.len(), 2);
        assert_eq!(idx.list("", 10), vec!["ls", "git st"]);
        let ls = &idx.entries[idx.by_cmd["ls"] as usize];
        assert_eq!((ls.count, ls.last), (2, 30));
    }

    #[test]
    fn suggest_picks_most_recent_match() {
        let idx = index(&[("git status", 10), ("git stash", 99), ("git push", 50)]);
        assert_eq!(idx.suggest("git st"), Some("git stash".into()));
        assert_eq!(idx.suggest("git status"), None);
        assert_eq!(idx.suggest(""), None);
    }

    #[test]
    fn list_filters_by_query_recent_first_and_case_insensitively() {
        let idx = index(&[("git status", 10), ("npm install", 30), ("git push", 20)]);
        assert_eq!(idx.list("", 10)[0], "npm install");
        assert_eq!(idx.list("GIT", 10), vec!["git push", "git status"]);
        assert_eq!(idx.list("git", 1), vec!["git push"]);
        assert_eq!(idx.list("\u{e9}t", 10), Vec::<String>::new());
    }

    #[test]
    fn list_handles_non_ascii_queries() {
        let idx = index(&[("echo \u{c9}T\u{c9}", 1), ("echo plain", 2)]);
        assert_eq!(idx.list("\u{e9}t\u{e9}", 10), vec!["echo \u{c9}T\u{c9}"]);
    }

    #[test]
    fn complete_commands_history_then_path() {
        let idx = index(&[("git status", 10), ("git status", 11), ("grep x", 5)]);
        let path = vec!["git".to_string(), "gzip".to_string(), "grep".to_string()];
        let got = idx.complete_commands(&path, "g", 10);
        assert_eq!(got[0], "git");
        assert_eq!(got[1], "grep");
        assert!(got.contains(&"gzip".to_string()));
        assert_eq!(got.len(), 3, "PATH names already offered are not repeated");
        assert_eq!(idx.complete_commands(&path, "g", 2), vec!["git", "grep"]);
    }

    #[test]
    fn recording_an_existing_command_moves_it_to_the_front() {
        let mut idx = index(&[("a", 10), ("b", 20), ("c", 30)]);
        assert_eq!(idx.list("", 10), vec!["c", "b", "a"]);
        idx.record("a", 40);
        assert_eq!(idx.list("", 10), vec!["a", "c", "b"]);
        let a = &idx.entries[idx.by_cmd["a"] as usize];
        assert_eq!((a.count, a.last), (2, 40));
        assert_eq!(idx.len(), 3);
    }

    #[test]
    fn recording_trims_ignores_empty_and_oversized_and_keeps_first_word_counts() {
        let mut idx = HistoryIndex::default();
        idx.record("   ", 1);
        idx.record(&"x".repeat(MAX_COMMAND_BYTES + 1), 1);
        assert!(idx.is_empty());
        idx.record("  git status  ", 1);
        idx.record("git status", 2);
        idx.record("git push", 3);
        assert_eq!(idx.len(), 2);
        assert_eq!(idx.first_words["git"], 3);
        assert_eq!(idx.complete_commands(&[], "gi", 5), vec!["git"]);
    }

    #[test]
    fn record_agrees_with_a_rebuild_from_the_same_history() {
        let mut live = index(&[("ls", 5), ("pwd", 6), ("git st", 7)]);
        let mut raw = vec![("ls", 5), ("pwd", 6), ("git st", 7)];
        for (i, cmd) in ["pwd", "cd /tmp", "ls", "git st", "pwd"].iter().enumerate() {
            let ts = 100 + i as i64;
            live.record(cmd, ts);
            raw.push((cmd, ts));
        }
        let rebuilt = index(&raw);
        assert_eq!(live.list("", 100), rebuilt.list("", 100));
        for word in ["ls", "pwd", "git", "cd"] {
            assert_eq!(live.first_words.get(word), rebuilt.first_words.get(word));
        }
    }

    #[test]
    fn the_index_is_bounded_and_evicts_the_oldest_command() {
        let mut idx = HistoryIndex::default();
        for i in 0..MAX_ENTRIES {
            idx.record(&format!("cmd {i}"), i as i64);
        }
        assert_eq!(idx.len(), MAX_ENTRIES);
        idx.record("brand new", MAX_ENTRIES as i64);
        assert_eq!(idx.len(), MAX_ENTRIES);
        assert!(!idx.by_cmd.contains_key("cmd 0"), "oldest entry evicted");
        assert!(idx.by_cmd.contains_key("brand new"));
        assert!(!idx.first_words.contains_key("zzz"));
        assert_eq!(idx.recency.len(), MAX_ENTRIES);
        assert_eq!(idx.entries.len(), MAX_ENTRIES, "evicted slots are reused");
        assert_eq!(idx.suggest("brand"), Some("brand new".into()));
    }

    #[test]
    fn build_truncates_to_the_cap_keeping_the_newest() {
        let raw: Vec<(String, i64)> = (0..(MAX_ENTRIES + 10))
            .map(|i| (format!("c{i}"), i as i64))
            .collect();
        let idx = HistoryIndex::build(raw);
        assert_eq!(idx.len(), MAX_ENTRIES);
        assert!(idx
            .by_cmd
            .contains_key(format!("c{}", MAX_ENTRIES + 9).as_str()));
        assert!(!idx.by_cmd.contains_key("c0"));
    }

    #[test]
    fn recording_stays_logarithmic_on_a_large_history() {
        let mut idx = HistoryIndex::build(
            (0..MAX_ENTRIES)
                .map(|i| (format!("cmd {i}"), i as i64))
                .collect(),
        );
        let started = std::time::Instant::now();
        for i in 0..5_000 {
            idx.record(
                &format!("cmd {}", i * 7 % MAX_ENTRIES),
                1_000_000 + i as i64,
            );
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "5k records on 100k entries took {:?}",
            started.elapsed()
        );
    }
}
