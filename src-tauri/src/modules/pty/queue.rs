//! One PTY's output queue: the reader appends, the hub takes frames out, and
//! cumulative acknowledgements release credit. A single mutex covers the
//! bytes, the credit and the exit state so reader completion, acknowledgements
//! and wakeups can never miss each other.
//!
//! Locking: a queue's mutex is a leaf. The hub thread owns its scheduling state
//! outright (no hub mutex exists) and only ever locks one queue at a time, and
//! a queue never takes another lock while holding its own; it pokes the hub's
//! [`Wake`] only after releasing it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::output::{InvalidBoundary, OutputCredit, MAX_BUFFERED_BYTES};
use super::presentation::IMMEDIATE_BYTES;
use super::wake::Wake;

/// Capacity above which an emptied pending buffer is released instead of kept.
const RETAINED_CAPACITY: usize = 64 * 1024;

struct QueueState {
    pending: Vec<u8>,
    /// Bytes at the front of `pending` that were already taken.
    head: usize,
    pending_since: Option<Instant>,
    credit: OutputCredit,
    last_sent_at: Option<Instant>,
    reader_done: bool,
    reader_failed: bool,
    exit_ack_deadline: Option<(Instant, Duration)>,
    exit_code: Option<i32>,
    drain_timed_out: bool,
    /// The exit frame was handed to the transport (or nobody can take it).
    finished: bool,
    /// Extra bytes the reader may retain beyond `MAX_BUFFERED_BYTES`.
    overdraft: usize,
}

impl QueueState {
    fn pending_len(&self) -> usize {
        self.pending.len() - self.head
    }

    /// Something still has to cross the transport. The exit deadline bounds
    /// this so a stalled frontend can never pin a finished shell forever.
    fn undelivered(&self) -> bool {
        self.pending_len() > 0
            || self.credit.in_flight_chunks() > 0
            || (self.exit_code.is_some() && !self.finished)
    }

    fn renew_deadline(&mut self) {
        if let Some((deadline, timeout)) = &mut self.exit_ack_deadline {
            *deadline = Instant::now() + *timeout;
        }
    }

    fn clear_pending(&mut self) {
        self.pending.clear();
        self.head = 0;
        self.pending_since = None;
        if self.pending.capacity() > RETAINED_CAPACITY {
            self.pending = Vec::new();
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Summary {
    pub pending_len: usize,
    pub pending_since: Option<Instant>,
    pub last_sent_at: Option<Instant>,
    pub room: usize,
    pub in_flight_bytes: usize,
    pub in_flight_chunks: usize,
    pub sent: u64,
    pub acknowledged: u64,
    pub reader_done: bool,
    pub reader_failed: bool,
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub finished: bool,
}

impl Summary {
    /// Every data frame is delivered and acknowledged and the reader reached
    /// EOF, so the exit frame can follow the data without reordering it.
    pub fn exit_ready(&self) -> bool {
        self.exit_code.is_some()
            && !self.finished
            && (self.timed_out
                || (self.reader_done && self.pending_len == 0 && self.in_flight_chunks == 0))
    }

    /// Native is idle only because it waits on this PTY's acknowledgement.
    pub fn waits_for_ack(&self) -> bool {
        self.in_flight_bytes > 0
            && ((self.pending_len > 0 && self.room == 0)
                || (self.pending_len == 0 && (self.reader_done || self.exit_code.is_some())))
    }

    /// Exit status to report: delivery failures override the child's status.
    pub fn final_exit_code(&self) -> Option<i32> {
        self.exit_code.map(|code| {
            if self.timed_out || self.reader_failed {
                -1
            } else {
                code
            }
        })
    }
}

pub(super) enum Deadline {
    /// No exit drain is pending.
    None,
    Armed(Instant),
    Expired,
}

pub(super) struct OutputQueue {
    state: Mutex<QueueState>,
    changed: Condvar,
    /// Reader-visible fast path: set when output is discarded for any reason.
    closed: AtomicBool,
    /// Explicit close (user, window destroyed, session dropped); unlike a
    /// delivery timeout, nobody is left to receive an exit frame.
    abandoned: AtomicBool,
    wake: Option<Arc<Wake>>,
}

impl OutputQueue {
    pub fn new(wake: Option<Arc<Wake>>) -> Self {
        Self {
            state: Mutex::new(QueueState {
                pending: Vec::new(),
                head: 0,
                pending_since: None,
                credit: OutputCredit::default(),
                last_sent_at: None,
                reader_done: false,
                reader_failed: false,
                exit_ack_deadline: None,
                exit_code: None,
                drain_timed_out: false,
                finished: false,
                overdraft: 0,
            }),
            changed: Condvar::new(),
            closed: AtomicBool::new(false),
            abandoned: AtomicBool::new(false),
            wake,
        }
    }

    fn lock(&self) -> MutexGuard<'_, QueueState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn poke(&self) {
        if let Some(wake) = &self.wake {
            wake.poke();
        }
    }

    /// Lock-free check for the reader's hot loop.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub fn is_abandoned(&self) -> bool {
        self.abandoned.load(Ordering::Acquire)
    }

    pub fn summary(&self) -> Summary {
        let state = self.lock();
        Summary {
            pending_len: state.pending_len(),
            pending_since: state.pending_since,
            last_sent_at: state.last_sent_at,
            room: state.credit.room(),
            in_flight_bytes: state.credit.in_flight_bytes(),
            in_flight_chunks: state.credit.in_flight_chunks(),
            sent: state.credit.sent_bytes(),
            acknowledged: state.credit.acknowledged_bytes(),
            reader_done: state.reader_done,
            reader_failed: state.reader_failed,
            timed_out: state.drain_timed_out,
            exit_code: state.exit_code,
            finished: state.finished,
        }
    }

    /// Reader side. Blocks while the 2 MiB pending plus in-flight bound (and
    /// any overdraft) is full; returns `false` once the queue is closed.
    pub fn push(&self, bytes: &[u8]) -> bool {
        self.push_with(bytes, Instant::now)
    }

    /// `now` is only consulted when the queue was empty, to stamp the start of
    /// the coalescing window.
    pub fn push_with(&self, bytes: &[u8], now: impl FnOnce() -> Instant) -> bool {
        let mut state = self.lock();
        while !self.is_closed()
            && state.pending_len() + state.credit.in_flight_bytes() + bytes.len()
                > MAX_BUFFERED_BYTES + state.overdraft
        {
            state = self.wait_change(state);
        }
        if self.is_closed() {
            return false;
        }
        let before = state.pending_len();
        if before == 0 {
            state.clear_pending();
            state.pending_since = Some(now());
        } else if state.head >= RETAINED_CAPACITY {
            let head = state.head;
            state.pending.drain(..head);
            state.head = 0;
        }
        state.pending.extend_from_slice(bytes);
        let crossed = before < IMMEDIATE_BYTES && state.pending_len() >= IMMEDIATE_BYTES;
        drop(state);
        // The hub already knows about a non-empty queue; it only needs to
        // hear about the first bytes and about the immediate threshold.
        if before == 0 || crossed {
            self.poke();
        }
        true
    }

    /// Lets the reader retain `bytes` beyond the usual bound, and wakes it if
    /// it is waiting for room. For the last moments of a PTY whose backlog the
    /// frontend has not caught up on: the reader must be able to take what the
    /// pseudoconsole still holds so that closing it cannot wait on the
    /// frontend. Memory stays bounded by `bytes` on top of the usual bound.
    #[cfg(any(windows, test))]
    pub fn allow_overdraft(&self, bytes: usize) {
        self.lock().overdraft = bytes;
        self.changed.notify_all();
    }

    /// Hub side: appends up to `max` bytes to `out`, registering them as one
    /// in-flight chunk. Returns the stream offset of the first byte and the
    /// count, or `None` when nothing may be sent (empty, closed, or no credit).
    pub fn take_into(&self, out: &mut Vec<u8>, max: usize, now: Instant) -> Option<(u64, usize)> {
        let mut state = self.lock();
        if self.is_closed() {
            return None;
        }
        let n = state.pending_len().min(max).min(state.credit.room());
        if n == 0 {
            return None;
        }
        if state.credit.in_flight_chunks() == 0 {
            state.renew_deadline();
        }
        let offset = state.credit.sent_bytes();
        let start = state.head;
        out.extend_from_slice(&state.pending[start..start + n]);
        state.head += n;
        if state.head == state.pending.len() {
            state.clear_pending();
        } else {
            // The remainder starts a fresh coalescing window.
            state.pending_since = Some(now);
        }
        state.credit.sent(n);
        state.last_sent_at = Some(now);
        Some((offset, n))
    }

    pub fn acknowledge(&self, bytes: u64) -> Result<bool, InvalidBoundary> {
        let mut state = self.lock();
        let progressed = state.credit.acknowledge(bytes)?;
        if progressed {
            state.renew_deadline();
            drop(state);
            self.changed.notify_all();
        }
        Ok(progressed)
    }

    /// Discards output and releases every blocked worker. Idempotent.
    pub fn close(&self) {
        self.abandoned.store(true, Ordering::Release);
        self.closed.store(true, Ordering::Release);
        let mut state = self.lock();
        state.clear_pending();
        drop(state);
        self.changed.notify_all();
        self.poke();
    }

    pub fn finish_reading(&self) {
        self.lock().reader_done = true;
        self.changed.notify_all();
        self.poke();
    }

    pub fn fail_reading(&self) {
        self.lock().reader_failed = true;
        self.poke();
    }

    pub fn begin_exit(&self, timeout: Duration) {
        self.lock().exit_ack_deadline = Some((Instant::now() + timeout, timeout));
        self.changed.notify_all();
        self.poke();
    }

    pub fn set_exit_code(&self, code: i32) {
        self.lock().exit_code = Some(code);
        self.poke();
    }

    /// The exit frame was delivered (or can never be). Releases the waiter.
    pub fn mark_finished(&self) {
        self.lock().finished = true;
        self.changed.notify_all();
    }

    /// Waiter side: blocks until the hub delivered the exit frame or the PTY
    /// was explicitly closed.
    pub fn wait_finished(&self) {
        let mut state = self.lock();
        while !state.finished && !self.is_abandoned() {
            state = self.wait_change(state);
        }
    }

    /// Applies the exit-drain deadline: when armed and the frontend made no
    /// progress for the whole window, discard output and fail delivery.
    pub fn check_deadline(&self, now: Instant) -> Deadline {
        let mut state = self.lock();
        let Some((deadline, _)) = state.exit_ack_deadline else {
            return Deadline::None;
        };
        if state.drain_timed_out || !state.undelivered() {
            return Deadline::None;
        }
        if now >= deadline {
            self.expire(&mut state);
            drop(state);
            self.changed.notify_all();
            self.poke();
            return Deadline::Expired;
        }
        Deadline::Armed(deadline)
    }

    fn expire(&self, state: &mut QueueState) {
        if !state.drain_timed_out {
            log::error!(
                "PTY output drain timed out after shell exit: {} bytes unacknowledged, {} bytes pending",
                state.credit.in_flight_bytes(),
                state.pending_len()
            );
        }
        state.drain_timed_out = true;
        self.closed.store(true, Ordering::Release);
        state.clear_pending();
    }

    fn wait_change<'a>(
        &'a self,
        mut state: MutexGuard<'a, QueueState>,
    ) -> MutexGuard<'a, QueueState> {
        if let Some((deadline, _)) = state.exit_ack_deadline {
            if state.undelivered() && !state.drain_timed_out {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    self.expire(&mut state);
                    self.changed.notify_all();
                    return state;
                }
                return self
                    .changed
                    .wait_timeout(state, remaining)
                    .unwrap_or_else(PoisonError::into_inner)
                    .0;
            }
        }
        self.changed
            .wait(state)
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn diagnostics(&self) -> QueueDiagnostics {
        let state = self.lock();
        QueueDiagnostics {
            sent_bytes: state.credit.sent_bytes(),
            acknowledged_bytes: state.credit.acknowledged_bytes(),
            pending_bytes: state.pending_len(),
            pending_capacity: state.pending.capacity(),
            in_flight_bytes: state.credit.in_flight_bytes(),
            in_flight_chunks: state.credit.in_flight_chunks(),
            reader_done: state.reader_done,
            closed: self.is_closed(),
            drain_timed_out: state.drain_timed_out,
            reader_failed: state.reader_failed,
        }
    }

    #[cfg(test)]
    pub(super) fn arm_exit_deadline_at(&self, deadline: Instant, timeout: Duration) {
        self.lock().exit_ack_deadline = Some((deadline, timeout));
    }

    #[cfg(test)]
    pub(super) fn exit_deadline(&self) -> Option<Instant> {
        self.lock().exit_ack_deadline.map(|(deadline, _)| deadline)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct QueueDiagnostics {
    pub sent_bytes: u64,
    pub acknowledged_bytes: u64,
    pub pending_bytes: usize,
    pub pending_capacity: usize,
    pub in_flight_bytes: usize,
    pub in_flight_chunks: usize,
    pub reader_done: bool,
    pub closed: bool,
    pub drain_timed_out: bool,
    pub reader_failed: bool,
}

#[cfg(test)]
mod tests {
    use super::super::output::{MAX_IN_FLIGHT_BYTES, MAX_IN_FLIGHT_CHUNKS};
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    fn take(queue: &OutputQueue) -> Option<Vec<u8>> {
        take_up_to(queue, usize::MAX)
    }

    fn take_up_to(queue: &OutputQueue, max: usize) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        queue.take_into(&mut out, max, Instant::now())?;
        Some(out)
    }

    fn full_queue() -> Arc<OutputQueue> {
        let queue = Arc::new(OutputQueue::new(None));
        // 1 MiB in flight, 1 MiB pending: the 2 MiB bound is exactly full.
        assert!(queue.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        assert_eq!(take(&queue).unwrap().len(), MAX_IN_FLIGHT_BYTES);
        assert!(queue.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        queue
    }

    #[test]
    fn an_overdraft_releases_a_reader_blocked_on_credit_without_any_acknowledgement() {
        let queue = full_queue();
        let (done, finished) = mpsc::channel();
        let reader = {
            let queue = queue.clone();
            thread::spawn(move || done.send(queue.push(&[7; 1000])).unwrap())
        };
        assert!(
            finished.recv_timeout(Duration::from_millis(100)).is_err(),
            "blocked while the queue is full"
        );
        queue.allow_overdraft(4096);
        assert_eq!(finished.recv_timeout(Duration::from_secs(5)), Ok(true));
        reader.join().unwrap();
        let summary = queue.summary();
        assert_eq!(summary.pending_len, MAX_IN_FLIGHT_BYTES + 1000);
        assert_eq!(summary.in_flight_bytes, MAX_IN_FLIGHT_BYTES);
    }

    #[test]
    fn the_overdraft_is_a_bound_not_a_removal_of_backpressure() {
        let queue = full_queue();
        queue.allow_overdraft(100);
        assert!(queue.push(&[1; 100]));
        let (done, finished) = mpsc::channel();
        let reader = {
            let queue = queue.clone();
            thread::spawn(move || done.send(queue.push(&[2])).unwrap())
        };
        assert!(
            finished.recv_timeout(Duration::from_millis(100)).is_err(),
            "one byte past the overdraft waits again"
        );
        queue.close();
        assert_eq!(finished.recv_timeout(Duration::from_secs(5)), Ok(false));
        reader.join().unwrap();
    }

    #[test]
    fn without_an_overdraft_the_usual_bound_holds() {
        let queue = full_queue();
        let (done, finished) = mpsc::channel();
        let reader = {
            let queue = queue.clone();
            thread::spawn(move || done.send(queue.push(&[1])).unwrap())
        };
        assert!(finished.recv_timeout(Duration::from_millis(100)).is_err());
        queue.close();
        assert_eq!(finished.recv_timeout(Duration::from_secs(5)), Ok(false));
        reader.join().unwrap();
    }

    #[test]
    fn shell_exit_releases_a_blocked_reader_and_the_waiter_when_the_frontend_stops_acknowledging() {
        let queue = Arc::new(OutputQueue::new(None));
        // 1 MiB in flight, 1 MiB pending: the 2 MiB bound is exactly full.
        assert!(queue.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        assert_eq!(take(&queue).unwrap().len(), MAX_IN_FLIGHT_BYTES);
        assert!(queue.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        let (sent, received) = mpsc::channel();
        let reader = {
            let queue = queue.clone();
            let sent = sent.clone();
            thread::spawn(move || sent.send(!queue.push(&[1])).unwrap())
        };
        queue.set_exit_code(0);
        let waiter = {
            let queue = queue.clone();
            thread::spawn(move || {
                queue.wait_finished();
                sent.send(true).unwrap();
            })
        };
        queue.begin_exit(Duration::from_millis(30));
        // The reader gives up at the deadline; the waiter keeps the exit frame
        // pending for the hub to deliver, so it is not released by the timeout.
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        reader.join().unwrap();
        assert!(received.recv_timeout(Duration::from_millis(50)).is_err());
        assert!(queue.summary().timed_out);
        assert!(queue.summary().exit_ready());
        assert_eq!(queue.summary().final_exit_code(), Some(-1));
        queue.mark_finished();
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        waiter.join().unwrap();
    }

    #[test]
    fn final_unacknowledged_chunk_times_out_after_reader_eof() {
        let queue = OutputQueue::new(None);
        queue.push(&[1]);
        take(&queue).unwrap();
        queue.finish_reading();
        queue.begin_exit(Duration::ZERO);
        assert!(matches!(
            queue.check_deadline(Instant::now()),
            Deadline::Expired
        ));
        assert!(queue.summary().timed_out);
        assert!(queue.is_closed());
        assert!(!queue.is_abandoned());
    }

    #[test]
    fn progressing_exit_drain_preserves_tail_and_renews_deadline() {
        let queue = OutputQueue::new(None);
        queue.push(&[1]);
        take(&queue).unwrap();
        queue.begin_exit(Duration::from_secs(1));
        let stale = Instant::now();
        queue.arm_exit_deadline_at(stale, Duration::from_secs(1));
        queue.acknowledge(1).unwrap();
        assert!(queue.exit_deadline().unwrap() > Instant::now());
        queue.push(&[2]);
        assert_eq!(take(&queue).unwrap(), vec![2]);
        queue.finish_reading();
        queue.set_exit_code(0);
        assert!(!queue.summary().exit_ready());
        queue.acknowledge(2).unwrap();
        assert!(queue.summary().exit_ready());
        assert!(!queue.summary().timed_out);
        // An undelivered exit frame is still bounded by the deadline...
        assert!(matches!(
            queue.check_deadline(Instant::now()),
            Deadline::Armed(_)
        ));
        // ...and nothing is left to bound once it has been handed over.
        queue.mark_finished();
        assert!(matches!(
            queue.check_deadline(Instant::now() + Duration::from_secs(60)),
            Deadline::None
        ));
        assert!(!queue.summary().timed_out);
    }

    #[test]
    fn reader_backpressure_releases_only_after_valid_cumulative_credit() {
        let queue = Arc::new(OutputQueue::new(None));
        assert!(queue.push(&vec![1; MAX_IN_FLIGHT_BYTES]));
        assert_eq!(take(&queue).unwrap().len(), MAX_IN_FLIGHT_BYTES);
        assert!(queue.push(&vec![1; MAX_IN_FLIGHT_BYTES]));
        let (sent, received) = mpsc::channel();
        let reader = {
            let queue = queue.clone();
            thread::spawn(move || sent.send(queue.push(&[2])).unwrap())
        };
        assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
        assert!(queue.acknowledge(1).is_err());
        assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
        queue.acknowledge(MAX_IN_FLIGHT_BYTES as u64).unwrap();
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        reader.join().unwrap();
        assert_eq!(take(&queue).unwrap().len(), MAX_IN_FLIGHT_BYTES);
        queue.acknowledge(2 * MAX_IN_FLIGHT_BYTES as u64).unwrap();
        assert_eq!(take(&queue).unwrap(), vec![2]);
    }

    #[test]
    fn eof_does_not_bypass_the_chunk_window_or_the_final_parser_acknowledgement() {
        let queue = OutputQueue::new(None);
        for byte in 0..MAX_IN_FLIGHT_CHUNKS as u8 {
            assert!(queue.push(&[byte]));
            assert_eq!(take(&queue).unwrap(), vec![byte]);
        }
        assert!(queue.push(&[200]));
        queue.finish_reading();
        queue.set_exit_code(0);
        // The window is full of tiny chunks: the tail must wait for credit.
        assert_eq!(take(&queue), None);
        assert!(!queue.summary().exit_ready());
        queue.acknowledge(2).unwrap();
        assert_eq!(take(&queue), Some(vec![200]));
        queue.acknowledge(2).unwrap();
        assert!(!queue.summary().exit_ready());
        queue.acknowledge(MAX_IN_FLIGHT_CHUNKS as u64 + 1).unwrap();
        assert!(queue.summary().exit_ready());
    }

    #[test]
    fn close_releases_a_blocked_reader_and_waiter() {
        let queue = Arc::new(OutputQueue::new(None));
        assert!(queue.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        take(&queue).unwrap();
        assert!(queue.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        let (sent, received) = mpsc::channel();
        let reader = {
            let queue = queue.clone();
            let sent = sent.clone();
            thread::spawn(move || sent.send(!queue.push(&[1])).unwrap())
        };
        let waiter = {
            let queue = queue.clone();
            thread::spawn(move || {
                queue.wait_finished();
                sent.send(true).unwrap();
            })
        };
        assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
        queue.close();
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        reader.join().unwrap();
        waiter.join().unwrap();
        assert!(queue.is_abandoned());
        assert_eq!(queue.summary().pending_len, 0);
    }

    #[test]
    fn take_respects_the_byte_window_and_frame_limit_and_keeps_order() {
        let queue = OutputQueue::new(None);
        let data: Vec<u8> = (0..255u8)
            .cycle()
            .take(3 * MAX_IN_FLIGHT_BYTES / 2)
            .collect();
        assert!(queue.push(&data[..MAX_IN_FLIGHT_BYTES]));
        assert!(queue.push(&data[MAX_IN_FLIGHT_BYTES..]));
        let mut out = Vec::new();
        let now = Instant::now();
        let (offset, n) = queue.take_into(&mut out, 1000, now).unwrap();
        assert_eq!((offset, n), (0, 1000));
        let (offset, n) = queue.take_into(&mut out, usize::MAX, now).unwrap();
        assert_eq!((offset, n), (1000, MAX_IN_FLIGHT_BYTES - 1000));
        assert_eq!(out, data[..MAX_IN_FLIGHT_BYTES]);
        // The window is full: the remaining half mebibyte waits for credit.
        assert_eq!(queue.take_into(&mut out, usize::MAX, now), None);
        assert_eq!(queue.summary().room, 0);
        assert_eq!(
            queue.summary().pending_len,
            data.len() - MAX_IN_FLIGHT_BYTES
        );
        queue.acknowledge(1000).unwrap();
        assert_eq!(
            queue.take_into(&mut out, usize::MAX, now),
            Some((MAX_IN_FLIGHT_BYTES as u64, 1000))
        );
        assert_eq!(
            out[MAX_IN_FLIGHT_BYTES..],
            data[MAX_IN_FLIGHT_BYTES..MAX_IN_FLIGHT_BYTES + 1000]
        );
    }

    #[test]
    fn a_drained_flood_releases_its_buffer_instead_of_pinning_two_mebibytes() {
        let queue = OutputQueue::new(None);
        assert!(queue.push(&vec![9; MAX_IN_FLIGHT_BYTES]));
        assert!(queue.diagnostics().pending_capacity >= MAX_IN_FLIGHT_BYTES);
        assert_eq!(take(&queue).unwrap().len(), MAX_IN_FLIGHT_BYTES);
        assert_eq!(queue.diagnostics().pending_capacity, 0);
        assert!(queue.push(&[1, 2, 3]));
        assert!(queue.diagnostics().pending_capacity < RETAINED_CAPACITY);
    }

    #[test]
    fn partial_takes_compact_instead_of_growing_without_bound() {
        let queue = OutputQueue::new(None);
        let mut expected = 0u64;
        let mut out = Vec::new();
        for round in 0..2000u32 {
            assert!(queue.push(&vec![round as u8; 100_000]));
            // Always leave a small remainder behind so the buffer never empties.
            let take = queue.summary().pending_len - 5_000;
            out.clear();
            let (offset, n) = queue.take_into(&mut out, take, Instant::now()).unwrap();
            assert_eq!(offset, expected);
            assert_eq!(n, take);
            expected += n as u64;
            queue.acknowledge(expected).unwrap();
            assert_eq!(queue.summary().pending_len, 5_000);
            assert!(queue.diagnostics().pending_capacity <= 4 * RETAINED_CAPACITY);
        }
    }

    #[test]
    fn closed_queues_refuse_new_work() {
        let queue = OutputQueue::new(None);
        queue.close();
        assert!(!queue.push(&[1]));
        assert_eq!(take(&queue), None);
        queue.close();
    }

    #[test]
    fn delivery_failure_overrides_the_child_exit_status() {
        let queue = OutputQueue::new(None);
        queue.set_exit_code(7);
        assert_eq!(queue.summary().final_exit_code(), Some(7));
        queue.fail_reading();
        assert_eq!(queue.summary().final_exit_code(), Some(-1));
    }

    #[test]
    fn only_the_first_bytes_and_the_immediate_threshold_poke_the_hub() {
        let wake = Arc::new(Wake::default());
        let queue = OutputQueue::new(Some(wake.clone()));
        let pokes = || {
            // A poke leaves `dirty` set; consuming it returns immediately.
            let start = Instant::now();
            wake.wait(Some(Duration::from_millis(15)));
            start.elapsed() < Duration::from_millis(10)
        };
        assert!(queue.push(&[1]));
        assert!(pokes());
        assert!(queue.push(&[2]));
        assert!(
            !pokes(),
            "bytes behind a pending queue must not wake the hub"
        );
        assert!(queue.push(&vec![3; IMMEDIATE_BYTES]));
        assert!(pokes(), "crossing 64 KiB makes the queue due immediately");
        assert!(queue.push(&[4; 100]));
        assert!(!pokes());
    }
}
