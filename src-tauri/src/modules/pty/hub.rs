//! The PTY transport hub: one thread for the whole process, serving every
//! webview's multiplexed output stream.
//!
//! The frontend keeps exactly one `poll` request outstanding per webview. The
//! hub holds that request's responder until at least one attached PTY is due
//! according to its presentation class, then answers with framed data for every
//! PTY whose deadline is within one interactive tick (aligned wakeups).
//! Acknowledgements ride on the next poll; an ack-only request is the exception.
//!
//! All scheduling state is owned by [`HubCore`], which is plain data driven by
//! explicit time, so it is tested without threads or a webview. [`Hub`] is the
//! thin shell: an inbox, a wake-up, and the thread that runs the core.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Once, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::gate::StreamTokens;
use super::output::MAX_IN_FLIGHT_BYTES;
#[cfg(test)]
use super::presentation::IMMEDIATE_BYTES;
use super::presentation::{coalesce_delay, PresentationClass, ALIGN_WINDOW};
use super::queue::{Deadline, OutputQueue, Summary};
use super::wake::Wake;
use super::wire::{Ack, ResponseBuilder, StreamRequest, MAX_FRAME_PAYLOAD};

/// A held poll is answered with an empty response this often, so a webview
/// that silently dropped the request recovers and an idle stream proves life.
pub(super) const KEEPALIVE: Duration = Duration::from_secs(30);
/// At most this much of one terminal goes into one response. Half the credit
/// window leaves room to send the next batch while the frontend is still
/// parsing this one, so a flood pipelines instead of ping-ponging, and several
/// floods share a response.
const PER_PTY_RESPONSE_BYTES: usize = MAX_IN_FLIGHT_BYTES / 2;
/// Guard against a zero-length sleep when the next deadline is already due
/// but could not be served (for example, the queue closed concurrently).
const MIN_SLEEP: Duration = Duration::from_millis(1);

pub(super) const STATUS_OK: u16 = 200;
pub(super) const STATUS_FORBIDDEN: u16 = 403;
pub(super) const STATUS_SUPERSEDED: u16 = 409;
pub(super) const STATUS_GONE: u16 = 410;

pub(super) trait Reply: Send {
    fn send(self: Box<Self>, status: u16, body: Vec<u8>);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Endpoint {
    Poll,
    Ack,
}

pub(super) enum Command {
    /// A page (re)attaches: new token, previous held poll released, and every
    /// PTY of the webview detached until the new page acknowledges it. When no
    /// unguessable token can be made the stream stays closed and the reply
    /// carries why.
    OpenStream {
        label: Arc<str>,
        reply: Box<dyn FnOnce(Result<u64, &'static str>) + Send>,
    },
    /// The page navigated away. Its token dies with it.
    ResetWebview {
        label: Arc<str>,
    },
    RemoveWebview {
        label: Arc<str>,
    },
    Register {
        id: u32,
        label: Arc<str>,
        queue: Arc<OutputQueue>,
        class: PresentationClass,
    },
    Unregister {
        id: u32,
    },
    /// `seq` is the frontend's counter for presentation reports. Commands run
    /// on a multi-threaded runtime and can arrive out of order, so each
    /// terminal keeps the class of the newest report that named it.
    SetPresentation {
        label: Arc<str>,
        ids: Vec<u32>,
        class: PresentationClass,
        seq: u64,
    },
    WindowHidden {
        label: Arc<str>,
        hidden: bool,
    },
    Request {
        label: Arc<str>,
        endpoint: Endpoint,
        request: StreamRequest,
        reply: Box<dyn Reply>,
    },
}

#[derive(Default)]
pub(super) struct HubStats {
    wakeups: AtomicU64,
    polls: AtomicU64,
    ack_requests: AtomicU64,
    rejected_requests: AtomicU64,
    responses: AtomicU64,
    keepalives: AtomicU64,
    data_frames: AtomicU64,
    data_bytes: AtomicU64,
    sync_frames: AtomicU64,
    exit_frames: AtomicU64,
    failed_frames: AtomicU64,
    unknown_acks: AtomicU64,
}

impl HubStats {
    fn bump(counter: &AtomicU64, by: u64) {
        counter.fetch_add(by, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> HubDiagnostics {
        let load = |counter: &AtomicU64| counter.load(Ordering::Relaxed);
        HubDiagnostics {
            wakeups: load(&self.wakeups),
            polls: load(&self.polls),
            ack_requests: load(&self.ack_requests),
            rejected_requests: load(&self.rejected_requests),
            responses: load(&self.responses),
            keepalives: load(&self.keepalives),
            data_frames: load(&self.data_frames),
            data_bytes: load(&self.data_bytes),
            sync_frames: load(&self.sync_frames),
            exit_frames: load(&self.exit_frames),
            failed_frames: load(&self.failed_frames),
            unknown_acks: load(&self.unknown_acks),
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub(super) struct HubDiagnostics {
    pub(super) wakeups: u64,
    pub(super) polls: u64,
    pub(super) ack_requests: u64,
    pub(super) rejected_requests: u64,
    pub(super) responses: u64,
    pub(super) keepalives: u64,
    pub(super) data_frames: u64,
    pub(super) data_bytes: u64,
    pub(super) sync_frames: u64,
    pub(super) exit_frames: u64,
    pub(super) failed_frames: u64,
    pub(super) unknown_acks: u64,
}

struct Held {
    reply: Box<dyn Reply>,
    since: Instant,
}

#[derive(Default)]
struct Stream {
    token: Option<u64>,
    held: Option<Held>,
    /// Native window occlusion or sleep (and any frontend-reported equivalent
    /// for the whole window) overrides every per-PTY class.
    window_hidden: bool,
}

struct Entry {
    label: Arc<str>,
    queue: Arc<OutputQueue>,
    reported: PresentationClass,
    /// Sequence number of the report behind `reported`; 0 until one arrives.
    reported_seq: u64,
    /// The frontend registered a receiver for this PTY on the current stream.
    attached: bool,
    /// A protocol violation to report once as a `failed` frame.
    failure: Option<&'static str>,
    /// A `failed` frame went out; no further output is delivered.
    failed: bool,
    /// `(sent, acknowledged)` when a `sync` frame was last requested, so the
    /// same wait is never nudged twice.
    nudged: Option<(u64, u64)>,
}

pub(super) type TokenSource = Box<dyn FnMut() -> Result<u64, &'static str> + Send>;

pub(super) struct HubCore {
    streams: HashMap<Arc<str>, Stream>,
    entries: HashMap<u32, Entry>,
    next_token: TokenSource,
    /// Mirror of every stream's token for the request handler, which rejects
    /// bad tokens without waking this thread. Updated before the page learns
    /// a token and as soon as one dies.
    tokens: Arc<StreamTokens>,
    stats: Arc<HubStats>,
}

impl HubCore {
    pub fn new(next_token: TokenSource, tokens: Arc<StreamTokens>, stats: Arc<HubStats>) -> Self {
        Self {
            streams: HashMap::new(),
            entries: HashMap::new(),
            next_token,
            tokens,
            stats,
        }
    }

    pub fn apply(&mut self, command: Command, now: Instant) {
        match command {
            Command::OpenStream { label, reply } => {
                let token = match (self.next_token)() {
                    Ok(token) => token,
                    Err(reason) => {
                        reply(Err(reason));
                        return;
                    }
                };
                let stream = self.streams.entry(label.clone()).or_default();
                release(stream.held.take(), STATUS_SUPERSEDED);
                stream.token = Some(token);
                self.tokens.publish(&label, token);
                self.detach(&label);
                reply(Ok(token));
            }
            Command::ResetWebview { label } => self.reset(&label),
            Command::RemoveWebview { label } => {
                self.reset(&label);
                self.streams.remove(&label);
                self.entries.retain(|_, entry| entry.label != label);
            }
            Command::Register {
                id,
                label,
                queue,
                class,
            } => {
                self.entries.insert(
                    id,
                    Entry {
                        label,
                        queue,
                        reported: class,
                        reported_seq: 0,
                        attached: false,
                        failure: None,
                        failed: false,
                        nudged: None,
                    },
                );
            }
            Command::Unregister { id } => {
                let Some(entry) = self.entries.remove(&id) else {
                    return;
                };
                let empty = !self
                    .entries
                    .values()
                    .any(|other| other.label == entry.label);
                if let (true, Some(stream)) = (empty, self.streams.get_mut(&entry.label)) {
                    release(stream.held.take(), STATUS_OK);
                }
            }
            Command::SetPresentation {
                label,
                ids,
                class,
                seq,
            } => {
                for id in ids {
                    if let Some(entry) = self.entries.get_mut(&id).filter(|e| e.label == label) {
                        if seq > entry.reported_seq {
                            entry.reported = class;
                            entry.reported_seq = seq;
                        }
                    }
                }
            }
            Command::WindowHidden { label, hidden } => {
                self.streams.entry(label).or_default().window_hidden = hidden;
            }
            Command::Request {
                label,
                endpoint,
                request,
                reply,
            } => self.request(&label, endpoint, request, reply, now),
        }
    }

    fn reset(&mut self, label: &Arc<str>) {
        self.tokens.revoke(label);
        if let Some(stream) = self.streams.get_mut(label) {
            stream.token = None;
            release(stream.held.take(), STATUS_GONE);
        }
        self.detach(label);
    }

    fn detach(&mut self, label: &Arc<str>) {
        for entry in self.entries.values_mut().filter(|e| &e.label == label) {
            entry.attached = false;
            entry.nudged = None;
        }
    }

    fn request(
        &mut self,
        label: &Arc<str>,
        endpoint: Endpoint,
        request: StreamRequest,
        reply: Box<dyn Reply>,
        now: Instant,
    ) {
        let authorized = self
            .streams
            .get(label)
            .is_some_and(|stream| stream.token == Some(request.token));
        if !authorized {
            HubStats::bump(&self.stats.rejected_requests, 1);
            reply.send(STATUS_FORBIDDEN, b"stale or missing stream token".to_vec());
            return;
        }
        self.apply_acks(label, &request.acks);
        match endpoint {
            Endpoint::Ack => {
                HubStats::bump(&self.stats.ack_requests, 1);
                reply.send(STATUS_OK, Vec::new());
            }
            Endpoint::Poll => {
                HubStats::bump(&self.stats.polls, 1);
                let stream = self.streams.get_mut(label).expect("authorized stream");
                release(stream.held.take(), STATUS_SUPERSEDED);
                stream.held = Some(Held { reply, since: now });
            }
        }
    }

    /// Cumulative acknowledgements. An entry also attaches its PTY, which is
    /// how a new receiver announces itself (a zero acknowledgement is valid).
    /// Unknown or foreign ids are ignored: they are ordinary races with close.
    fn apply_acks(&mut self, label: &Arc<str>, acks: &[Ack]) {
        for ack in acks {
            let Some(entry) = self.entries.get_mut(&ack.id).filter(|e| &e.label == label) else {
                HubStats::bump(&self.stats.unknown_acks, 1);
                continue;
            };
            entry.attached = true;
            if ack.bytes == 0 {
                continue;
            }
            if entry.queue.acknowledge(ack.bytes).is_err() {
                log::warn!(
                    "pty {}: invalid output acknowledgement {}",
                    ack.id,
                    ack.bytes
                );
                entry.failure = Some("invalid output acknowledgement boundary");
            }
        }
    }

    /// Runs the scheduler at `now` and returns when it next needs to run.
    pub fn step(&mut self, now: Instant) -> Option<Instant> {
        self.entries.retain(|_, entry| !entry.queue.is_abandoned());
        let mut next: Option<Instant> = None;
        for entry in self.entries.values() {
            if let Deadline::Armed(deadline) = entry.queue.check_deadline(now) {
                earliest(&mut next, deadline);
            }
        }
        let labels: Vec<Arc<str>> = self
            .streams
            .iter()
            .filter(|(_, stream)| stream.token.is_some() && stream.held.is_some())
            .map(|(label, _)| label.clone())
            .collect();
        for label in labels {
            self.serve(&label, now, &mut next);
        }
        next.map(|deadline| deadline.max(now + MIN_SLEEP))
    }

    fn serve(&mut self, label: &Arc<str>, now: Instant, next: &mut Option<Instant>) {
        let window_hidden = self.streams[label].window_hidden;
        let mut ids: Vec<u32> = self
            .entries
            .iter()
            .filter(|(_, entry)| &entry.label == label && entry.attached)
            .map(|(id, _)| *id)
            .collect();
        ids.sort_unstable();
        let summaries: Vec<(u32, Summary)> = ids
            .iter()
            .map(|id| (*id, self.entries[id].queue.summary()))
            .collect();

        let mut body = ResponseBuilder::new();
        let mut stats = FrameStats::default();

        for (id, summary) in &summaries {
            let entry = self.entries.get_mut(id).expect("listed entry");
            if entry.failed {
                continue;
            }
            let reason = entry
                .failure
                .take()
                .or(summary.reader_failed.then_some("PTY reader failed"));
            if let Some(reason) = reason {
                if body.push_failed(*id, reason) {
                    entry.failed = true;
                    stats.failed += 1;
                } else {
                    entry.failure = Some(reason);
                }
            }
        }

        let mut candidates: Vec<Candidate> = summaries
            .iter()
            .filter(|(id, summary)| !self.entries[id].failed && summary.pending_len > 0)
            .filter_map(|(id, summary)| {
                let entry = &self.entries[id];
                let class = if window_hidden {
                    PresentationClass::Occluded
                } else {
                    entry.reported
                };
                Some(Candidate {
                    id: *id,
                    class,
                    due: due_at(class, summary, now)?,
                })
            })
            .collect();
        let horizon = now + ALIGN_WINDOW;
        if candidates.iter().any(|candidate| candidate.due <= now) {
            candidates.sort_by_key(|c| (c.due, c.class.priority(), c.id));
            let chosen: Vec<&Candidate> = candidates.iter().filter(|c| c.due <= horizon).collect();
            // Round-robin one frame per PTY so a flood cannot starve the rest
            // of the response budget.
            let mut served = vec![0usize; chosen.len()];
            loop {
                let mut progressed = false;
                for (candidate, served) in chosen.iter().zip(&mut served) {
                    if *served >= PER_PTY_RESPONSE_BYTES {
                        continue;
                    }
                    let queue = &self.entries[&candidate.id].queue;
                    let taken = body.push_data_with(
                        candidate.id,
                        MAX_FRAME_PAYLOAD.min(PER_PTY_RESPONSE_BYTES - *served),
                        |out, max| queue.take_into(out, max, now),
                    );
                    if let Some(bytes) = taken {
                        *served += bytes;
                        stats.data_frames += 1;
                        stats.data_bytes += bytes as u64;
                        progressed = true;
                    }
                }
                if !progressed {
                    break;
                }
            }
        }

        let mut finished = Vec::new();
        for (id, summary) in &summaries {
            if summary.exit_ready() {
                let code = summary.final_exit_code().unwrap_or(-1);
                if body.push_exit(*id, code) {
                    stats.exit += 1;
                    finished.push(*id);
                }
                continue;
            }
            let entry = self.entries.get_mut(id).expect("listed entry");
            if entry.failed || !summary.waits_for_ack() {
                continue;
            }
            let key = (summary.sent, summary.acknowledged);
            if entry.nudged != Some(key) && body.push_sync(*id) {
                entry.nudged = Some(key);
                stats.sync += 1;
            }
        }
        for id in finished {
            if let Some(entry) = self.entries.remove(&id) {
                entry.queue.mark_finished();
            }
        }

        let stream = self.streams.get_mut(label).expect("stream");
        let since = stream.held.as_ref().expect("held poll").since;
        if !body.is_empty() {
            self.stats.record(&stats);
            let held = stream.held.take().expect("held poll");
            held.reply.send(STATUS_OK, body.into_body());
            return;
        }
        let keepalive = since + KEEPALIVE;
        if now >= keepalive {
            HubStats::bump(&self.stats.keepalives, 1);
            HubStats::bump(&self.stats.responses, 1);
            let held = stream.held.take().expect("held poll");
            held.reply.send(STATUS_OK, Vec::new());
            return;
        }
        earliest(next, keepalive);
        for candidate in &candidates {
            earliest(next, candidate.due);
        }
    }
}

#[derive(Default)]
struct FrameStats {
    data_frames: u64,
    data_bytes: u64,
    sync: u64,
    exit: u64,
    failed: u64,
}

impl HubStats {
    fn record(&self, frames: &FrameStats) {
        Self::bump(&self.responses, 1);
        Self::bump(&self.data_frames, frames.data_frames);
        Self::bump(&self.data_bytes, frames.data_bytes);
        Self::bump(&self.sync_frames, frames.sync);
        Self::bump(&self.exit_frames, frames.exit);
        Self::bump(&self.failed_frames, frames.failed);
    }
}

struct Candidate {
    id: u32,
    class: PresentationClass,
    due: Instant,
}

/// When this PTY's pending output must be delivered; `None` when there is
/// nothing to send or no credit to send it with.
fn due_at(class: PresentationClass, summary: &Summary, now: Instant) -> Option<Instant> {
    if summary.pending_len == 0 || summary.room == 0 {
        return None;
    }
    let since = summary.pending_since.unwrap_or(now);
    let gap = summary
        .last_sent_at
        .map(|sent| since.saturating_duration_since(sent));
    Some(since + coalesce_delay(class, gap, summary.pending_len))
}

fn earliest(slot: &mut Option<Instant>, candidate: Instant) {
    *slot = Some(slot.map_or(candidate, |current| current.min(candidate)));
}

fn release(held: Option<Held>, status: u16) {
    if let Some(held) = held {
        held.reply.send(status, Vec::new());
    }
}

struct Shared {
    inbox: Mutex<Vec<Command>>,
    wake: Arc<Wake>,
    started: Once,
    stats: Arc<HubStats>,
    tokens: Arc<StreamTokens>,
}

/// Cheap, cloneable handle to the process-wide hub thread. The thread starts
/// on first use, so an app that never opens a terminal pays nothing.
#[derive(Clone)]
pub struct Hub {
    shared: Arc<Shared>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        Self {
            shared: Arc::new(Shared {
                inbox: Mutex::new(Vec::new()),
                wake: Arc::new(Wake::default()),
                started: Once::new(),
                stats: Arc::new(HubStats::default()),
                tokens: Arc::new(StreamTokens::default()),
            }),
        }
    }

    pub(super) fn tokens(&self) -> &StreamTokens {
        &self.shared.tokens
    }

    #[cfg(test)]
    pub(super) fn started(&self) -> bool {
        self.shared.started.is_completed()
    }

    pub(super) fn wake(&self) -> Arc<Wake> {
        self.shared.wake.clone()
    }

    pub(super) fn diagnostics(&self) -> HubDiagnostics {
        self.shared.stats.snapshot()
    }

    pub(super) fn submit(&self, command: Command) {
        self.shared.started.call_once(|| {
            let shared = self.shared.clone();
            std::thread::Builder::new()
                .name("terax-pty-hub".into())
                .stack_size(256 * 1024)
                .spawn(move || run(shared))
                .expect("spawn pty hub thread");
        });
        self.shared
            .inbox
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(command);
        self.shared.wake.poke();
    }
}

const TOKEN_UNAVAILABLE: &str =
    "the operating system could not supply random bytes, so the PTY stream cannot be opened securely";

/// An unguessable non-zero token from the given entropy source. There is no
/// fallback: a token derived from the clock could be predicted by another
/// frame, so failing to get randomness refuses the stream.
fn random_token<E>(mut fill: impl FnMut(&mut [u8]) -> Result<(), E>) -> Result<u64, &'static str> {
    // A zero token is only ever a bug (the wire's "no token"), 2^-64 per draw.
    for _ in 0..4 {
        let mut bytes = [0u8; 8];
        fill(&mut bytes).map_err(|_| TOKEN_UNAVAILABLE)?;
        let token = u64::from_le_bytes(bytes);
        if token != 0 {
            return Ok(token);
        }
    }
    Err(TOKEN_UNAVAILABLE)
}

fn os_token() -> Result<u64, &'static str> {
    random_token(getrandom::fill)
}

fn run(shared: Arc<Shared>) {
    let mut core = HubCore::new(
        Box::new(os_token),
        shared.tokens.clone(),
        shared.stats.clone(),
    );
    loop {
        let commands =
            std::mem::take(&mut *shared.inbox.lock().unwrap_or_else(PoisonError::into_inner));
        let now = Instant::now();
        for command in commands {
            core.apply(command, now);
        }
        let next = core.step(Instant::now());
        HubStats::bump(&shared.stats.wakeups, 1);
        shared
            .wake
            .wait(next.map(|deadline| deadline.saturating_duration_since(Instant::now())));
    }
}

#[cfg(test)]
mod tests {
    use super::super::wire::{decode_frames, Frame, RESPONSE_CAP};
    use super::*;
    use crate::modules::pty::output::MAX_IN_FLIGHT_BYTES;
    use std::sync::mpsc;

    type Captured = Arc<Mutex<Vec<(u16, Vec<u8>)>>>;

    struct Capture(Captured);

    impl Reply for Capture {
        fn send(self: Box<Self>, status: u16, body: Vec<u8>) {
            self.0.lock().unwrap().push((status, body));
        }
    }

    struct Harness {
        core: HubCore,
        tokens: Arc<StreamTokens>,
        now: Instant,
        replies: Captured,
    }

    const LABEL: &str = "main";

    impl Harness {
        fn new() -> Self {
            let source = Arc::new(Mutex::new(1000u64));
            Self::with_source(Box::new(move || {
                let mut next = source.lock().unwrap();
                *next += 1;
                Ok(*next)
            }))
        }

        fn with_source(source: TokenSource) -> Self {
            let tokens = Arc::new(StreamTokens::default());
            Self {
                core: HubCore::new(source, tokens.clone(), Arc::new(HubStats::default())),
                tokens,
                now: Instant::now(),
                replies: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn label(&self) -> Arc<str> {
            Arc::from(LABEL)
        }

        fn try_open(&mut self) -> Result<u64, &'static str> {
            let (tx, rx) = mpsc::channel();
            self.core.apply(
                Command::OpenStream {
                    label: self.label(),
                    reply: Box::new(move |token| tx.send(token).unwrap()),
                },
                self.now,
            );
            self.step();
            rx.recv().unwrap()
        }

        fn open(&mut self) -> u64 {
            self.try_open().unwrap()
        }

        fn register(&mut self, id: u32, class: PresentationClass) -> Arc<OutputQueue> {
            let queue = Arc::new(OutputQueue::new(None));
            self.core.apply(
                Command::Register {
                    id,
                    label: self.label(),
                    queue: queue.clone(),
                    class,
                },
                self.now,
            );
            queue
        }

        fn push(&self, queue: &OutputQueue, bytes: &[u8]) {
            assert!(queue.push_with(bytes, || self.now));
        }

        fn request(&mut self, endpoint: Endpoint, token: u64, acks: &[Ack]) -> Option<u16> {
            let before = self.replies.lock().unwrap().len();
            self.core.apply(
                Command::Request {
                    label: self.label(),
                    endpoint,
                    request: StreamRequest {
                        token,
                        acks: acks.to_vec(),
                    },
                    reply: Box::new(Capture(self.replies.clone())),
                },
                self.now,
            );
            self.replies
                .lock()
                .unwrap()
                .get(before)
                .map(|(status, _)| *status)
        }

        fn poll(&mut self, token: u64, acks: &[Ack]) {
            self.request(Endpoint::Poll, token, acks);
            self.step();
        }

        fn attach(&mut self, token: u64, ids: &[u32]) {
            let acks: Vec<Ack> = ids.iter().map(|&id| Ack { id, bytes: 0 }).collect();
            self.poll(token, &acks);
        }

        fn step(&mut self) -> Option<Instant> {
            self.core.step(self.now)
        }

        fn advance(&mut self, by: Duration) -> Option<Instant> {
            self.now += by;
            self.step()
        }

        fn responses(&self) -> Vec<(u16, Vec<u8>)> {
            std::mem::take(&mut *self.replies.lock().unwrap())
        }

        fn frames(&self) -> Vec<(u32, String)> {
            // (pty, description) for every frame of every pending response.
            let mut out = Vec::new();
            for (status, body) in self.responses() {
                if status != STATUS_OK {
                    continue;
                }
                for frame in decode_frames(&body).unwrap() {
                    out.push(match frame {
                        Frame::Data {
                            id,
                            offset,
                            payload,
                        } => (id, format!("data@{offset}+{}", payload.len())),
                        Frame::Exit { id, code } => (id, format!("exit {code}")),
                        Frame::Failed { id, reason } => (id, format!("failed {reason}")),
                        Frame::Sync { id } => (id, "sync".to_string()),
                    });
                }
            }
            out
        }
    }

    fn ack(id: u32, bytes: u64) -> Ack {
        Ack { id, bytes }
    }

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn a_held_poll_is_answered_exactly_at_the_focused_deadline() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        assert!(h.responses().is_empty());
        h.push(&queue, b"hi");
        let next = h.step().expect("a deadline");
        assert_eq!(next, h.now + ms(4));
        assert!(h.advance(ms(3)).is_some());
        assert!(h.responses().is_empty(), "early wakeups answer nothing");
        h.advance(ms(1));
        assert_eq!(h.frames(), [(1, "data@0+2".to_string())]);
        // The poll was consumed; nothing else is sent until the next poll.
        h.push(&queue, b"more");
        h.advance(ms(500));
        assert!(h.responses().is_empty());
    }

    #[test]
    fn deadlines_follow_the_presentation_class() {
        for (class, deadline) in [
            (PresentationClass::Focused, 4),
            (PresentationClass::Visible, 16),
            (PresentationClass::Hidden, 100),
            (PresentationClass::Occluded, 250),
        ] {
            let mut h = Harness::new();
            let token = h.open();
            let queue = h.register(1, class);
            h.attach(token, &[1]);
            h.push(&queue, b"x");
            h.step();
            h.advance(ms(deadline - 1));
            assert!(h.responses().is_empty(), "{class:?} early");
            h.advance(ms(1));
            assert_eq!(h.frames(), [(1, "data@0+1".to_string())], "{class:?}");
        }
    }

    #[test]
    fn sustained_focused_output_uses_the_display_cadence() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"a");
        h.advance(ms(4));
        assert_eq!(h.frames().len(), 1);
        h.poll(token, &[ack(1, 1)]);
        // New bytes 10 ms after the last send: sustained window, 16 ms.
        h.advance(ms(10));
        h.push(&queue, b"b");
        h.step();
        h.advance(ms(15));
        assert!(h.responses().is_empty());
        h.advance(ms(1));
        assert_eq!(h.frames(), [(1, "data@1+1".to_string())]);
    }

    #[test]
    fn a_large_queue_is_due_immediately_even_when_hidden() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Occluded);
        h.attach(token, &[1]);
        h.push(&queue, &vec![7; IMMEDIATE_BYTES]);
        h.step();
        let frames = h.frames();
        assert_eq!(frames.len(), IMMEDIATE_BYTES / MAX_FRAME_PAYLOAD);
        assert_eq!(frames[0], (1, format!("data@0+{MAX_FRAME_PAYLOAD}")));
        // One byte short of the threshold still waits out the class deadline.
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Occluded);
        h.attach(token, &[1]);
        h.push(&queue, &vec![7; IMMEDIATE_BYTES - 1]);
        h.step();
        assert!(h.responses().is_empty());
    }

    #[test]
    fn wakeups_align_across_ptys_within_one_interactive_tick() {
        let mut h = Harness::new();
        let token = h.open();
        let a = h.register(1, PresentationClass::Focused);
        let b = h.register(2, PresentationClass::Visible);
        let c = h.register(3, PresentationClass::Hidden);
        h.attach(token, &[1, 2, 3]);
        h.push(&b, b"b"); // due at +16
        h.advance(ms(12));
        h.push(&a, b"a"); // due at +16 as well (12 + 4)
        h.push(&c, b"c"); // due at +112
        h.step();
        h.advance(ms(4));
        // a is due now and b (due exactly now) rides along; c waits.
        let mut frames = h.frames();
        frames.sort();
        assert_eq!(
            frames,
            [(1, "data@0+1".to_string()), (2, "data@0+1".to_string())]
        );
        h.poll(token, &[ack(1, 1), ack(2, 1)]);
        let next = h.step().unwrap();
        assert_eq!(next, h.now + ms(112 - 16));
    }

    #[test]
    fn a_pty_due_within_one_tick_is_pulled_forward_and_a_later_one_is_not() {
        let mut h = Harness::new();
        let token = h.open();
        let a = h.register(1, PresentationClass::Focused);
        let b = h.register(2, PresentationClass::Visible);
        let c = h.register(3, PresentationClass::Visible);
        h.attach(token, &[1, 2, 3]);
        h.push(&b, b"b"); // due +16
        h.advance(ms(13));
        h.push(&a, b"a"); // due +17 (13 + 4)
        h.push(&c, b"c"); // due +29: beyond the 4 ms alignment window
        h.advance(ms(3)); // now = +16: b is due, a is due in 1 ms and rides along
        let mut frames = h.frames();
        frames.sort();
        assert_eq!(
            frames,
            [(1, "data@0+1".to_string()), (2, "data@0+1".to_string())]
        );
    }

    #[test]
    fn every_class_is_served_in_priority_order_within_a_response() {
        let mut h = Harness::new();
        let token = h.open();
        let hidden = h.register(1, PresentationClass::Hidden);
        let focused = h.register(2, PresentationClass::Focused);
        h.attach(token, &[1, 2]);
        h.push(&hidden, &vec![1; IMMEDIATE_BYTES + 6 * 1024]);
        h.push(&focused, &vec![2; IMMEDIATE_BYTES + 6 * 1024]);
        h.step();
        let frames = h.frames();
        let first_hidden = frames.iter().position(|(id, _)| *id == 1).unwrap();
        let first_focused = frames.iter().position(|(id, _)| *id == 2).unwrap();
        assert!(first_focused < first_hidden, "{frames:?}");
    }

    #[test]
    fn window_occlusion_overrides_the_per_pty_class() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.core.apply(
            Command::WindowHidden {
                label: h.label(),
                hidden: true,
            },
            h.now,
        );
        h.push(&queue, b"x");
        h.step();
        h.advance(ms(249));
        assert!(h.responses().is_empty());
        h.advance(ms(1));
        assert_eq!(h.frames().len(), 1);
        // Unhiding restores the reported class.
        h.core.apply(
            Command::WindowHidden {
                label: h.label(),
                hidden: false,
            },
            h.now,
        );
        h.poll(token, &[ack(1, 1)]);
        h.push(&queue, b"y");
        h.step();
        // Focused again: sustained cadence (16 ms) since it just sent.
        h.advance(ms(15));
        assert!(h.responses().is_empty());
        h.advance(ms(1));
        assert_eq!(h.frames().len(), 1);
    }

    #[test]
    fn presentation_updates_apply_only_to_ptys_the_webview_owns() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.core.apply(
            Command::SetPresentation {
                label: Arc::from("other"),
                ids: vec![1, 99],
                class: PresentationClass::Occluded,
                seq: 1,
            },
            h.now,
        );
        h.push(&queue, b"x");
        h.step();
        h.advance(ms(4));
        assert_eq!(h.frames().len(), 1, "a foreign webview cannot reclass it");
        h.poll(token, &[ack(1, 1)]);
        h.core.apply(
            Command::SetPresentation {
                label: h.label(),
                ids: vec![1, 99],
                class: PresentationClass::Hidden,
                seq: 1,
            },
            h.now,
        );
        h.push(&queue, b"y");
        h.step();
        h.advance(ms(99));
        assert!(h.responses().is_empty());
        h.advance(ms(1));
        assert_eq!(h.frames().len(), 1);
    }

    impl Harness {
        fn report(&mut self, ids: &[u32], class: PresentationClass, seq: u64) {
            self.core.apply(
                Command::SetPresentation {
                    label: self.label(),
                    ids: ids.to_vec(),
                    class,
                    seq,
                },
                self.now,
            );
        }

        /// The class a terminal's output is scheduled under, observed as the
        /// coalescing delay (ms) of one byte pushed now. Leaves the clock a
        /// second later so probes do not feed each other's cadence.
        fn delay_ms(&mut self, id: u32, queue: &OutputQueue, token: u64) -> u64 {
            self.poll(token, &[ack(id, queue.summary().sent)]);
            self.responses();
            let start = self.now;
            self.push(queue, b"x");
            for waited in 0..=300 {
                self.now = start + ms(waited);
                self.step();
                if !self.responses().is_empty() {
                    self.now = start + ms(1000);
                    return waited;
                }
            }
            panic!("never delivered");
        }
    }

    #[test]
    fn a_late_presentation_report_cannot_undo_a_newer_one() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        // Reports 2 (focused) and 1 (hidden) arrive in the wrong order.
        h.report(&[1], PresentationClass::Focused, 2);
        h.report(&[1], PresentationClass::Hidden, 1);
        assert_eq!(h.delay_ms(1, &queue, token), 4, "newest report wins");
        h.report(&[1], PresentationClass::Hidden, 3);
        assert_eq!(h.delay_ms(1, &queue, token), 100);
        // A replayed report with the same number is not newer either.
        h.report(&[1], PresentationClass::Focused, 3);
        assert_eq!(h.delay_ms(1, &queue, token), 100);
        h.report(&[1], PresentationClass::Visible, 4);
        assert_eq!(h.delay_ms(1, &queue, token), 16);
    }

    #[test]
    fn presentation_order_is_tracked_per_terminal_so_overlapping_batches_compose() {
        let mut h = Harness::new();
        let token = h.open();
        let first = h.register(1, PresentationClass::Focused);
        let second = h.register(2, PresentationClass::Focused);
        h.attach(token, &[1, 2]);
        // Batch 6 names only terminal 2; the older batch 5 names both and
        // arrives afterwards: it still applies to terminal 1, not to terminal 2.
        h.report(&[2], PresentationClass::Focused, 6);
        h.report(&[1, 2], PresentationClass::Hidden, 5);
        assert_eq!(h.delay_ms(1, &first, token), 100);
        assert_eq!(h.delay_ms(2, &second, token), 4);
    }

    #[test]
    fn an_unattached_pty_is_not_delivered_until_its_receiver_announces_itself() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.poll(token, &[]);
        h.push(&queue, b"early");
        h.advance(ms(500));
        assert!(h.responses().is_empty());
        // A zero acknowledgement is the attach marker and grants no credit.
        h.request(Endpoint::Ack, token, &[ack(1, 0)]);
        h.step();
        assert_eq!(h.frames(), [(1, "data@0+5".to_string())]);
        assert_eq!(queue.summary().acknowledged, 0);
    }

    #[test]
    fn requests_with_a_stale_or_missing_token_are_refused_without_effects() {
        let mut h = Harness::new();
        assert_eq!(h.request(Endpoint::Poll, 5, &[]), Some(STATUS_FORBIDDEN));
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"x");
        h.advance(ms(4));
        assert_eq!(h.frames().len(), 1);
        assert_eq!(
            h.request(Endpoint::Ack, token ^ 1, &[ack(1, 1)]),
            Some(STATUS_FORBIDDEN)
        );
        assert_eq!(queue.summary().acknowledged, 0);
        assert_eq!(
            h.request(Endpoint::Ack, token, &[ack(1, 1)]),
            Some(STATUS_OK)
        );
        assert_eq!(queue.summary().acknowledged, 1);
    }

    #[test]
    fn reopening_the_stream_resets_the_generation_and_detaches_every_pty() {
        let mut h = Harness::new();
        let first = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(first, &[1]);
        let second = h.open();
        assert_ne!(first, second);
        // The held poll of the old generation was released as superseded.
        let responses = h.responses();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].0, STATUS_SUPERSEDED);
        // Old-generation requests are dead; the new generation starts detached.
        assert_eq!(
            h.request(Endpoint::Poll, first, &[]),
            Some(STATUS_FORBIDDEN)
        );
        h.poll(second, &[]);
        h.push(&queue, b"x");
        h.advance(ms(500));
        assert!(h.frames().is_empty(), "detached until re-announced");
        h.request(Endpoint::Ack, second, &[ack(1, 0)]);
        h.step();
        assert_eq!(h.frames(), [(1, "data@0+1".to_string())]);
    }

    #[test]
    fn page_reload_drops_the_held_responder_and_invalidates_the_token() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.core
            .apply(Command::ResetWebview { label: h.label() }, h.now);
        let responses = h.responses();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].0, STATUS_GONE);
        h.push(&queue, b"x");
        h.advance(ms(500));
        assert!(h.responses().is_empty(), "nothing is sent to a dead page");
        assert_eq!(
            h.request(Endpoint::Poll, token, &[]),
            Some(STATUS_FORBIDDEN)
        );
    }

    #[test]
    fn issued_tokens_are_published_to_the_request_handler_and_revoked_with_the_stream() {
        let mut h = Harness::new();
        assert!(!h.tokens.authorizes(LABEL, 1001));
        let first = h.open();
        assert!(h.tokens.authorizes(LABEL, first));
        let second = h.open();
        assert!(!h.tokens.authorizes(LABEL, first), "reopening supersedes");
        assert!(h.tokens.authorizes(LABEL, second));
        assert!(!h.tokens.authorizes("settings", second));
        h.core
            .apply(Command::ResetWebview { label: h.label() }, h.now);
        assert!(!h.tokens.authorizes(LABEL, second), "reload revokes");
        let third = h.open();
        assert!(h.tokens.authorizes(LABEL, third));
        h.core
            .apply(Command::RemoveWebview { label: h.label() }, h.now);
        assert!(!h.tokens.authorizes(LABEL, third), "destruction revokes");
    }

    #[test]
    fn a_stream_is_refused_when_the_system_cannot_supply_entropy() {
        let mut h = Harness::with_source(Box::new(|| Err("no entropy")));
        assert_eq!(h.try_open(), Err("no entropy"));
        assert!(!h.tokens.authorizes(LABEL, 0));
        assert_eq!(h.request(Endpoint::Poll, 0, &[]), Some(STATUS_FORBIDDEN));
    }

    #[test]
    fn a_failed_reopen_leaves_the_existing_stream_untouched() {
        let mut calls = 0;
        let mut h = Harness::with_source(Box::new(move || {
            calls += 1;
            if calls == 1 {
                Ok(0xFEED)
            } else {
                Err("no entropy")
            }
        }));
        let token = h.open();
        h.attach(token, &[]);
        assert!(h.try_open().is_err());
        assert!(h.tokens.authorizes(LABEL, token));
        assert_eq!(h.request(Endpoint::Ack, token, &[]), Some(STATUS_OK));
    }

    #[test]
    fn tokens_come_from_os_entropy_and_never_from_the_clock() {
        let mut bytes = [0u8; 8];
        let mut source = || {
            getrandom::fill(&mut bytes).unwrap();
            bytes
        };
        let a = random_token(|out| {
            out.copy_from_slice(&source());
            Ok::<_, ()>(())
        })
        .unwrap();
        let b = random_token(|out| {
            out.copy_from_slice(&source());
            Ok::<_, ()>(())
        })
        .unwrap();
        assert_ne!(a, 0);
        assert_ne!(a, b);
        assert!(os_token().is_ok());
        // Entropy failure is an error, with no time-based fallback.
        assert_eq!(
            random_token(|_| Err::<(), _>("EIO")),
            Err(TOKEN_UNAVAILABLE)
        );
        // A zero draw is retried; endless zeros fail rather than yield a token.
        let mut draws = 0;
        let token = random_token(|out| {
            draws += 1;
            out.copy_from_slice(&if draws < 3 { 0u64 } else { 0x77 }.to_le_bytes());
            Ok::<_, ()>(())
        });
        assert_eq!(token, Ok(0x77));
        assert_eq!(
            random_token(|out| {
                out.fill(0);
                Ok::<_, ()>(())
            }),
            Err(TOKEN_UNAVAILABLE)
        );
    }

    #[test]
    fn removing_a_webview_forgets_its_ptys_and_streams() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.core
            .apply(Command::RemoveWebview { label: h.label() }, h.now);
        assert_eq!(h.responses()[0].0, STATUS_GONE);
        assert!(h.core.entries.is_empty() && h.core.streams.is_empty());
        h.push(&queue, b"x");
        assert!(h.step().is_none());
    }

    #[test]
    fn a_second_poll_supersedes_the_first() {
        let mut h = Harness::new();
        let token = h.open();
        h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.poll(token, &[]);
        let responses = h.responses();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].0, STATUS_SUPERSEDED);
    }

    #[test]
    fn credit_caps_in_flight_bytes_and_acknowledgements_resume_delivery() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        // 1.5 MiB pending: the window releases 1 MiB, the rest waits for acks.
        h.push(&queue, &vec![5; MAX_IN_FLIGHT_BYTES]);
        h.push(&queue, &vec![6; MAX_IN_FLIGHT_BYTES / 2]);
        h.step();
        let delivered: usize = h
            .responses()
            .iter()
            .map(|(_, body)| {
                decode_frames(body)
                    .unwrap()
                    .iter()
                    .map(|f| match f {
                        Frame::Data { payload, .. } => payload.len(),
                        _ => 0,
                    })
                    .sum::<usize>()
            })
            .sum();
        assert!(delivered > 0 && delivered <= RESPONSE_CAP);
        // Keep polling without acknowledging: delivery stops at the window.
        let mut total = delivered;
        for _ in 0..20 {
            h.poll(token, &[]);
            h.advance(ms(20));
            for (_, body) in h.responses() {
                for frame in decode_frames(&body).unwrap() {
                    if let Frame::Data { payload, .. } = frame {
                        total += payload.len();
                    }
                }
            }
        }
        assert_eq!(total, MAX_IN_FLIGHT_BYTES);
        let summary = queue.summary();
        assert_eq!(summary.in_flight_bytes, MAX_IN_FLIGHT_BYTES);
        assert_eq!(summary.pending_len, MAX_IN_FLIGHT_BYTES / 2);
        // Acknowledge the first chunk boundary only: a partial release.
        h.poll(token, &[ack(1, MAX_FRAME_PAYLOAD as u64)]);
        h.advance(ms(20));
        let frames = h.frames();
        assert!(!frames.is_empty(), "credit released: {frames:?}");
    }

    #[test]
    fn duplicate_and_forged_acknowledgements_grant_no_credit() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"abc");
        h.advance(ms(4));
        h.responses();
        h.poll(token, &[ack(1, 3), ack(1, 3), ack(1, 2)]);
        let summary = queue.summary();
        assert_eq!(summary.acknowledged, 3);
        assert_eq!(summary.in_flight_bytes, 0);
        // A forged boundary fails only this PTY, once, with a failed frame.
        let other = h.register(2, PresentationClass::Focused);
        h.push(&other, b"z");
        h.attach(token, &[2]);
        h.advance(ms(4));
        h.responses();
        h.poll(token, &[ack(2, 99)]);
        assert_eq!(
            h.frames(),
            [(
                2,
                "failed invalid output acknowledgement boundary".to_string()
            )]
        );
        h.poll(token, &[ack(2, 99)]);
        h.advance(ms(100));
        assert!(
            h.frames().is_empty(),
            "the failure is reported exactly once"
        );
        assert_eq!(other.summary().acknowledged, 0);
    }

    #[test]
    fn unknown_and_foreign_acknowledgements_are_ignored() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"abc");
        h.advance(ms(4));
        h.responses();
        // PTY 77 does not exist; the valid entry in the same request applies.
        let status = h.request(Endpoint::Ack, token, &[ack(77, 5), ack(1, 3)]);
        assert_eq!(status, Some(STATUS_OK));
        assert_eq!(queue.summary().acknowledged, 3);
        assert_eq!(h.core.stats.snapshot().unknown_acks, 1);
    }

    #[test]
    fn a_response_is_capped_and_the_remainder_follows_in_the_next_poll() {
        let mut h = Harness::new();
        let token = h.open();
        let queues: Vec<_> = (1..=4)
            .map(|id| h.register(id, PresentationClass::Focused))
            .collect();
        h.attach(token, &[1, 2, 3, 4]);
        for queue in &queues {
            h.push(queue, &vec![9; 700 * 1024]);
        }
        h.step();
        let responses = h.responses();
        assert_eq!(responses.len(), 1);
        assert!(responses[0].1.len() <= RESPONSE_CAP);
        let per_pty: Vec<usize> = (1..=4)
            .map(|id| {
                decode_frames(&responses[0].1)
                    .unwrap()
                    .iter()
                    .filter_map(|f| match f {
                        Frame::Data { id: i, payload, .. } if *i == id => Some(payload.len()),
                        _ => None,
                    })
                    .sum()
            })
            .collect();
        // Round-robin: nobody is starved and nobody takes the whole budget.
        assert!(
            per_pty.iter().all(|bytes| *bytes >= 128 * 1024),
            "{per_pty:?}"
        );
        assert!(per_pty.iter().sum::<usize>() > RESPONSE_CAP - 64 * 1024);
        h.poll(token, &[]);
        assert!(!h.responses().is_empty(), "the rest is due immediately");
    }

    #[test]
    fn exit_follows_all_data_and_only_after_the_final_acknowledgement() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"bye\n");
        h.advance(ms(4));
        assert_eq!(h.frames(), [(1, "data@0+4".to_string())]);
        queue.begin_exit(Duration::from_secs(30));
        queue.finish_reading();
        queue.set_exit_code(3);
        // Unacknowledged data holds the exit back and nudges the frontend.
        h.poll(token, &[]);
        assert_eq!(h.frames(), [(1, "sync".to_string())]);
        h.poll(token, &[]);
        h.advance(ms(100));
        assert!(h.responses().is_empty(), "one nudge per unchanged state");
        assert!(!queue.summary().finished);
        h.request(Endpoint::Ack, token, &[ack(1, 4)]);
        h.step();
        assert_eq!(h.frames(), [(1, "exit 3".to_string())]);
        assert!(queue.summary().finished);
        assert!(h.core.entries.is_empty());
    }

    #[test]
    fn exit_after_acknowledged_data_needs_no_nudge() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"x");
        h.advance(ms(4));
        h.responses();
        h.poll(token, &[ack(1, 1)]);
        queue.finish_reading();
        queue.set_exit_code(0);
        h.step();
        assert_eq!(h.frames(), [(1, "exit 0".to_string())]);
    }

    #[test]
    fn exit_is_never_reordered_before_unsent_data() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Hidden);
        h.attach(token, &[1]);
        h.push(&queue, b"tail");
        queue.finish_reading();
        queue.set_exit_code(0);
        h.step();
        assert!(h.responses().is_empty(), "data is still coalescing");
        h.advance(ms(100));
        assert_eq!(h.frames(), [(1, "data@0+4".to_string())]);
        h.poll(token, &[ack(1, 4)]);
        assert_eq!(h.frames(), [(1, "exit 0".to_string())]);
    }

    #[test]
    fn a_stalled_frontend_gets_exit_minus_one_after_the_drain_deadline() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, b"data");
        h.advance(ms(4));
        h.responses();
        queue.begin_exit(Duration::from_secs(30));
        queue.finish_reading();
        queue.set_exit_code(0);
        h.poll(token, &[]);
        assert_eq!(h.frames(), [(1, "sync".to_string())]);
        // The frontend re-polls but never acknowledges.
        h.poll(token, &[]);
        let next = h.step().expect("the exit deadline is a timer");
        assert!(next > h.now + Duration::from_secs(29));
        assert!(next < h.now + KEEPALIVE);
        h.advance(Duration::from_secs(29) + ms(500));
        assert!(h.responses().is_empty());
        h.advance(ms(1500));
        assert_eq!(h.frames(), [(1, "exit -1".to_string())]);
        assert!(queue.summary().timed_out);
    }

    #[test]
    fn reader_failure_is_reported_once_as_a_failed_frame() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        queue.fail_reading();
        h.step();
        assert_eq!(h.frames(), [(1, "failed PTY reader failed".to_string())]);
        h.poll(token, &[]);
        h.advance(ms(1000));
        assert!(h.responses().is_empty());
    }

    #[test]
    fn credit_blocked_ptys_nudge_the_frontend_once_per_state() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, &vec![1; MAX_IN_FLIGHT_BYTES]);
        h.step();
        for _ in 0..3 {
            h.poll(token, &[]);
            h.advance(ms(20));
        }
        h.responses();
        assert_eq!(queue.summary().room, 0);
        assert_eq!(queue.summary().pending_len, 0);
        // A full window with nothing pending is not a stall: no nudge.
        h.poll(token, &[]);
        h.advance(ms(100));
        assert!(h.frames().is_empty());
        // New output blocked behind the full window asks for acknowledgements.
        h.push(&queue, &vec![2; 1000]);
        h.advance(ms(1));
        assert_eq!(h.frames(), [(1, "sync".to_string())]);
        h.poll(token, &[]);
        h.advance(ms(100));
        assert!(h.frames().is_empty(), "the same wait is nudged only once");
        // Credit released by an acknowledgement resumes delivery.
        h.poll(token, &[ack(1, MAX_FRAME_PAYLOAD as u64)]);
        h.advance(ms(20));
        assert_eq!(
            h.frames(),
            [(1, format!("data@{MAX_IN_FLIGHT_BYTES}+1000"))]
        );
    }

    #[test]
    fn an_idle_stream_sends_a_keepalive_every_thirty_seconds() {
        let mut h = Harness::new();
        let token = h.open();
        h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        let next = h.step().unwrap();
        assert_eq!(next, h.now + KEEPALIVE);
        h.advance(KEEPALIVE - ms(1));
        assert!(h.responses().is_empty());
        h.advance(ms(1));
        let responses = h.responses();
        assert_eq!(responses.len(), 1);
        assert_eq!((responses[0].0, responses[0].1.len()), (STATUS_OK, 0));
        assert_eq!(h.core.stats.snapshot().keepalives, 1);
    }

    #[test]
    fn closing_the_last_pty_releases_the_held_poll() {
        let mut h = Harness::new();
        let token = h.open();
        h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.core.apply(Command::Unregister { id: 1 }, h.now);
        let responses = h.responses();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].0, STATUS_OK);
        assert!(h.core.entries.is_empty());
    }

    #[test]
    fn a_closed_session_is_forgotten_even_without_an_unregister() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        queue.close();
        h.step();
        assert!(h.core.entries.is_empty());
    }

    #[test]
    fn one_flooding_pty_cannot_fill_a_response_so_the_next_batch_pipelines() {
        let mut h = Harness::new();
        let token = h.open();
        let queue = h.register(1, PresentationClass::Focused);
        h.attach(token, &[1]);
        h.push(&queue, &vec![3; MAX_IN_FLIGHT_BYTES]);
        h.step();
        let first = h.responses();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].1.len(), PER_PTY_RESPONSE_BYTES + 8 * 17);
        // No acknowledgement yet: half the window is still free, so the very
        // next poll is answered immediately with the rest.
        h.poll(token, &[]);
        let second = h.responses();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].1.len(), PER_PTY_RESPONSE_BYTES + 8 * 17);
        assert_eq!(queue.summary().in_flight_bytes, MAX_IN_FLIGHT_BYTES);
        assert_eq!(queue.summary().pending_len, 0);
    }

    /// The synthetic agent workload from the design: ten terminals, each
    /// emitting a small frame every 50 ms with unrelated phases. The frontend
    /// polls immediately after every response, acknowledging what it parsed.
    /// Returns `(responses, chunks)` over `seconds` of virtual time.
    fn spinner_workload(classes: &[PresentationClass], seconds: u64) -> (u64, u64) {
        let mut h = Harness::new();
        let token = h.open();
        let queues: Vec<_> = classes
            .iter()
            .enumerate()
            .map(|(index, class)| h.register(index as u32 + 1, *class))
            .collect();
        let ids: Vec<u32> = (1..=queues.len() as u32).collect();
        h.attach(token, &ids);
        let mut delivered = vec![0u64; queues.len()];
        let (mut responses, mut chunks) = (0u64, 0u64);
        for elapsed in 1..=seconds * 1000 {
            h.advance(ms(1));
            for (index, queue) in queues.iter().enumerate() {
                // Unrelated phases: 7 ms apart modulo the 50 ms period.
                if (elapsed + index as u64 * 7).is_multiple_of(50) {
                    h.push(queue, b"\r\x1b[2K\xe2\xa0\x8b thinking...");
                }
            }
            h.step();
            let mut acks = Vec::new();
            for (_, body) in h.responses() {
                responses += 1;
                for frame in decode_frames(&body).unwrap() {
                    if let Frame::Data { id, payload, .. } = frame {
                        chunks += 1;
                        delivered[id as usize - 1] += payload.len() as u64;
                        acks.push(ack(id, delivered[id as usize - 1]));
                    }
                }
            }
            if !acks.is_empty() {
                h.poll(token, &acks);
            }
        }
        (responses, chunks)
    }

    #[test]
    fn acknowledgements_piggyback_so_ipc_is_per_response_never_per_chunk() {
        let (responses, chunks) = spinner_workload(&[PresentationClass::Focused; 10], 10);
        // v1 paid a delivery eval plus an ack invoke for every chunk.
        let v1_ops = chunks * 2;
        eprintln!("10 focused spinners, 10 s: {responses} v2 ops vs {v1_ops} v1 ops");
        assert!(responses <= chunks);
        assert!(responses * 3 / 2 < v1_ops);
    }

    #[test]
    fn hidden_terminals_coalesce_into_rare_aligned_responses() {
        let mut mixed = vec![PresentationClass::Hidden; 9];
        mixed.insert(0, PresentationClass::Focused);
        let focused = spinner_workload(&[PresentationClass::Focused; 10], 10);
        let (responses, chunks) = spinner_workload(&mixed, 10);
        let v1_ops = focused.1 * 2;
        eprintln!(
            "1 focused + 9 hidden spinners, 10 s: {responses} v2 ops ({chunks} chunks) \
             vs {v1_ops} v1 ops for the same output"
        );
        // Hidden spinners deliver at ~10 Hz instead of 20 Hz, so chunks halve
        // and the remaining responses are shared between terminals.
        assert!(chunks * 10 < focused.1 * 7, "{chunks} vs {}", focused.1);
        assert!(
            responses < focused.0 * 6 / 10,
            "{responses} vs {}",
            focused.0
        );
        assert!(responses * 3 < v1_ops);
    }
}
