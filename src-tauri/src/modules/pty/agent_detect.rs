use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use memchr::memchr2;
use terax_control_protocol::hook::clean_text;

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

/// Generic attention (OSC 9, or an OSC 777 that is not ours) repeats while an
/// agent waits: once the status is already `Waiting`, further requests inside
/// this window are the same moment of attention and are not re-emitted.
const ATTENTION_REPEAT: Duration = Duration::from_secs(3);

/// Terminal notifications from any program are limited to a burst per window,
/// and an identical one right after another is the same notification.
const NOTIFY_WINDOW: Duration = Duration::from_secs(10);
const NOTIFY_BURST: u8 = 5;
const NOTIFY_DUPLICATE: Duration = Duration::from_secs(1);
const MAX_NOTIFY_TITLE: usize = 256;
const MAX_NOTIFY_BODY: usize = 1024;

const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "gemini", "pi", "opencode", "grok"];

/// Extensions a launcher shim or native binary carries on Windows.
const LAUNCHER_EXTENSIONS: &[&str] = &[".exe", ".cmd", ".bat", ".ps1", ".com"];

// OSC 777 marker older agent hooks emit. Legacy 3-field `notify;Terax;<event>`
// (Claude) or 4-field `notify;Terax;<agent>;<event>` (Codex/Gemini/Pi).
const TERAX_MARKER: &[u8] = b"notify;Terax;";


#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started { agent: String },
    Working,
    Attention,
    Finished,
    Exited,
}

#[derive(Clone, serde::Serialize)]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        match self {
            Transition::Started { agent } => {
                AgentSignal { id, kind: "started", agent: Some(agent) }
            }
            Transition::Working => AgentSignal { id, kind: "working", agent: None },
            Transition::Attention => AgentSignal { id, kind: "attention", agent: None },
            Transition::Finished => AgentSignal { id, kind: "finished", agent: None },
            Transition::Exited => AgentSignal { id, kind: "exited", agent: None },
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationKind {
    Bell,
    Osc9,
    Osc99,
    Osc777,
}

/// A notification a program asked the terminal to show (bell, OSC 9, OSC 99 or
/// OSC 777), from any program rather than a known agent.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TerminalNotification {
    pub kind: NotificationKind,
    pub title: Option<String>,
    pub body: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalNotificationEvent {
    pub pty_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub body: String,
    pub kind: NotificationKind,
}

impl TerminalNotification {
    pub fn into_event(self, pty_id: u32) -> TerminalNotificationEvent {
        TerminalNotificationEvent {
            pty_id,
            title: self.title,
            body: self.body,
            kind: self.kind,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Signal {
    Transition(Transition),
    Notification(TerminalNotification),
}

/// What a structured agent hook means for the legacy state machine.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HookIntent {
    Start,
    Working,
    Activity,
    Attention,
    Finished,
    Quiet,
}

/// State shared between a PTY's reader thread (OSC detection) and the control
/// server (structured hooks), so the two sources agree on one agent per PTY.
#[derive(Default)]
pub struct AgentLink {
    armed: AtomicBool,
    hooked: AtomicBool,
    waiting: AtomicBool,
}

impl AgentLink {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn is_armed(&self) -> bool {
        self.armed.load(Ordering::Acquire)
    }

    /// True once a structured hook has reported for the running agent; OSC
    /// state hints are redundant from then on.
    pub fn is_hooked(&self) -> bool {
        self.hooked.load(Ordering::Acquire)
    }

    fn arm(&self) -> bool {
        let armed = self
            .armed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok();
        if armed {
            self.hooked.store(false, Ordering::Release);
            self.waiting.store(false, Ordering::Release);
        }
        armed
    }

    fn disarm(&self) -> bool {
        let was_armed = self.armed.swap(false, Ordering::AcqRel);
        self.hooked.store(false, Ordering::Release);
        self.waiting.store(false, Ordering::Release);
        was_armed
    }

    /// Records a structured hook and returns the legacy transitions it implies.
    pub fn apply_hook(&self, agent: &str, intent: HookIntent) -> Vec<Transition> {
        let mut out = Vec::new();
        // Tool and notification hooks can trail the process exit; only hooks
        // that mark real agent state may start an agent.
        let starts = matches!(
            intent,
            HookIntent::Start | HookIntent::Working | HookIntent::Attention | HookIntent::Finished
        );
        if !starts && !self.is_armed() {
            return out;
        }
        if self.arm() {
            out.push(Transition::Started { agent: agent.to_string() });
        }
        self.hooked.store(true, Ordering::Release);
        match intent {
            HookIntent::Quiet | HookIntent::Start => {}
            HookIntent::Working | HookIntent::Activity => {
                if self.waiting.swap(false, Ordering::AcqRel) {
                    out.push(Transition::Working);
                }
            }
            HookIntent::Attention => {
                if !self.waiting.swap(true, Ordering::AcqRel) {
                    out.push(Transition::Attention);
                }
            }
            HookIntent::Finished => {
                self.waiting.store(true, Ordering::Release);
                out.push(Transition::Finished);
            }
        }
        out
    }
}

struct NotificationLimiter {
    window_start: Option<Instant>,
    count: u8,
    last: Option<(Instant, TerminalNotification)>,
}

impl NotificationLimiter {
    fn new() -> Self {
        Self { window_start: None, count: 0, last: None }
    }

    fn allow(&mut self, now: Instant, notification: &TerminalNotification) -> bool {
        if let Some((at, previous)) = &self.last {
            if previous == notification && now.saturating_duration_since(*at) < NOTIFY_DUPLICATE {
                return false;
            }
        }
        let fresh = self
            .window_start
            .is_none_or(|start| now.saturating_duration_since(start) >= NOTIFY_WINDOW);
        if fresh {
            self.window_start = Some(now);
            self.count = 0;
        }
        if self.count >= NOTIFY_BURST {
            return false;
        }
        self.count += 1;
        self.last = Some((now, notification.clone()));
        true
    }
}

#[derive(Default)]
struct KittyPending {
    id: Option<String>,
    title: String,
    body: String,
}

pub struct AgentDetector {
    agents: Vec<String>,
    state: State,
    osc: Vec<u8>,
    link: Arc<AgentLink>,
    status: Status,
    /// When generic attention was last emitted; consulted only while armed.
    last_attention: Option<Instant>,
    limiter: NotificationLimiter,
    kitty: KittyPending,
    clock: fn() -> Instant,
}

impl AgentDetector {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_link(AgentLink::new())
    }

    pub fn with_link(link: Arc<AgentLink>) -> Self {
        Self::with_clock(
            DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect(),
            link,
            Instant::now,
        )
    }

    fn with_clock(agents: Vec<String>, link: Arc<AgentLink>, clock: fn() -> Instant) -> Self {
        Self {
            agents,
            state: State::Ground,
            osc: Vec::new(),
            link,
            status: Status::Working,
            last_attention: None,
            limiter: NotificationLimiter::new(),
            kitty: KittyPending::default(),
            clock,
        }
    }

    /// Feed a chunk of raw PTY output. Agent transitions come only from OSC
    /// sequences (`133` prompt boundaries, hook markers, notifications), never
    /// from raw output, so a TUI agent that repaints continuously never flaps
    /// working/waiting. A bare BEL is reported as a terminal notification.
    pub fn process<F: FnMut(Signal)>(&mut self, input: &[u8], mut emit: F) {
        let mut i = 0;
        while i < input.len() {
            match self.state {
                State::Ground => {
                    // Output without an escape or bell is never interesting.
                    let Some(at) = memchr2(ESC, BEL, &input[i..]) else {
                        return;
                    };
                    i += at + 1;
                    if input[i - 1] == BEL {
                        self.bell(&mut emit);
                    } else {
                        self.state = State::Esc;
                    }
                }
                State::Esc => {
                    let b = input[i];
                    i += 1;
                    match b {
                        OSC_INTRO => {
                            self.state = State::Osc;
                            self.osc.clear();
                        }
                        ESC => {}
                        _ => self.state = State::Ground,
                    }
                }
                State::Osc => {
                    // The body runs to BEL or ESC; copy it as one run.
                    let rest = &input[i..];
                    let end = memchr2(BEL, ESC, rest).unwrap_or(rest.len());
                    let room = OSC_MAX - self.osc.len();
                    if end > room {
                        // Oversized: drop it and resume plain scanning after
                        // the byte that overflowed.
                        self.osc.clear();
                        self.state = State::Ground;
                        i += room + 1;
                        continue;
                    }
                    self.osc.extend_from_slice(&rest[..end]);
                    i += end;
                    match rest.get(end) {
                        Some(&BEL) => {
                            i += 1;
                            self.finish_osc(&mut emit);
                            self.state = State::Ground;
                        }
                        Some(_) => {
                            i += 1;
                            self.state = State::OscEsc;
                        }
                        None => {}
                    }
                }
                State::OscEsc => {
                    let b = input[i];
                    i += 1;
                    match b {
                        ST_FINAL => {
                            self.finish_osc(&mut emit);
                            self.state = State::Ground;
                        }
                        ESC => {}
                        _ => {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                }
            }
        }
    }

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Signal)>(&mut self, mut emit: F) {
        if self.disarm() {
            emit(Signal::Transition(Transition::Exited));
        }
    }

    fn disarm(&mut self) -> bool {
        self.status = Status::Working;
        self.last_attention = None;
        self.link.disarm()
    }

    fn note_attention(&mut self) {
        self.last_attention = Some((self.clock)());
    }

    fn finish_osc<F: FnMut(Signal)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            // OSC 9;4 is taskbar progress and 9;<n>; are ConEmu commands.
            b"9" if !is_conemu_command(pt) => {
                let notification = notification(NotificationKind::Osc9, None, pt);
                self.generic_notification(notification, emit);
            }
            b"99" => {
                let notification = self.handle_osc99(pt);
                self.generic_notification(notification, emit);
            }
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Signal)>(&mut self, pt: &[u8], emit: &mut F) {
        if let Some(tail) = pt.strip_prefix(TERAX_MARKER) {
            // PTY output is untrusted: only self-arm for known agents.
            let (agent, event) = match tail.iter().position(|&c| c == b';') {
                Some(i) => {
                    let Ok(name) = std::str::from_utf8(&tail[..i]) else {
                        return;
                    };
                    if !self.agents.iter().any(|a| a == name) {
                        return;
                    }
                    (name, &tail[i + 1..])
                }
                None => ("claude", tail),
            };
            if self.link.is_hooked() {
                return;
            }
            // Self-arms when no shell preexec fired (bash, Windows, tmux).
            match event {
                b"working" => {
                    self.ensure_armed(agent, emit);
                    self.set_working(emit);
                }
                b"attention" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    self.note_attention();
                    emit(Signal::Transition(Transition::Attention));
                }
                b"finished" => {
                    self.ensure_armed(agent, emit);
                    self.status = Status::Waiting;
                    self.note_attention();
                    emit(Signal::Transition(Transition::Finished));
                }
                _ => {}
            }
            return;
        }
        let notification = pt.strip_prefix(b"notify;").and_then(|rest| {
            let (title, body) = match rest.iter().position(|&c| c == b';') {
                Some(i) => (&rest[..i], &rest[i + 1..]),
                None => (&rest[0..0], rest),
            };
            notification(NotificationKind::Osc777, Some(title), body)
        });
        self.generic_notification(notification, emit);
    }

    fn handle_osc133<F: FnMut(Signal)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.link.is_armed() {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                if let Some(agent) = self.match_agent(cmd) {
                    self.ensure_armed(&agent, emit);
                }
            }
            Some(b'D') if self.link.is_armed() => {
                self.disarm();
                emit(Signal::Transition(Transition::Exited));
            }
            _ => {}
        }
    }

    fn ensure_armed<F: FnMut(Signal)>(&mut self, agent: &str, emit: &mut F) {
        if self.link.arm() {
            self.status = Status::Working;
            self.last_attention = None;
            emit(Signal::Transition(Transition::Started { agent: agent.to_string() }));
        }
    }

    fn set_working<F: FnMut(Signal)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Signal::Transition(Transition::Working));
        }
    }

    /// An OSC notification means attention while an agent runs and a plain
    /// terminal notification otherwise. A hooked agent already reports its own
    /// state, so its OSC notifications are redundant.
    fn generic_notification<F: FnMut(Signal)>(
        &mut self,
        notification: Option<TerminalNotification>,
        emit: &mut F,
    ) {
        if self.link.is_armed() {
            self.generic_attention(emit);
        } else if let Some(notification) = notification {
            self.notify(notification, emit);
        }
    }

    fn bell<F: FnMut(Signal)>(&mut self, emit: &mut F) {
        if self.link.is_hooked() {
            return;
        }
        let bell = TerminalNotification {
            kind: NotificationKind::Bell,
            title: None,
            body: String::new(),
        };
        self.notify(bell, emit);
    }

    fn notify<F: FnMut(Signal)>(&mut self, notification: TerminalNotification, emit: &mut F) {
        if self.limiter.allow((self.clock)(), &notification) {
            emit(Signal::Notification(notification));
        }
    }

    /// Emits on the transition into `Waiting`. While already waiting, a repeat
    /// is the same moment of attention unless enough time has passed for it to
    /// plausibly be the next turn (agents without hooks never report
    /// `working`, so the status alone cannot tell the two apart).
    fn generic_attention<F: FnMut(Signal)>(&mut self, emit: &mut F) {
        if !self.link.is_armed() || self.link.is_hooked() {
            return;
        }
        let now = (self.clock)();
        let repeat = self.status == Status::Waiting
            && self
                .last_attention
                .is_some_and(|last| now.saturating_duration_since(last) < ATTENTION_REPEAT);
        if repeat {
            return;
        }
        self.status = Status::Waiting;
        self.last_attention = Some(now);
        emit(Signal::Transition(Transition::Attention));
    }

    /// Kitty notification protocol: `99;<metadata>;<payload>`, possibly sent
    /// in chunks that share an `i=` id until a chunk with `d=1` (the default).
    fn handle_osc99(&mut self, pt: &[u8]) -> Option<TerminalNotification> {
        let (meta, payload) = match pt.iter().position(|&c| c == b';') {
            Some(i) => (&pt[..i], &pt[i + 1..]),
            None => (pt, &pt[0..0]),
        };
        let meta = std::str::from_utf8(meta).ok()?;
        let part = kitty_field(meta, "p").unwrap_or("title");
        if part != "title" && part != "body" {
            return None;
        }
        let id = kitty_field(meta, "i").map(str::to_string);
        let done = kitty_field(meta, "d") != Some("0");
        let bytes = if kitty_field(meta, "e") == Some("1") {
            decode_base64(payload)?
        } else {
            payload.to_vec()
        };
        let text = String::from_utf8_lossy(&bytes);
        if self.kitty.id != id {
            self.kitty = KittyPending { id, ..KittyPending::default() };
        }
        let target = if part == "body" {
            &mut self.kitty.body
        } else {
            &mut self.kitty.title
        };
        if target.len() < MAX_NOTIFY_BODY {
            target.push_str(&text);
        }
        if !done {
            return None;
        }
        let KittyPending { title, body, .. } = std::mem::take(&mut self.kitty);
        notification(NotificationKind::Osc99, Some(title.as_bytes()), body.as_bytes())
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            let token = token.trim_matches(['"', '\'']);
            if token.is_empty() || token.starts_with('-') {
                continue;
            }
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            let base = strip_launcher_extension(base).to_ascii_lowercase();
            if let Some(agent) = self.agents.iter().find(|a| {
                base.strip_prefix(a.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
            }) {
                return Some(agent.clone());
            }
        }
        None
    }
}

fn strip_launcher_extension(name: &str) -> &str {
    let lower = name.to_ascii_lowercase();
    for extension in LAUNCHER_EXTENSIONS {
        if lower.ends_with(extension) {
            return &name[..name.len() - extension.len()];
        }
    }
    name
}

fn is_conemu_command(pt: &[u8]) -> bool {
    let digits = pt.iter().take_while(|c| c.is_ascii_digit()).count();
    digits > 0 && (digits == pt.len() || pt[digits] == b';')
}

fn notification(
    kind: NotificationKind,
    title: Option<&[u8]>,
    body: &[u8],
) -> Option<TerminalNotification> {
    let text = |bytes: &[u8], max: usize| clean_text(&String::from_utf8_lossy(bytes), max);
    let title = title.and_then(|title| text(title, MAX_NOTIFY_TITLE));
    let body = text(body, MAX_NOTIFY_BODY);
    match (title, body) {
        (None, None) => None,
        (Some(only), None) => Some(TerminalNotification { kind, title: None, body: only }),
        (title, Some(body)) => Some(TerminalNotification { kind, title, body }),
    }
}

fn kitty_field<'a>(meta: &'a str, key: &str) -> Option<&'a str> {
    meta.split(':')
        .filter_map(|field| field.split_once('='))
        .find_map(|(name, value)| (name == key).then_some(value))
}

fn decode_base64(input: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut bits = 0u32;
    let mut count = 0u8;
    for &byte in input {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b' ' | b'\n' | b'\r' => continue,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(value);
        count += 1;
        if count == 4 {
            out.extend_from_slice(&[(bits >> 16) as u8, (bits >> 8) as u8, bits as u8]);
            bits = 0;
            count = 0;
        }
    }
    match count {
        0 => {}
        2 => out.push((bits >> 4) as u8),
        3 => out.extend_from_slice(&[(bits >> 10) as u8, (bits >> 2) as u8]),
        _ => return None,
    }
    Some(out)
}
#[cfg(test)]
mod tests {
    use super::*;

    fn run_all(d: &mut AgentDetector, input: &[u8]) -> Vec<Signal> {
        let mut out = Vec::new();
        d.process(input, |signal| out.push(signal));
        out
    }

    fn run(d: &mut AgentDetector, input: &[u8]) -> Vec<Transition> {
        run_all(d, input)
            .into_iter()
            .filter_map(|signal| match signal {
                Signal::Transition(transition) => Some(transition),
                Signal::Notification(_) => None,
            })
            .collect()
    }

    fn notifications(d: &mut AgentDetector, input: &[u8]) -> Vec<TerminalNotification> {
        run_all(d, input)
            .into_iter()
            .filter_map(|signal| match signal {
                Signal::Notification(notification) => Some(notification),
                Signal::Transition(_) => None,
            })
            .collect()
    }

    fn osc(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.extend_from_slice(&[ESC, ST_FINAL]);
        v
    }

    fn started(agent: &str) -> Transition {
        Transition::Started { agent: agent.into() }
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude -p hello")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_pi_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;pi")), vec![started("pi")]);
    }

    #[test]
    fn arms_on_opencode_and_grok_commands() {
        for agent in ["opencode", "grok"] {
            let mut d = AgentDetector::new();
            assert_eq!(
                run(&mut d, &osc(&format!("133;C;{agent}"))),
                vec![started(agent)]
            );
        }
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(run(&mut d2, &osc("133;C;npx claude")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_dash_suffixed_alias() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude-enigma")), vec![started("claude")]);
    }

    #[test]
    fn does_not_arm_on_other_commands() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("133;C;vim src/main.rs")).is_empty());
        assert!(run(&mut d, &osc("133;C;cat claude.txt")).is_empty());
        assert!(run(&mut d, &osc("133;C;claudexyz")).is_empty());
    }

    #[test]
    fn ignores_bell_and_plain_output() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert!(run(&mut d, &[BEL]).is_empty());
        assert!(run(&mut d, b"thinking...\x07more").is_empty());
    }

    #[test]
    fn terax_marker_drives_status() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("777;notify;Terax;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;working")), vec![Transition::Working]);
        assert!(run(&mut d, &osc("777;notify;Terax;working")).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Terax;finished")), vec![Transition::Finished]);
    }

    #[test]
    fn terax_marker_auto_arms_without_preexec() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![started("claude"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_self_arms_named_agent() {
        // Fresh arm already implies Working, so `working` emits only Started.
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("777;notify;Terax;codex;working")), vec![started("codex")]);
        let mut g = AgentDetector::new();
        assert_eq!(
            run(&mut g, &osc("777;notify;Terax;gemini;finished")),
            vec![started("gemini"), Transition::Finished]
        );
    }

    #[test]
    fn pi_marker_self_arms_and_drives_status() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;pi;working")),
            vec![started("pi")]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;pi;finished")),
            vec![Transition::Finished]
        );
    }

    #[test]
    fn four_field_marker_ignores_unknown_agent() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Terax;evil;attention")).is_empty());
        // A known agent in the same chunk still works.
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;codex;attention")),
            vec![started("codex"), Transition::Attention]
        );
    }

    #[test]
    fn four_field_marker_drives_status_after_preexec() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;gemini"));
        assert_eq!(run(&mut d, &osc("777;notify;Terax;gemini;attention")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;gemini;working")), vec![Transition::Working]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;gemini;finished")), vec![Transition::Finished]);
    }

    thread_local! {
        static NOW: std::cell::Cell<Option<Instant>> = const { std::cell::Cell::new(None) };
    }

    fn fake_now() -> Instant {
        NOW.with(|now| {
            let value = now.get().unwrap_or_else(Instant::now);
            now.set(Some(value));
            value
        })
    }

    fn advance(by: Duration) {
        NOW.with(|now| now.set(Some(fake_now() + by)));
    }

    fn timed() -> AgentDetector {
        AgentDetector::with_clock(
            DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect(),
            AgentLink::new(),
            fake_now,
        )
    }

    #[test]
    fn generic_osc777_and_osc9_attention_only_when_armed() {
        let mut d = timed();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        assert!(run(&mut d, &osc("9;needs you")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("777;notify;Codex;ready")), vec![Transition::Attention]);
        advance(ATTENTION_REPEAT);
        assert_eq!(run(&mut d, &osc("9;needs you")), vec![Transition::Attention]);
        assert!(run(&mut d, &osc("9;4;1;50")).is_empty());
    }

    #[test]
    fn repeated_generic_attention_is_one_transition_until_the_window_passes() {
        let mut d = timed();
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("9;turn complete")), vec![Transition::Attention]);
        // A TUI that rings OSC 9 on every redraw must not flood the frontend.
        for _ in 0..500 {
            advance(Duration::from_millis(5));
            assert!(run(&mut d, &osc("9;still waiting")).is_empty());
        }
        // The next turn of an agent without hooks arrives much later.
        advance(ATTENTION_REPEAT);
        assert_eq!(run(&mut d, &osc("9;turn complete")), vec![Transition::Attention]);
    }

    #[test]
    fn a_new_turn_after_working_is_a_fresh_transition() {
        let mut d = timed();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("9;done")), vec![Transition::Attention]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;working")), vec![Transition::Working]);
        assert_eq!(run(&mut d, &osc("9;done again")), vec![Transition::Attention]);
    }

    #[test]
    fn a_hook_marker_and_its_generic_twin_are_one_attention() {
        let mut d = timed();
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("777;notify;Terax;codex;finished")), vec![Transition::Finished]);
        assert!(run(&mut d, &osc("9;Agent turn complete")).is_empty());
        advance(ATTENTION_REPEAT);
        assert_eq!(run(&mut d, &osc("9;Agent turn complete")), vec![Transition::Attention]);
    }

    #[test]
    fn disarming_forgets_the_attention_window() {
        let mut d = timed();
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("9;x")), vec![Transition::Attention]);
        run(&mut d, &osc("133;D;0"));
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("9;x")), vec![Transition::Attention]);
    }

    #[test]
    fn plain_output_is_skipped_without_scanning_state_and_escapes_still_split_anywhere() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let big = vec![b'a'; 1024 * 1024];
        assert!(run(&mut d, &big).is_empty());
        let marker = osc("777;notify;Terax;attention");
        // Every split point of the marker, embedded in plain text.
        for split in 1..marker.len() {
            let mut d = AgentDetector::new();
            run(&mut d, &osc("133;C;claude"));
            let mut out = run(&mut d, &[&big[..100], &marker[..split]].concat());
            out.extend(run(&mut d, &[&marker[split..], &big[..100]].concat()));
            assert_eq!(out, vec![Transition::Attention], "split at {split}");
        }
    }

    #[test]
    fn a_body_that_ends_exactly_at_the_limit_still_terminates() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let body = format!("9;{}", "x".repeat(OSC_MAX - 2));
        assert_eq!(body.len(), OSC_MAX);
        assert_eq!(run(&mut d, &osc(&body)), vec![Transition::Attention]);
        let too_long = format!("9;{}", "x".repeat(OSC_MAX - 1));
        assert!(run(&mut d, &osc(&too_long)).is_empty());
        // The decoder resynchronises on the next sequence.
        assert_eq!(run(&mut d, &osc("777;notify;Terax;attention")), vec![Transition::Attention]);
    }

    #[test]
    fn exits_on_133d() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("133;D;0")), vec![Transition::Exited]);
        assert!(run(&mut d, &osc("133;D;0")).is_empty());
    }

    #[test]
    fn bel_terminator_inside_osc_is_not_attention() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend_from_slice(b"0;set title");
        seq.push(BEL);
        assert!(run(&mut d, &seq).is_empty());
    }

    #[test]
    fn started_split_across_chunks() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &[ESC, OSC_INTRO]).is_empty());
        assert!(run(&mut d, b"133;C;cla").is_empty());
        let mut out = run(&mut d, b"ude");
        out.extend(run(&mut d, &[ESC, ST_FINAL]));
        assert_eq!(out, vec![started("claude")]);
    }

    #[test]
    fn finish_reports_exited_when_armed() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut out = Vec::new();
        d.finish(|signal| out.push(signal));
        assert_eq!(out, vec![Signal::Transition(Transition::Exited)]);
        let mut out2 = Vec::new();
        d.finish(|signal| out2.push(signal));
        assert!(out2.is_empty());
    }

    #[test]
    fn oversized_osc_does_not_panic() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend(std::iter::repeat_n(b'x', OSC_MAX + 100));
        seq.extend_from_slice(&[ESC, ST_FINAL]);
        assert!(run(&mut d, &seq).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Terax;attention")), vec![Transition::Attention]);
    }

    fn note(kind: NotificationKind, title: Option<&str>, body: &str) -> TerminalNotification {
        TerminalNotification {
            kind,
            title: title.map(str::to_string),
            body: body.to_string(),
        }
    }

    #[test]
    fn arms_on_windows_command_forms() {
        for command in [
            "claude.exe",
            "claude.cmd --resume",
            "CLAUDE.EXE",
            ".\\claude.exe",
            "& 'C:\\Users\\me\\.local\\bin\\claude.exe' -p hi",
            "\"C:\\Program Files\\nodejs\\claude.cmd\" --model opus",
            "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.ps1",
            "npx -y @anthropic-ai/claude-code@latest",
            "cmd /c claude",
            "pwsh -NoProfile -Command claude.exe",
        ] {
            let mut d = AgentDetector::new();
            assert_eq!(run(&mut d, &osc(&format!("133;C;{command}"))), vec![started("claude")], "{command}");
        }
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;codex.cmd exec")), vec![started("codex")]);
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;gemini.ps1")), vec![started("gemini")]);
    }

    #[test]
    fn windows_forms_do_not_arm_on_lookalikes() {
        for command in ["claude.txt", "notepad claude.md", "claudexyz.exe", "type claude.log", "dir C:\\docs\\claude.bak"] {
            let mut d = AgentDetector::new();
            assert!(run(&mut d, &osc(&format!("133;C;{command}"))).is_empty(), "{command}");
        }
    }

    #[test]
    fn a_bell_is_a_terminal_notification() {
        let mut d = timed();
        assert_eq!(
            notifications(&mut d, b"build done\x07"),
            vec![note(NotificationKind::Bell, None, "")]
        );
    }

    #[test]
    fn a_bell_terminating_an_osc_is_not_a_bell() {
        let mut d = timed();
        assert!(run_all(&mut d, b"\x1b]0;title\x07").is_empty());
    }

    #[test]
    fn notifications_are_rate_limited_and_deduplicated() {
        let mut d = timed();
        assert_eq!(notifications(&mut d, b"\x07\x07\x07").len(), 1);
        advance(NOTIFY_DUPLICATE);
        assert_eq!(notifications(&mut d, b"\x07").len(), 1);
        // A burst of distinct notifications is capped per window.
        let mut allowed = 0;
        for index in 0..6 {
            advance(NOTIFY_DUPLICATE);
            allowed += notifications(&mut d, &osc(&format!("9;message {index}"))).len();
        }
        assert_eq!(allowed, usize::from(NOTIFY_BURST) - 2);
        advance(NOTIFY_WINDOW);
        assert_eq!(notifications(&mut d, &osc("9;fresh window")).len(), 1);
    }

    #[test]
    fn osc9_is_a_notification_unless_it_is_a_conemu_command() {
        let mut d = timed();
        assert_eq!(
            notifications(&mut d, &osc("9;Build finished")),
            vec![note(NotificationKind::Osc9, None, "Build finished")]
        );
        advance(NOTIFY_DUPLICATE);
        assert_eq!(
            notifications(&mut d, &osc("9;3 tests passed")),
            vec![note(NotificationKind::Osc9, None, "3 tests passed")]
        );
        for command in ["9;4;1;50", "9;4", "9;9;C:\\work", "9;1;100"] {
            advance(NOTIFY_DUPLICATE);
            assert!(notifications(&mut d, &osc(command)).is_empty(), "{command}");
        }
        assert!(notifications(&mut d, &osc("9;")).is_empty());
    }

    #[test]
    fn osc777_notify_splits_title_and_body() {
        let mut d = timed();
        assert_eq!(
            notifications(&mut d, &osc("777;notify;Deploy;prod; 2 of 3 done")),
            vec![note(NotificationKind::Osc777, Some("Deploy"), "prod; 2 of 3 done")]
        );
        advance(NOTIFY_DUPLICATE);
        assert!(notifications(&mut d, &osc("777;precmd")).is_empty());
        assert!(notifications(&mut d, &osc("777;notify;Terax;codex;finished")).is_empty());
    }

    #[test]
    fn osc99_supports_single_chunked_and_base64_notifications() {
        let mut d = timed();
        assert_eq!(
            notifications(&mut d, &osc("99;;Hello")),
            vec![note(NotificationKind::Osc99, None, "Hello")]
        );
        advance(NOTIFY_DUPLICATE);
        let mut chunked = run_all(&mut d, &osc("99;i=1:d=0;Build"));
        chunked.extend(run_all(&mut d, &osc("99;i=1:d=0:p=body;all green")));
        assert!(chunked.is_empty());
        assert_eq!(
            notifications(&mut d, &osc("99;i=1:p=body;!")),
            vec![note(NotificationKind::Osc99, Some("Build"), "all green!")]
        );
        advance(NOTIFY_DUPLICATE);
        assert_eq!(
            notifications(&mut d, &osc("99;e=1;SGVsbG8gd29ybGQ=")),
            vec![note(NotificationKind::Osc99, None, "Hello world")]
        );
        advance(NOTIFY_DUPLICATE);
        for ignored in ["99;p=close:i=1;", "99;p=?;", "99;e=1;***", "99;p=icon;AAAA"] {
            assert!(notifications(&mut d, &osc(ignored)).is_empty(), "{ignored}");
        }
    }

    #[test]
    fn base64_decoding_handles_padding_and_rejects_garbage() {
        assert_eq!(decode_base64(b"TWFu").unwrap(), b"Man");
        assert_eq!(decode_base64(b"TWE=").unwrap(), b"Ma");
        assert_eq!(decode_base64(b"TQ==").unwrap(), b"M");
        assert_eq!(decode_base64(b"TQ").unwrap(), b"M");
        assert_eq!(decode_base64(b"").unwrap(), b"");
        assert_eq!(decode_base64(b"T").ok_or(()), Err(()));
        assert_eq!(decode_base64(b"T*Q=").ok_or(()), Err(()));
    }

    #[test]
    fn notification_text_is_sanitized_and_bounded() {
        let mut d = timed();
        let long = "x".repeat(1500);
        let out = notifications(&mut d, &osc(&format!("777;notify;a\x01b;{long}")));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title.as_deref(), Some("ab"));
        assert!(out[0].body.len() <= MAX_NOTIFY_BODY + 3);
    }

    #[test]
    fn osc_notifications_are_attention_not_notifications_while_an_agent_runs() {
        let mut d = timed();
        run(&mut d, &osc("133;C;codex"));
        let signals = run_all(&mut d, &osc("9;needs you"));
        assert_eq!(signals, vec![Signal::Transition(Transition::Attention)]);
    }

    #[test]
    fn notification_event_wire_shape() {
        let event = note(NotificationKind::Osc777, Some("T"), "B").into_event(4);
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "ptyId": 4, "title": "T", "body": "B", "kind": "osc777" })
        );
        let bell = note(NotificationKind::Bell, None, "").into_event(1);
        assert_eq!(
            serde_json::to_value(bell).unwrap(),
            serde_json::json!({ "ptyId": 1, "body": "", "kind": "bell" })
        );
    }

    fn hooked(link: &Arc<AgentLink>, intent: HookIntent) -> Vec<Transition> {
        link.apply_hook("claude", intent)
    }

    #[test]
    fn hooks_self_arm_then_track_turns() {
        let link = AgentLink::new();
        assert_eq!(hooked(&link, HookIntent::Start), vec![started("claude")]);
        assert!(hooked(&link, HookIntent::Working).is_empty());
        assert!(hooked(&link, HookIntent::Activity).is_empty());
        assert_eq!(hooked(&link, HookIntent::Attention), vec![Transition::Attention]);
        assert!(hooked(&link, HookIntent::Attention).is_empty());
        assert_eq!(hooked(&link, HookIntent::Activity), vec![Transition::Working]);
        assert_eq!(hooked(&link, HookIntent::Finished), vec![Transition::Finished]);
        assert_eq!(hooked(&link, HookIntent::Working), vec![Transition::Working]);
        assert!(hooked(&link, HookIntent::Quiet).is_empty());
    }

    #[test]
    fn trailing_activity_hooks_do_not_start_an_agent() {
        let link = AgentLink::new();
        assert!(hooked(&link, HookIntent::Activity).is_empty());
        assert!(hooked(&link, HookIntent::Quiet).is_empty());
        assert!(!link.is_armed());
        assert!(!link.is_hooked());
    }

    #[test]
    fn a_first_attention_hook_arms_before_signalling() {
        let link = AgentLink::new();
        assert_eq!(
            hooked(&link, HookIntent::Attention),
            vec![started("claude"), Transition::Attention]
        );
    }

    #[test]
    fn a_hook_after_osc_arming_does_not_start_twice() {
        let link = AgentLink::new();
        let mut d = AgentDetector::with_link(link.clone());
        assert_eq!(run(&mut d, &osc("133;C;claude")), vec![started("claude")]);
        assert!(hooked(&link, HookIntent::Start).is_empty());
        assert!(link.is_hooked());
        assert!(run(&mut d, &osc("133;C;claude")).is_empty());
    }

    #[test]
    fn osc_state_hints_are_ignored_for_a_hooked_agent() {
        let link = AgentLink::new();
        let mut d = timed_with(link.clone());
        run(&mut d, &osc("133;C;codex"));
        hooked(&link, HookIntent::Working);
        assert!(run_all(&mut d, &osc("9;Agent turn complete")).is_empty());
        assert!(run_all(&mut d, &osc("777;notify;Terax;codex;finished")).is_empty());
        assert!(run_all(&mut d, b"\x07").is_empty());
        // Process lifecycle still comes from OSC 133.
        assert_eq!(run(&mut d, &osc("133;D;0")), vec![Transition::Exited]);
        assert!(!link.is_hooked());
        run(&mut d, &osc("133;C;codex"));
        advance(ATTENTION_REPEAT);
        assert_eq!(run(&mut d, &osc("9;done")), vec![Transition::Attention]);
    }

    #[test]
    fn a_hook_after_the_process_exited_starts_a_fresh_run() {
        let link = AgentLink::new();
        let mut d = AgentDetector::with_link(link.clone());
        run(&mut d, &osc("133;C;claude"));
        run(&mut d, &osc("133;D;0"));
        assert_eq!(hooked(&link, HookIntent::Working), vec![started("claude")]);
    }

    fn timed_with(link: Arc<AgentLink>) -> AgentDetector {
        AgentDetector::with_clock(
            DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect(),
            link,
            fake_now,
        )
    }
}
