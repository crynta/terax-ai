//! Server side of `terax hook`: validates a hook delivered over the control
//! socket, turns it into a `terax:agent-event`, keeps the legacy
//! `terax:agent-signal` stream in step, and brokers permission decisions.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::net::TcpStream;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::json;
use tauri::{Emitter, Manager};
use terax_control_protocol::hook::{
    normalize, AgentEvent, AgentName, HookDecision, HookFacts, HookKind, HookParams, HookResult,
    NormalizeError, MAX_DECISION_SECS,
};
use terax_control_protocol::{ControlRequest, ControlResponse};

use crate::modules::pty::agent_detect::{AgentSignal, HookIntent};
use crate::modules::pty::PaneTarget;

pub const AGENT_EVENT: &str = "terax:agent-event";
const SIGNAL_EVENT: &str = "terax:agent-signal";

const MAX_PENDING_DECISIONS: usize = 16;
const MAX_PENDING_PER_PANE: usize = 4;
const DECISION_POLL: Duration = Duration::from_millis(200);
const BUCKET_CAPACITY: f64 = 100.0;
const BUCKET_REFILL_PER_SEC: f64 = 50.0;
const BUCKET_IDLE: Duration = Duration::from_secs(60);

/// Everything the hook handler needs from the running app.
pub trait AgentHost: Send + Sync {
    fn pane(&self, pane_id: u32) -> Option<PaneTarget>;
    fn emit_event(&self, owner: &str, event: &AgentEvent);
    fn emit_signal(&self, signal: AgentSignal);
}

pub struct TauriAgentHost<'a>(pub &'a tauri::AppHandle);

impl AgentHost for TauriAgentHost<'_> {
    fn pane(&self, pane_id: u32) -> Option<PaneTarget> {
        self.0
            .try_state::<crate::modules::pty::PtyState>()?
            .pane_target(pane_id)
    }

    fn emit_event(&self, owner: &str, event: &AgentEvent) {
        let _ = self.0.emit_to(owner, AGENT_EVENT, event);
    }

    fn emit_signal(&self, signal: AgentSignal) {
        let _ = self.0.emit(SIGNAL_EVENT, signal);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cancel {
    UiGone,
    PaneClosed,
    AgentGone,
    Timeout,
}

impl Cancel {
    fn outcome(self) -> &'static str {
        match self {
            Cancel::UiGone => "ui-gone",
            Cancel::PaneClosed => "pane-closed",
            Cancel::AgentGone => "agent-gone",
            Cancel::Timeout => "timeout",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Decided(HookDecision),
    Cancelled(Cancel),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Busy {
    Global,
    Pane,
}

struct Pending {
    pane_id: u32,
    window: String,
    sender: SyncSender<HookDecision>,
}

/// Pending permission requests awaiting an answer from the Terax UI.
#[derive(Default)]
pub struct DecisionBroker {
    ready_windows: Mutex<HashSet<String>>,
    pending: Mutex<HashMap<String, Pending>>,
}

impl DecisionBroker {
    #[cfg(test)]
    pub(crate) fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    /// Whether `window` shows decisions; only that window receives the events.
    pub fn ui_ready(&self, window: &str) -> bool {
        self.ready_windows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .contains(window)
    }

    /// A window announces (or withdraws) that it shows decisions. Withdrawing,
    /// or the window's page reloading, releases the agents waiting on it to
    /// their own prompt.
    pub fn set_window_ready(&self, window: &str, ready: bool) {
        let mut windows = self
            .ready_windows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if ready {
            windows.insert(window.to_string());
            return;
        }
        windows.remove(window);
        self.pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .retain(|_, entry| entry.window != window);
    }

    pub fn reset_all(&self) {
        self.ready_windows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clear();
        self.pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clear();
    }

    pub fn register(
        &self,
        pane_id: u32,
        window: &str,
    ) -> Result<(String, Receiver<HookDecision>), Busy> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if pending.len() >= MAX_PENDING_DECISIONS {
            return Err(Busy::Global);
        }
        if pending
            .values()
            .filter(|entry| entry.pane_id == pane_id)
            .count()
            >= MAX_PENDING_PER_PANE
        {
            return Err(Busy::Pane);
        }
        let id = random_id();
        let (sender, receiver) = mpsc::sync_channel(1);
        pending.insert(
            id.clone(),
            Pending {
                pane_id,
                window: window.to_string(),
                sender,
            },
        );
        Ok((id, receiver))
    }

    /// Delivers the user's answer; false when the request is gone.
    pub fn resolve(&self, id: &str, decision: HookDecision) -> bool {
        let entry = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(id);
        entry.is_some_and(|entry| entry.sender.send(decision).is_ok())
    }

    pub fn discard(&self, id: &str) {
        self.pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(id);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.pending.lock().unwrap().len()
    }
}

fn random_id() -> String {
    let mut bytes = [0_u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        bytes = nanos.to_le_bytes();
    }
    let mut id = String::with_capacity(34);
    id.push_str("d-");
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(id, "{byte:02x}");
    }
    id
}

/// Waits for the UI's answer, checking for cancellation every `tick`.
pub fn await_decision(
    receiver: &Receiver<HookDecision>,
    timeout: Duration,
    tick: Duration,
    mut check: impl FnMut() -> Option<Cancel>,
) -> Verdict {
    let deadline = Instant::now() + timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Verdict::Cancelled(Cancel::Timeout);
        }
        match receiver.recv_timeout(tick.min(deadline - now)) {
            Ok(decision) => return Verdict::Decided(decision),
            Err(RecvTimeoutError::Disconnected) => return Verdict::Cancelled(Cancel::UiGone),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(cancel) = check() {
                    return Verdict::Cancelled(cancel);
                }
            }
        }
    }
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

/// Per-pane token bucket for high-frequency hook kinds.
#[derive(Default)]
pub struct HookLimiter {
    buckets: HashMap<u32, Bucket>,
}

impl HookLimiter {
    pub fn allow(&mut self, pane_id: u32, now: Instant) -> bool {
        if self.buckets.len() > 64 {
            self.buckets
                .retain(|_, bucket| now.saturating_duration_since(bucket.at) < BUCKET_IDLE);
        }
        let bucket = self.buckets.entry(pane_id).or_insert(Bucket {
            tokens: BUCKET_CAPACITY,
            at: now,
        });
        let elapsed = now.saturating_duration_since(bucket.at).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * BUCKET_REFILL_PER_SEC).min(BUCKET_CAPACITY);
        bucket.at = now;
        if bucket.tokens < 1.0 {
            return false;
        }
        bucket.tokens -= 1.0;
        true
    }
}

#[derive(Default)]
pub struct HookState {
    pub broker: DecisionBroker,
    limiter: Mutex<HookLimiter>,
}

fn droppable(kind: HookKind) -> bool {
    matches!(
        kind,
        HookKind::ToolStart
            | HookKind::ToolEnd
            | HookKind::SubagentStart
            | HookKind::SubagentStop
            | HookKind::Notification
    )
}

const INFORMATIONAL_NOTIFICATIONS: &[&str] = &[
    "auth_success",
    "elicitation_complete",
    "elicitation_response",
    "agent_completed",
    "quota_auto_resume_fired",
    "quota_auto_resume_stale",
    "quota_auto_resume_disabled",
    "plugin_notification",
];

/// What a hook means for the legacy working/attention/finished signals.
pub fn intent_for(facts: &HookFacts) -> HookIntent {
    match facts.kind {
        HookKind::SessionStart => HookIntent::Start,
        HookKind::Prompt => HookIntent::Working,
        HookKind::ToolStart
        | HookKind::ToolEnd
        | HookKind::SubagentStart
        | HookKind::SubagentStop => HookIntent::Activity,
        HookKind::PermissionRequest | HookKind::StopFailure => HookIntent::Attention,
        HookKind::Notification => {
            let informational = facts
                .notification_type
                .as_deref()
                .is_some_and(|kind| INFORMATIONAL_NOTIFICATIONS.contains(&kind));
            if informational {
                HookIntent::Quiet
            } else {
                HookIntent::Attention
            }
        }
        HookKind::Stop | HookKind::Interrupt => HookIntent::Finished,
        HookKind::SessionEnd | HookKind::PermissionResolved => HookIntent::Quiet,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn peer_closed(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return true;
    }
    let mut byte = [0_u8; 1];
    let closed = match stream.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(error) => !matches!(
            error.kind(),
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
        ),
    };
    let _ = stream.set_nonblocking(false);
    closed
}

/// Tells the CLI the request is waiting for the UI, so it can tell a slow
/// decision from an endpoint that never answers.
fn write_held(stream: &TcpStream, request: &ControlRequest) -> std::io::Result<()> {
    let held = ControlResponse::success(
        request.id.clone(),
        json!(HookResult {
            accepted: true,
            held: true,
            decision: None,
        }),
    );
    let mut bytes = serde_json::to_vec(&held).map_err(std::io::Error::other)?;
    bytes.push(b'\n');
    let mut writer = stream;
    writer.write_all(&bytes)?;
    writer.flush()
}

fn reject(request: &ControlRequest, code: &str, message: &str) -> ControlResponse {
    ControlResponse::failure(request.id.clone(), code, message)
}

fn accepted(request: &ControlRequest, decision: Option<HookDecision>) -> ControlResponse {
    let result = HookResult {
        accepted: true,
        decision,
        ..HookResult::default()
    };
    ControlResponse::success(request.id.clone(), json!(result))
}

/// Handles one authenticated `hook` request. May block for a decision.
pub fn handle_bound(
    stream: &TcpStream,
    request: &ControlRequest,
    state: &HookState,
    host: &dyn AgentHost,
    expected_pty: u32,
) -> ControlResponse {
    handle_impl(stream, request, state, host, Some(expected_pty))
}

#[cfg(test)]
pub fn handle(
    stream: &TcpStream,
    request: &ControlRequest,
    state: &HookState,
    host: &dyn AgentHost,
) -> ControlResponse {
    handle_impl(stream, request, state, host, None)
}

fn handle_impl(
    stream: &TcpStream,
    request: &ControlRequest,
    state: &HookState,
    host: &dyn AgentHost,
    expected_pty: Option<u32>,
) -> ControlResponse {
    let params: HookParams = match serde_json::from_value(request.params.clone()) {
        Ok(params) => params,
        Err(error) => {
            return reject(
                request,
                "invalid_params",
                &format!("invalid hook parameters: {error}"),
            );
        }
    };
    let Some(agent) = AgentName::parse(&params.agent) else {
        return reject(request, "invalid_params", "unknown agent");
    };
    let Some(pane_id) = request.caller.pane_id else {
        return reject(request, "unknown_pane", "hook requires a Terax pane");
    };
    let Some(target) = host.pane(pane_id) else {
        return reject(request, "unknown_pane", "pane has no live terminal");
    };
    if expected_pty.is_some_and(|id| id != target.pty_id) {
        return reject(
            request,
            "unauthorized",
            "pane credential generation expired",
        );
    }
    let mut facts = match normalize(agent, &params.event, &params.payload) {
        Ok(facts) => facts,
        Err(NormalizeError::UnsupportedEvent) => {
            return ControlResponse::success(
                request.id.clone(),
                json!(HookResult {
                    accepted: false,
                    ..HookResult::default()
                }),
            );
        }
    };
    if droppable(facts.kind) {
        let allowed = state
            .limiter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .allow(pane_id, Instant::now());
        if !allowed {
            return ControlResponse::success(
                request.id.clone(),
                json!(HookResult {
                    accepted: false,
                    ..HookResult::default()
                }),
            );
        }
    }

    let intent = intent_for(&facts);
    let transitions = target.link.apply_hook(agent.as_str(), intent);

    let wait = params
        .wait_secs
        .filter(|_| facts.decision_capable && state.broker.ui_ready(&target.owner))
        .map(|secs| Duration::from_secs(u64::from(secs.min(MAX_DECISION_SECS))));
    let pending = wait.and_then(|wait| match state.broker.register(pane_id, &target.owner) {
        Ok((id, receiver)) => Some((wait, id, receiver)),
        Err(_) => None,
    });
    if let Some((_, id, _)) = &pending {
        if let Some(permission) = facts.permission.as_mut() {
            permission.request_id = Some(id.clone());
        }
    }
    let event = |facts: HookFacts| AgentEvent {
        pane_id,
        pty_id: target.pty_id,
        agent,
        facts,
        at: now_ms(),
    };
    let preview = facts.permission.clone();
    host.emit_event(&target.owner, &event(facts));
    for transition in transitions {
        host.emit_signal(transition.into_signal(target.pty_id));
    }

    let Some((wait, id, receiver)) = pending else {
        return accepted(request, None);
    };
    let verdict = if write_held(stream, request).is_err() {
        Verdict::Cancelled(Cancel::AgentGone)
    } else {
        await_decision(&receiver, wait, DECISION_POLL, || {
            if !state.broker.ui_ready(&target.owner) {
                Some(Cancel::UiGone)
            } else if host
                .pane(pane_id)
                .is_none_or(|live| live.pty_id != target.pty_id)
            {
                Some(Cancel::PaneClosed)
            } else if peer_closed(stream) {
                Some(Cancel::AgentGone)
            } else {
                None
            }
        })
    };
    state.broker.discard(&id);

    let (decision, outcome) = match verdict {
        Verdict::Decided(decision) => {
            let outcome = match &decision {
                HookDecision::Allow { .. } => "allow",
                HookDecision::Deny { .. } => "deny",
                HookDecision::Ask => "ask",
            };
            (decision, outcome)
        }
        Verdict::Cancelled(cancel) => (HookDecision::Ask, cancel.outcome()),
    };
    let mut resolved = HookFacts::new(HookKind::PermissionResolved);
    resolved.session_id = None;
    resolved.permission = preview.map(|mut permission| {
        permission.request_id = Some(id);
        permission.suggestions.clear();
        permission.outcome = Some(outcome.to_string());
        permission
    });
    host.emit_event(&target.owner, &event(resolved));
    accepted(request, Some(decision))
}

#[tauri::command]
pub fn agent_decisions_ready(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::modules::control::ControlState>,
    ready: bool,
) {
    state
        .hooks()
        .broker
        .set_window_ready(webview.label(), ready);
}

/// Answers a pending permission request. False when it already ended.
#[tauri::command]
pub fn agent_decision_respond(
    state: tauri::State<'_, crate::modules::control::ControlState>,
    request_id: String,
    decision: HookDecision,
) -> bool {
    state.hooks().broker.resolve(&request_id, decision)
}

#[cfg(test)]
pub(crate) mod test_host {
    use super::*;
    use crate::modules::pty::agent_detect::AgentLink;
    use std::sync::Arc;

    pub(crate) struct FakeHost {
        pub(crate) live: Mutex<Option<PaneTarget>>,
        pub(crate) events: Mutex<Vec<AgentEvent>>,
        pub(crate) signals: Mutex<Vec<String>>,
    }

    impl FakeHost {
        pub(crate) fn new(pane_open: bool) -> Arc<Self> {
            Arc::new(Self {
                live: Mutex::new(pane_open.then(|| PaneTarget {
                    pty_id: 9,
                    owner: Arc::from("main"),
                    link: AgentLink::new(),
                })),
                events: Mutex::new(Vec::new()),
                signals: Mutex::new(Vec::new()),
            })
        }

        pub(crate) fn kinds(&self) -> Vec<HookKind> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .map(|e| e.facts.kind)
                .collect()
        }
    }

    impl AgentHost for FakeHost {
        fn pane(&self, pane_id: u32) -> Option<PaneTarget> {
            (pane_id == 3)
                .then(|| self.live.lock().unwrap().clone())
                .flatten()
        }

        fn emit_event(&self, _: &str, event: &AgentEvent) {
            self.events.lock().unwrap().push(event.clone());
        }

        fn emit_signal(&self, signal: AgentSignal) {
            self.signals.lock().unwrap().push(format!(
                "{}:{}",
                signal.kind,
                signal.agent.unwrap_or_default()
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;
    use terax_control_protocol::{CallerContext, PROTOCOL_VERSION};

    use super::test_host::FakeHost;

    fn request(
        agent: &str,
        event: &str,
        payload: Value,
        wait: Option<u32>,
        pane: Option<u32>,
    ) -> ControlRequest {
        ControlRequest {
            protocol: PROTOCOL_VERSION,
            id: "req-1".into(),
            token: String::new(),
            method: "hook".into(),
            params: json!(HookParams {
                agent: agent.into(),
                event: event.into(),
                payload,
                wait_secs: wait,
            }),
            caller: CallerContext { pane_id: pane },
        }
    }

    fn socket_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (server, _) = listener.accept().unwrap();
        (server, client)
    }

    fn result(response: &ControlResponse) -> HookResult {
        assert!(response.ok, "{:?}", response.error);
        serde_json::from_value(response.result.clone().unwrap()).unwrap()
    }

    #[test]
    fn observed_hooks_emit_one_event_and_the_matching_legacy_signals() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        let prompt = request(
            "claude",
            "UserPromptSubmit",
            json!({ "session_id": "s", "prompt": "go" }),
            None,
            Some(3),
        );
        assert_eq!(
            result(&handle(&server, &prompt, &state, host.as_ref())),
            HookResult {
                accepted: true,
                decision: None,
                held: false
            }
        );
        let stop = request(
            "claude",
            "Stop",
            json!({ "last_assistant_message": "done" }),
            None,
            Some(3),
        );
        handle(&server, &stop, &state, host.as_ref());

        assert_eq!(host.kinds(), vec![HookKind::Prompt, HookKind::Stop]);
        let events = host.events.lock().unwrap();
        assert_eq!((events[0].pane_id, events[0].pty_id), (3, 9));
        assert_eq!(events[0].facts.session_id.as_deref(), Some("s"));
        assert_eq!(events[1].facts.message.as_deref(), Some("done"));
        assert_eq!(
            *host.signals.lock().unwrap(),
            vec!["started:claude", "finished:"]
        );
    }

    #[test]
    fn requests_are_rejected_before_any_side_effect() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        let code = |request: ControlRequest| {
            handle(&server, &request, &state, host.as_ref())
                .error
                .unwrap()
                .code
        };
        assert_eq!(
            code(request("claude", "Stop", json!({}), None, None)),
            "unknown_pane"
        );
        assert_eq!(
            code(request("claude", "Stop", json!({}), None, Some(77))),
            "unknown_pane"
        );
        assert_eq!(
            code(request("nobody", "Stop", json!({}), None, Some(3))),
            "invalid_params"
        );
        let mut malformed = request("claude", "Stop", json!({}), None, Some(3));
        malformed.params = json!({ "agent": 5 });
        assert_eq!(code(malformed), "invalid_params");
        assert!(host.events.lock().unwrap().is_empty());
        assert!(host.signals.lock().unwrap().is_empty());

        *host.live.lock().unwrap() = None;
        assert_eq!(
            code(request("claude", "Stop", json!({}), None, Some(3))),
            "unknown_pane"
        );
    }

    #[test]
    fn unsupported_events_are_accepted_without_effect() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        let response = handle(
            &server,
            &request("claude", "PreCompact", json!({}), None, Some(3)),
            &state,
            host.as_ref(),
        );
        assert!(!result(&response).accepted);
        assert!(host.events.lock().unwrap().is_empty());
    }

    #[test]
    fn late_tool_and_session_end_hooks_never_revive_an_exited_agent() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        for event in ["PostToolUse", "PreToolUse", "SessionEnd"] {
            handle(
                &server,
                &request(
                    "claude",
                    event,
                    json!({ "tool_name": "Bash" }),
                    None,
                    Some(3),
                ),
                &state,
                host.as_ref(),
            );
        }
        assert!(host.signals.lock().unwrap().is_empty());
        assert_eq!(host.events.lock().unwrap().len(), 3);
    }

    #[test]
    fn permission_without_a_ui_falls_through_immediately() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        let started = Instant::now();
        let response = handle(
            &server,
            &request(
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
                Some(600),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        assert_eq!(result(&response).decision, None);
        assert!(started.elapsed() < Duration::from_secs(1));
        let events = host.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].facts.permission.as_ref().unwrap().request_id,
            None
        );
        assert_eq!(
            *host.signals.lock().unwrap(),
            vec!["started:claude", "attention:"]
        );
    }

    #[test]
    fn the_ui_can_answer_a_pending_permission() {
        let host = FakeHost::new(true);
        let state = Arc::new(HookState::default());
        state.broker.set_window_ready("main", true);
        let (server, _client) = socket_pair();

        let answering = {
            let host = host.clone();
            let state = state.clone();
            thread::spawn(move || {
                let id = loop {
                    let id = host
                        .events
                        .lock()
                        .unwrap()
                        .iter()
                        .find_map(|e| e.facts.permission.as_ref()?.request_id.clone());
                    if let Some(id) = id {
                        break id;
                    }
                    thread::sleep(Duration::from_millis(5));
                };
                assert!(state.broker.resolve(
                    &id,
                    HookDecision::Deny {
                        message: Some("no".into()),
                        interrupt: false
                    }
                ));
                assert!(!state.broker.resolve(&id, HookDecision::Ask));
            })
        };
        let response = handle(
            &server,
            &request(
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash", "tool_input": { "command": "ls" } }),
                Some(30),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        answering.join().unwrap();
        assert_eq!(
            result(&response).decision,
            Some(HookDecision::Deny {
                message: Some("no".into()),
                interrupt: false
            })
        );
        assert_eq!(
            host.kinds(),
            vec![HookKind::PermissionRequest, HookKind::PermissionResolved]
        );
        let events = host.events.lock().unwrap();
        let resolved = events[1].facts.permission.as_ref().unwrap();
        assert_eq!(resolved.outcome.as_deref(), Some("deny"));
        assert_eq!(resolved.input_preview, "ls");
        assert_eq!(state.broker.len(), 0);
    }

    #[test]
    fn an_agent_that_goes_away_cancels_its_pending_permission() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        state.broker.set_window_ready("main", true);
        let (server, client) = socket_pair();
        let closer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            drop(client);
        });
        let response = handle(
            &server,
            &request(
                "codex",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
                Some(30),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        closer.join().unwrap();
        assert_eq!(result(&response).decision, Some(HookDecision::Ask));
        let events = host.events.lock().unwrap();
        assert_eq!(
            events[1]
                .facts
                .permission
                .as_ref()
                .unwrap()
                .outcome
                .as_deref(),
            Some("agent-gone")
        );
        assert_eq!(state.broker.len(), 0);
    }

    #[test]
    fn a_closed_pane_cancels_its_pending_permission() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        state.broker.set_window_ready("main", true);
        let (server, _client) = socket_pair();
        let closer = {
            let host = host.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                *host.live.lock().unwrap() = None;
            })
        };
        let response = handle(
            &server,
            &request(
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
                Some(30),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        closer.join().unwrap();
        assert_eq!(result(&response).decision, Some(HookDecision::Ask));
        let events = host.events.lock().unwrap();
        assert_eq!(
            events[1]
                .facts
                .permission
                .as_ref()
                .unwrap()
                .outcome
                .as_deref(),
            Some("pane-closed")
        );
    }

    #[test]
    fn the_ui_going_away_releases_waiting_agents() {
        let host = FakeHost::new(true);
        let state = Arc::new(HookState::default());
        state.broker.set_window_ready("main", true);
        let (server, _client) = socket_pair();
        let withdrawn = {
            let state = state.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                state.broker.set_window_ready("main", false);
            })
        };
        let response = handle(
            &server,
            &request(
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
                Some(30),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        withdrawn.join().unwrap();
        assert_eq!(result(&response).decision, Some(HookDecision::Ask));
    }

    #[test]
    fn only_decision_capable_events_wait() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        state.broker.set_window_ready("main", true);
        let (server, _client) = socket_pair();
        let started = Instant::now();
        for (agent, event) in [
            ("gemini", "Notification"),
            ("claude", "PreToolUse"),
            ("pi", "PermissionRequest"),
        ] {
            let payload = json!({ "tool_name": "Bash", "notification_type": "ToolPermission" });
            let response = handle(
                &server,
                &request(agent, event, payload, Some(30), Some(3)),
                &state,
                host.as_ref(),
            );
            assert_eq!(result(&response).decision, None, "{agent} {event}");
        }
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn the_broker_caps_pending_requests_globally_and_per_pane() {
        let broker = DecisionBroker::default();
        let mut held = Vec::new();
        for _ in 0..MAX_PENDING_PER_PANE {
            held.push(broker.register(1, "main").unwrap());
        }
        assert_eq!(broker.register(1, "main").unwrap_err(), Busy::Pane);
        for pane in 2..2 + (MAX_PENDING_DECISIONS - MAX_PENDING_PER_PANE) as u32 {
            held.push(broker.register(pane, "main").unwrap());
        }
        assert_eq!(broker.register(99, "main").unwrap_err(), Busy::Global);
        let (id, _) = held.pop().unwrap();
        broker.discard(&id);
        assert!(broker.register(99, "main").is_ok());
    }

    #[test]
    fn request_ids_are_unguessable_and_unique() {
        let broker = DecisionBroker::default();
        let (first, _a) = broker.register(1, "main").unwrap();
        let (second, _b) = broker.register(1, "main").unwrap();
        assert_ne!(first, second);
        assert_eq!(first.len(), 34);
        assert!(first.starts_with("d-"));
        assert!(first[2..].bytes().all(|b| b.is_ascii_hexdigit()));
    }

    #[test]
    fn waiting_ends_on_answer_cancel_or_timeout() {
        let (sender, receiver) = mpsc::sync_channel(1);
        sender.send(HookDecision::Ask).unwrap();
        assert_eq!(
            await_decision(
                &receiver,
                Duration::from_secs(5),
                Duration::from_millis(5),
                || None
            ),
            Verdict::Decided(HookDecision::Ask)
        );
        let (_sender, receiver) = mpsc::sync_channel::<HookDecision>(1);
        assert_eq!(
            await_decision(
                &receiver,
                Duration::from_millis(30),
                Duration::from_millis(5),
                || None
            ),
            Verdict::Cancelled(Cancel::Timeout)
        );
        let mut ticks = 0;
        assert_eq!(
            await_decision(
                &receiver,
                Duration::from_secs(5),
                Duration::from_millis(5),
                || {
                    ticks += 1;
                    (ticks == 3).then_some(Cancel::PaneClosed)
                }
            ),
            Verdict::Cancelled(Cancel::PaneClosed)
        );
        drop(_sender);
        assert_eq!(
            await_decision(
                &receiver,
                Duration::from_secs(5),
                Duration::from_millis(5),
                || None
            ),
            Verdict::Cancelled(Cancel::UiGone)
        );
    }

    #[test]
    fn the_limiter_throttles_floods_and_recovers() {
        let mut limiter = HookLimiter::default();
        let start = Instant::now();
        let allowed = (0..500).filter(|_| limiter.allow(1, start)).count();
        assert_eq!(allowed, BUCKET_CAPACITY as usize);
        assert!(limiter.allow(2, start));
        assert!(!limiter.allow(1, start));
        assert!(limiter.allow(1, start + Duration::from_secs(1)));
    }

    #[test]
    fn a_flood_of_tool_events_is_dropped_but_turn_boundaries_are_not() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        let mut dropped = 0;
        for _ in 0..300 {
            let response = handle(
                &server,
                &request(
                    "claude",
                    "PostToolUse",
                    json!({ "tool_name": "Bash" }),
                    None,
                    Some(3),
                ),
                &state,
                host.as_ref(),
            );
            if !result(&response).accepted {
                dropped += 1;
            }
        }
        assert!(dropped >= 150);
        let stop = handle(
            &server,
            &request("claude", "Stop", json!({}), None, Some(3)),
            &state,
            host.as_ref(),
        );
        assert!(result(&stop).accepted);
    }

    #[test]
    fn hook_kinds_map_to_legacy_intents() {
        let facts = |kind: HookKind, notification: Option<&str>| {
            let mut facts = HookFacts::new(kind);
            facts.notification_type = notification.map(str::to_string);
            facts
        };
        let table = [
            (HookKind::SessionStart, None, HookIntent::Start),
            (HookKind::Prompt, None, HookIntent::Working),
            (HookKind::ToolStart, None, HookIntent::Activity),
            (HookKind::ToolEnd, None, HookIntent::Activity),
            (HookKind::SubagentStart, None, HookIntent::Activity),
            (HookKind::SubagentStop, None, HookIntent::Activity),
            (HookKind::PermissionRequest, None, HookIntent::Attention),
            (HookKind::StopFailure, None, HookIntent::Attention),
            (HookKind::Notification, None, HookIntent::Attention),
            (
                HookKind::Notification,
                Some("permission_prompt"),
                HookIntent::Attention,
            ),
            (
                HookKind::Notification,
                Some("idle_prompt"),
                HookIntent::Attention,
            ),
            (
                HookKind::Notification,
                Some("auth_success"),
                HookIntent::Quiet,
            ),
            (
                HookKind::Notification,
                Some("agent_completed"),
                HookIntent::Quiet,
            ),
            (HookKind::Stop, None, HookIntent::Finished),
            (HookKind::Interrupt, None, HookIntent::Finished),
            (HookKind::SessionEnd, None, HookIntent::Quiet),
        ];
        for (kind, notification, expected) in table {
            assert_eq!(
                intent_for(&facts(kind, notification)),
                expected,
                "{kind:?} {notification:?}"
            );
        }
    }

    #[test]
    fn peer_close_is_detected_without_consuming_data() {
        let (mut server, mut client) = socket_pair();
        assert!(!peer_closed(&server));
        client.write_all(b"x").unwrap();
        thread::sleep(Duration::from_millis(50));
        assert!(!peer_closed(&server));
        let mut byte = [0u8; 1];
        server.read_exact(&mut byte).unwrap();
        assert_eq!(&byte, b"x");
        drop(client);
        thread::sleep(Duration::from_millis(50));
        assert!(peer_closed(&server));
    }

    #[test]
    fn a_held_notice_precedes_the_final_decision() {
        let host = FakeHost::new(true);
        let state = Arc::new(HookState::default());
        state.broker.set_window_ready("main", true);
        let (server, client) = socket_pair();
        let serving = {
            let (host, state) = (host.clone(), state.clone());
            thread::spawn(move || {
                handle(
                    &server,
                    &request(
                        "claude",
                        "PermissionRequest",
                        json!({ "tool_name": "Bash" }),
                        Some(30),
                        Some(3),
                    ),
                    &state,
                    host.as_ref(),
                )
            })
        };

        let mut line = String::new();
        BufReader::new(client).read_line(&mut line).unwrap();
        let interim: ControlResponse = serde_json::from_str(&line).unwrap();
        assert_eq!(interim.id, "req-1");
        assert_eq!(
            result(&interim),
            HookResult {
                accepted: true,
                held: true,
                decision: None
            }
        );

        let id = loop {
            let id = host
                .events
                .lock()
                .unwrap()
                .iter()
                .find_map(|e| e.facts.permission.as_ref()?.request_id.clone());
            if let Some(id) = id {
                break id;
            }
            thread::sleep(Duration::from_millis(5));
        };
        assert!(state
            .broker
            .resolve(&id, HookDecision::Allow { remember: None }));
        let last = serving.join().unwrap();
        assert_eq!(
            result(&last),
            HookResult {
                accepted: true,
                held: false,
                decision: Some(HookDecision::Allow { remember: None })
            }
        );
    }

    #[test]
    fn requests_that_do_not_wait_send_a_single_final_answer() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, mut client) = socket_pair();
        let response = handle(
            &server,
            &request("claude", "Stop", json!({}), None, Some(3)),
            &state,
            host.as_ref(),
        );
        assert!(!result(&response).held);
        drop(server);
        let mut written = Vec::new();
        client.read_to_end(&mut written).unwrap();
        assert!(written.is_empty());
    }

    #[test]
    fn a_late_tool_hook_never_hides_a_pending_permission() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        let (server, _client) = socket_pair();
        for (event, payload) in [
            ("UserPromptSubmit", json!({ "prompt": "go" })),
            (
                "PermissionRequest",
                json!({ "tool_name": "Bash", "tool_input": { "command": "ls" } }),
            ),
            // Background hooks lose the race against the synchronous one.
            (
                "PreToolUse",
                json!({ "tool_name": "Bash", "tool_input": { "command": "ls" } }),
            ),
            (
                "PostToolUse",
                json!({ "tool_name": "Read", "tool_input": { "file_path": "/a" } }),
            ),
        ] {
            handle(
                &server,
                &request("claude", event, payload, None, Some(3)),
                &state,
                host.as_ref(),
            );
        }
        assert_eq!(
            *host.signals.lock().unwrap(),
            vec!["started:claude", "attention:"]
        );
        assert_eq!(host.events.lock().unwrap().len(), 4);
    }

    #[test]
    fn readiness_is_tracked_per_window() {
        let broker = DecisionBroker::default();
        assert!(!broker.ui_ready("main"));
        broker.set_window_ready("main", true);
        assert!(broker.ui_ready("main"));
        assert!(!broker.ui_ready("settings"));

        let (_main_id, main_receiver) = broker.register(1, "main").unwrap();
        let (_other_id, other_receiver) = broker.register(2, "settings").unwrap();
        // A reload of one window releases only the agents waiting on it.
        broker.set_window_ready("settings", false);
        assert!(matches!(
            other_receiver.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
        assert!(matches!(
            main_receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert!(broker.ui_ready("main"));
        assert_eq!(broker.len(), 1);

        broker.reset_all();
        assert!(!broker.ui_ready("main"));
        assert_eq!(broker.len(), 0);
    }

    #[test]
    fn a_window_that_is_not_ready_does_not_hold_agents_of_other_windows() {
        let host = FakeHost::new(true);
        let state = HookState::default();
        // Another window announced decisions; the pane's own window did not.
        state.broker.set_window_ready("settings", true);
        let (server, _client) = socket_pair();
        let started = Instant::now();
        let response = handle(
            &server,
            &request(
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
                Some(30),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        assert_eq!(result(&response).decision, None);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_page_reload_releases_a_waiting_agent() {
        let host = FakeHost::new(true);
        let state = Arc::new(HookState::default());
        state.broker.set_window_ready("main", true);
        let (server, _client) = socket_pair();
        let reload = {
            let state = state.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(300));
                state.broker.set_window_ready("main", false);
            })
        };
        let response = handle(
            &server,
            &request(
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
                Some(30),
                Some(3),
            ),
            &state,
            host.as_ref(),
        );
        reload.join().unwrap();
        assert_eq!(result(&response).decision, Some(HookDecision::Ask));
    }
}
