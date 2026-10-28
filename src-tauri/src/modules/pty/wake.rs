//! A level-triggered wakeup for the hub thread. Producers (PTY readers, the
//! protocol handler) call [`Wake::poke`] after changing state; the hub calls
//! [`Wake::wait`] with the next deadline. A poke is never lost: it either lands
//! before the hub's check under the lock, or the hub is already parked and gets
//! the notification.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;

#[derive(Default)]
pub(super) struct Wake {
    dirty: AtomicBool,
    lock: Mutex<()>,
    changed: Condvar,
}

impl Wake {
    pub fn poke(&self) {
        // A poke already in flight covers this one: the hub drains all state
        // after it clears `dirty`, and our state change precedes this swap.
        if !self.dirty.swap(true, Ordering::AcqRel) {
            drop(self.lock.lock().unwrap_or_else(PoisonError::into_inner));
            self.changed.notify_one();
        }
    }

    /// Parks until poked or `timeout` elapses; `None` parks until poked. A
    /// poke that arrived since the last call returns immediately.
    pub fn wait(&self, timeout: Option<Duration>) {
        let guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        if self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let _guard = match timeout {
            Some(timeout) => {
                self.changed
                    .wait_timeout(guard, timeout)
                    .unwrap_or_else(PoisonError::into_inner)
                    .0
            }
            None => self
                .changed
                .wait(guard)
                .unwrap_or_else(PoisonError::into_inner),
        };
        self.dirty.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Instant;

    #[test]
    fn a_poke_before_the_wait_is_not_lost() {
        let wake = Wake::default();
        wake.poke();
        let start = Instant::now();
        wake.wait(Some(Duration::from_secs(5)));
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_poke_wakes_a_parked_waiter() {
        let wake = Arc::new(Wake::default());
        let waiter = {
            let wake = wake.clone();
            thread::spawn(move || {
                let start = Instant::now();
                wake.wait(None);
                start.elapsed()
            })
        };
        thread::sleep(Duration::from_millis(30));
        wake.poke();
        assert!(waiter.join().unwrap() < Duration::from_secs(2));
    }

    #[test]
    fn the_wait_times_out_without_a_poke() {
        let wake = Wake::default();
        let start = Instant::now();
        wake.wait(Some(Duration::from_millis(20)));
        assert!(start.elapsed() >= Duration::from_millis(15));
        // And the next poke is not swallowed by the earlier timeout.
        wake.poke();
        wake.wait(Some(Duration::from_secs(5)));
    }

    #[test]
    fn repeated_pokes_coalesce_into_one_wakeup() {
        let wake = Wake::default();
        for _ in 0..1000 {
            wake.poke();
        }
        wake.wait(Some(Duration::from_secs(5)));
        let start = Instant::now();
        wake.wait(Some(Duration::from_millis(20)));
        assert!(start.elapsed() >= Duration::from_millis(15));
    }
}
