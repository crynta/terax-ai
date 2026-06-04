const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

const DEFAULT_AGENTS: &[&str] = &[
    "claude",
    "codex",
    "cursor-agent",
    "opencode",
    "pi",
    "gemini",
    "agy",
    "antigravity",
];

// OSC 777 marker our Claude Code hooks emit via `terminalSequence`.
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

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MarkerEvent {
    Working,
    Attention,
    Finished,
}

struct ParsedMarker<'a> {
    agent: Option<&'a str>,
    event: MarkerEvent,
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
            Transition::Started { agent } => AgentSignal {
                id,
                kind: "started",
                agent: Some(agent),
            },
            Transition::Working => AgentSignal {
                id,
                kind: "working",
                agent: None,
            },
            Transition::Attention => AgentSignal {
                id,
                kind: "attention",
                agent: None,
            },
            Transition::Finished => AgentSignal {
                id,
                kind: "finished",
                agent: None,
            },
            Transition::Exited => AgentSignal {
                id,
                kind: "exited",
                agent: None,
            },
        }
    }
}

pub struct AgentDetector {
    agents: Vec<String>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    active_agent: Option<String>,
    status: Status,
}

impl AgentDetector {
    pub fn new() -> Self {
        Self::with_agents(DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect())
    }

    pub fn with_agents(agents: Vec<String>) -> Self {
        Self {
            agents,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            active_agent: None,
            status: Status::Working,
        }
    }

    /// Feed a chunk of raw PTY output. Transitions come only from OSC sequences
    /// (`133` prompt boundaries, our `777` hook marker), never from raw output,
    /// so a TUI agent that repaints continuously never flaps working/waiting.
    pub fn process<F: FnMut(Transition)>(&mut self, input: &[u8], mut emit: F) {
        if self.state == State::Ground && !input.contains(&ESC) {
            return;
        }

        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => match b {
                    OSC_INTRO => {
                        self.state = State::Osc;
                        self.osc.clear();
                    }
                    ESC => {}
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        if self.osc.len() < OSC_MAX {
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                },
                State::OscEsc => match b {
                    ST_FINAL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => {}
                    _ => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                },
            }
        }
    }

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if self.armed {
            self.disarm();
            emit(Transition::Exited);
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.active_agent = None;
        self.status = Status::Working;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            // OSC 9;4 is taskbar progress, not a notification.
            b"9" if !pt.starts_with(b"4;") && pt != b"4" => self.generic_attention(emit),
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        if pt.starts_with(TERAX_MARKER) {
            // Self-arms so notifications work even when no shell preexec fired
            // (bash, Windows, tmux, wrappers).
            if let Some(marker) = parse_terax_marker(pt) {
                let Some(agent) = self.marker_agent(&marker) else {
                    return;
                };
                match marker.event {
                    MarkerEvent::Working => {
                        self.ensure_armed(&agent, emit);
                        self.set_working(emit);
                    }
                    MarkerEvent::Attention => {
                        self.ensure_armed(&agent, emit);
                        self.status = Status::Waiting;
                        emit(Transition::Attention);
                    }
                    MarkerEvent::Finished => {
                        self.ensure_armed(&agent, emit);
                        self.status = Status::Waiting;
                        emit(Transition::Finished);
                    }
                }
            }
            return;
        }
        self.generic_attention(emit);
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                if let Some(agent) = self.match_agent(cmd) {
                    self.armed = true;
                    self.active_agent = Some(agent.clone());
                    self.status = Status::Working;
                    emit(Transition::Started { agent });
                }
            }
            Some(b'D') if self.armed => {
                self.disarm();
                emit(Transition::Exited);
            }
            _ => {}
        }
    }

    fn marker_agent(&self, marker: &ParsedMarker<'_>) -> Option<String> {
        match marker.agent {
            Some(agent) => self
                .agents
                .iter()
                .any(|configured| configured == agent)
                .then(|| display_agent_id(agent)),
            None if self.armed => {
                Some(self.active_agent.as_deref().unwrap_or("claude").to_string())
            }
            None => Some("claude".to_string()),
        }
    }

    fn ensure_armed<F: FnMut(Transition)>(&mut self, agent: &str, emit: &mut F) {
        if self.armed && self.active_agent.as_deref() == Some(agent) {
            return;
        }
        self.armed = true;
        self.active_agent = Some(agent.to_string());
        self.status = Status::Working;
        emit(Transition::Started {
            agent: agent.into(),
        });
    }

    fn set_working<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Transition::Working);
        }
    }

    fn generic_attention<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.armed {
            self.status = Status::Waiting;
            emit(Transition::Attention);
        }
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            if token.starts_with('-') {
                continue;
            }
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            if let Some(agent) = self.agents.iter().find(|agent| base == agent.as_str()) {
                return Some(display_agent_id(agent));
            }
        }
        None
    }
}

fn display_agent_id(agent: &str) -> String {
    match agent {
        "agy" => "antigravity".to_string(),
        _ => agent.to_string(),
    }
}

fn parse_terax_marker(pt: &[u8]) -> Option<ParsedMarker<'_>> {
    let rest = pt.strip_prefix(TERAX_MARKER)?;
    match rest {
        b"working" => Some(ParsedMarker {
            agent: None,
            event: MarkerEvent::Working,
        }),
        b"attention" => Some(ParsedMarker {
            agent: None,
            event: MarkerEvent::Attention,
        }),
        b"finished" => Some(ParsedMarker {
            agent: None,
            event: MarkerEvent::Finished,
        }),
        _ => {
            let i = rest.iter().position(|b| *b == b';')?;
            let (agent, event) = (&rest[..i], &rest[i + 1..]);
            if !is_valid_marker_agent(agent) {
                return None;
            }
            let agent = std::str::from_utf8(agent).ok()?;
            let event = match event {
                b"working" => MarkerEvent::Working,
                b"attention" => MarkerEvent::Attention,
                b"finished" => MarkerEvent::Finished,
                _ => return None,
            };
            Some(ParsedMarker {
                agent: Some(agent),
                event,
            })
        }
    }
}

fn is_valid_marker_agent(agent: &[u8]) -> bool {
    !agent.is_empty()
        && agent
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut AgentDetector, input: &[u8]) -> Vec<Transition> {
        let mut out = Vec::new();
        d.process(input, |t| out.push(t));
        out
    }

    fn osc(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.extend_from_slice(&[ESC, ST_FINAL]);
        v
    }

    fn started(agent: &str) -> Transition {
        Transition::Started {
            agent: agent.into(),
        }
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;claude -p hello")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_sidebar_local_agent_commands() {
        let mut cursor = AgentDetector::new();
        assert_eq!(
            run(&mut cursor, &osc("133;C;cursor-agent --mode plan")),
            vec![started("cursor-agent")]
        );

        let mut opencode = AgentDetector::new();
        assert_eq!(
            run(&mut opencode, &osc("133;C;opencode run --interactive hi")),
            vec![started("opencode")]
        );

        let mut pi = AgentDetector::new();
        assert_eq!(
            run(&mut pi, &osc("133;C;pi --tools read,grep,find,ls")),
            vec![started("pi")]
        );

        let mut gemini = AgentDetector::new();
        assert_eq!(
            run(&mut gemini, &osc("133;C;gemini --prompt hello")),
            vec![started("gemini")]
        );

        let mut antigravity = AgentDetector::new();
        assert_eq!(
            run(&mut antigravity, &osc("133;C;agy run")),
            vec![started("antigravity")]
        );
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(
            run(&mut d2, &osc("133;C;npx claude")),
            vec![started("claude")]
        );
    }

    #[test]
    fn rejects_dash_suffixed_lookalike_commands() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("133;C;claude-enigma")).is_empty());
        assert!(run(&mut d, &osc("133;C;pi-evil --tools write")).is_empty());
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
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;working")),
            vec![Transition::Working]
        );
        assert!(run(&mut d, &osc("777;notify;Terax;working")).is_empty());
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;finished")),
            vec![Transition::Finished]
        );
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
    fn provider_qualified_terax_marker_self_arms_correct_agent() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;codex;attention")),
            vec![started("codex"), Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;codex;working")),
            vec![Transition::Working]
        );

        let mut gemini = AgentDetector::new();
        assert_eq!(
            run(&mut gemini, &osc("777;notify;Terax;gemini;finished")),
            vec![started("gemini"), Transition::Finished]
        );

        let mut antigravity = AgentDetector::new();
        assert_eq!(
            run(
                &mut antigravity,
                &osc("777;notify;Terax;antigravity;attention")
            ),
            vec![started("antigravity"), Transition::Attention]
        );
    }

    #[test]
    fn provider_qualified_terax_marker_updates_active_agent() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;codex")), vec![started("codex")]);
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;gemini;attention")),
            vec![started("gemini"), Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention]
        );

        let mut antigravity = AgentDetector::new();
        assert_eq!(
            run(&mut antigravity, &osc("777;notify;Terax;agy;attention")),
            vec![started("antigravity"), Transition::Attention]
        );
    }

    #[test]
    fn provider_qualified_terax_marker_rejects_unknown_agents() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Terax;unknown;attention")).is_empty());
        assert!(run(&mut d, &osc("777;notify;Terax;;attention")).is_empty());
    }

    #[test]
    fn generic_osc777_and_osc9_attention_only_when_armed() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Codex;ready")),
            vec![Transition::Attention]
        );
        assert_eq!(
            run(&mut d, &osc("9;needs you")),
            vec![Transition::Attention]
        );
        assert!(run(&mut d, &osc("9;4;1;50")).is_empty());
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
        d.finish(|t| out.push(t));
        assert_eq!(out, vec![Transition::Exited]);
        let mut out2 = Vec::new();
        d.finish(|t| out2.push(t));
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
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention]
        );
    }
}
