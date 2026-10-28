//! Latest-query-wins bookkeeping for interactive searches.
//!
//! Commands bump a named counter the moment they are dispatched, before any
//! blocking work starts, so an older search that is still walking sees the new
//! generation and stops. Searches of unrelated callers use different keys and
//! never cancel each other. The table of keys is bounded, and only keys no
//! search holds a ticket for are ever dropped from it: forgetting a key a
//! running search still holds would leave that search "current" forever, next
//! to the newer one that replaced it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

const MAX_KEYS: usize = 16;
const MAX_KEY_LEN: usize = 64;

#[derive(Default)]
pub struct Supersede {
    counters: Mutex<HashMap<String, Arc<AtomicU64>>>,
}

pub struct Ticket {
    counter: Arc<AtomicU64>,
    mine: u64,
}

impl Ticket {
    pub fn is_current(&self) -> bool {
        self.counter.load(Ordering::SeqCst) == self.mine
    }

    pub fn is_superseded(&self) -> bool {
        !self.is_current()
    }
}

impl Supersede {
    pub fn begin(&self, key: &str) -> Ticket {
        let end = (0..=key.len().min(MAX_KEY_LEN))
            .rev()
            .find(|&i| key.is_char_boundary(i))
            .unwrap_or(0);
        let key = &key[..end];
        let counter = {
            let mut counters = self.counters.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(counter) = counters.get(key) {
                counter.clone()
            } else {
                if counters.len() >= MAX_KEYS {
                    // A counter only the table holds has no ticket, and none
                    // can be issued while this lock is held.
                    counters.retain(|_, counter| Arc::strong_count(counter) > 1);
                }
                let counter = Arc::new(AtomicU64::new(0));
                // Sixteen keys all with searches in flight: this one goes
                // untracked rather than displacing any of them.
                if counters.len() < MAX_KEYS {
                    counters.insert(key.to_owned(), counter.clone());
                }
                counter
            }
        };
        let mine = counter.fetch_add(1, Ordering::SeqCst) + 1;
        Ticket { counter, mine }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newer_query_for_the_same_key_supersedes_the_older_one() {
        let state = Supersede::default();
        let first = state.begin("palette");
        assert!(first.is_current());
        let second = state.begin("palette");
        assert!(first.is_superseded());
        assert!(second.is_current());
    }

    #[test]
    fn unrelated_callers_never_cancel_each_other() {
        let state = Supersede::default();
        let explorer = state.begin("explorer");
        let agent = state.begin("agent");
        assert!(explorer.is_current());
        assert!(agent.is_current());
    }

    #[test]
    fn key_table_is_bounded_and_survivors_stay_consistent() {
        let state = Supersede::default();
        let keep = state.begin("keep");
        for i in 0..(MAX_KEYS * 2) {
            let _ = state.begin(&format!("k{i}"));
        }
        assert!(state.counters.lock().unwrap().len() <= MAX_KEYS);
        assert!(keep.is_current(), "eviction must not fake a supersession");
        assert!(state.begin("keep").is_current());
    }

    #[test]
    fn a_running_search_is_still_superseded_after_the_table_overflows() {
        let state = Supersede::default();
        let running = state.begin("palette");
        // Many other callers come and go, each finishing before the next.
        for i in 0..(MAX_KEYS * 4) {
            drop(state.begin(&format!("other{i}")));
        }
        assert!(running.is_current());
        let newer = state.begin("palette");
        assert!(
            running.is_superseded(),
            "overflow must not orphan the ticket"
        );
        assert!(newer.is_current());
    }

    #[test]
    fn only_idle_keys_are_evicted() {
        let state = Supersede::default();
        let held: Vec<Ticket> = (0..MAX_KEYS - 1)
            .map(|i| state.begin(&format!("held{i}")))
            .collect();
        drop(state.begin("idle"));
        assert_eq!(state.counters.lock().unwrap().len(), MAX_KEYS);

        let extra = state.begin("extra");
        let keys: Vec<String> = state.counters.lock().unwrap().keys().cloned().collect();
        assert!(
            !keys.contains(&"idle".to_string()),
            "the idle key made room"
        );
        assert!(keys.contains(&"extra".to_string()));
        for i in 0..MAX_KEYS - 1 {
            assert!(keys.contains(&format!("held{i}")), "held{i} was evicted");
        }
        assert!(held.iter().all(Ticket::is_current));
        assert!(extra.is_current());
        for (i, ticket) in held.iter().enumerate() {
            let newer = state.begin(&format!("held{i}"));
            assert!(ticket.is_superseded(), "held{i}");
            assert!(newer.is_current());
        }
    }

    #[test]
    fn with_every_key_busy_a_new_key_is_untracked_and_nobody_else_is_disturbed() {
        let state = Supersede::default();
        let held: Vec<Ticket> = (0..MAX_KEYS)
            .map(|i| state.begin(&format!("held{i}")))
            .collect();
        let overflow = state.begin("overflow");
        assert!(overflow.is_current());
        assert_eq!(state.counters.lock().unwrap().len(), MAX_KEYS);
        assert!(held.iter().all(Ticket::is_current));
        // The tracked searches are unaffected and still supersede correctly.
        let newer = state.begin("held3");
        assert!(held[3].is_superseded());
        assert!(newer.is_current());
        assert!(held
            .iter()
            .enumerate()
            .all(|(i, ticket)| i == 3 || ticket.is_current()));
        // Once a search finishes, its key's slot is reusable.
        drop(held);
        drop(newer);
        let late = state.begin("late");
        assert!(state.begin("late").is_current());
        assert!(late.is_superseded());
    }

    #[test]
    fn truncation_respects_utf8_boundaries() {
        let state = Supersede::default();
        let long = "\u{20ac}".repeat(100);
        let first = state.begin(&long);
        assert!(state.begin(&long).is_current());
        assert!(first.is_superseded());
    }

    #[test]
    fn oversized_keys_are_truncated_not_rejected() {
        let state = Supersede::default();
        let long = "x".repeat(500);
        let first = state.begin(&long);
        let second = state.begin(&long);
        assert!(first.is_superseded());
        assert!(second.is_current());
    }
}
