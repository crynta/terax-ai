use std::sync::Arc;

use memchr::{memchr, memchr2};

use super::terminal_colors::{diverged, push_color_reply, ColorState, Terminator};

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const CAN: u8 = 0x18;
const SUB: u8 = 0x1a;
const LBRACKET: u8 = 0x5b;
const FINAL_C: u8 = 0x63;
const FINAL_N: u8 = 0x6e;
const PREFIX_GT: u8 = 0x3e;
const PREFIX_EQ: u8 = 0x3d;

// Same answers as the webview model, so a program sees one terminal whichever
// side replies.
const DA1_REPLY: &[u8] = b"\x1b[?62;22;52c";
const DA2_REPLY: &[u8] = b"\x1b[>1;10;0c";
// pwsh/PSReadLine blocks on a startup cursor-position query (ESC[6n) before any
// renderer slot is bound to answer it; on a fresh console the cursor is at home.
const DSR_CPR_REPLY: &[u8] = b"\x1b[1;1R";
const COLOR_SCHEME_QUERY: &[u8] = b"\x1b[?996n";
const SCHEME_REPORTS_MODE: &[u8] = b"2031";

const HOLD_MAX: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq)]
enum StringKind {
    Osc,
    /// Doubled escapes are literal inside it (tmux passthrough).
    Dcs,
    /// APC, PM and SOS.
    Other,
}

#[derive(Clone, Copy)]
enum State {
    Idle,
    AfterEsc,
    InsideCsi,
    /// `ESC ]` and the digits of the OSC number so far.
    OscHead,
    /// A colour OSC held until its terminator.
    OscQuery,
    /// The held OSC ended at an ESC; `\` completes its terminator.
    OscQueryEsc {
        swallowed: bool,
    },
    InString(StringKind),
    StringEsc(StringKind),
}

/// Answers the queries that must not wait for the webview.
///
/// Terminal queries have two owners. This filter replies, and removes the
/// query from the stream, for device attributes sent before any output (the
/// pwsh startup probe), colour queries (`OSC 4/10/11/12`) and the colour
/// scheme query (`CSI ? 996 n`), all from the theme the frontend pushed. A
/// program that asks for colours gives up after a short timeout, and a reply
/// that arrives later is echoed as text. Everything else reaches the webview
/// model unchanged and is answered there, so no query is ever answered twice.
///
/// A `CSI c` right after an answered colour query is the usual end-of-replies
/// sentinel; it is answered here too so it cannot overtake the colour reply
/// or arrive after the program stopped listening.
pub struct DaFilter {
    state: State,
    hold: Vec<u8>,
    reply: Vec<u8>,
    colors: Arc<ColorState>,
    cpr_replied: bool,
    saw_output: bool,
    /// The previous thing in the stream was a query answered here.
    sentinel: bool,
}

impl DaFilter {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_colors(Arc::new(ColorState::default()))
    }

    pub fn with_colors(colors: Arc<ColorState>) -> Self {
        DaFilter {
            state: State::Idle,
            hold: Vec::with_capacity(16),
            reply: Vec::with_capacity(64),
            colors,
            cpr_replied: false,
            saw_output: false,
            sentinel: false,
        }
    }

    /// True when `input` would be copied through unchanged: no escape
    /// sequence is in progress and none starts here. Lets the reader forward
    /// its read buffer as-is, skipping the copy `process` would make.
    pub fn passes_through(&mut self, input: &[u8]) -> bool {
        if matches!(self.state, State::Idle) && memchr(ESC, input).is_none() {
            if !input.is_empty() {
                self.saw_output = true;
                self.sentinel = false;
            }
            return true;
        }
        false
    }

    pub fn process<F: FnMut(&[u8])>(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        mut respond: F,
    ) {
        let mut i = 0;
        while i < input.len() {
            match self.state {
                State::Idle => {
                    // Plain text is copied in one run up to the next ESC.
                    let Some(run) = memchr(ESC, &input[i..]) else {
                        out.extend_from_slice(&input[i..]);
                        self.sentinel = false;
                        break;
                    };
                    if run > 0 {
                        out.extend_from_slice(&input[i..i + run]);
                        self.sentinel = false;
                    }
                    self.state = State::AfterEsc;
                    self.hold.clear();
                    self.hold.push(ESC);
                    i += run + 1;
                }
                State::AfterEsc => {
                    let b = input[i];
                    i += 1;
                    match b {
                        LBRACKET => {
                            self.state = State::InsideCsi;
                            self.hold.push(b);
                        }
                        b']' => {
                            self.state = State::OscHead;
                            self.hold.push(b);
                        }
                        ESC => {
                            out.extend_from_slice(&self.hold);
                            self.hold.clear();
                            self.hold.push(b);
                            self.sentinel = false;
                        }
                        b'P' | b'_' | b'^' | b'X' => {
                            out.extend_from_slice(&self.hold);
                            out.push(b);
                            self.hold.clear();
                            self.sentinel = false;
                            self.state = State::InString(if b == b'P' {
                                StringKind::Dcs
                            } else {
                                StringKind::Other
                            });
                        }
                        _ => {
                            if b == b'c' {
                                // RIS: the model's colours are no longer the theme's.
                                self.colors.mark_diverged(diverged::THEME_PUSH_CLEARS);
                                self.colors.clear_diverged(diverged::PALETTE_EXTENDED);
                            }
                            out.extend_from_slice(&self.hold);
                            out.push(b);
                            self.hold.clear();
                            self.sentinel = false;
                            self.state = State::Idle;
                        }
                    }
                }
                State::InsideCsi => {
                    let b = input[i];
                    i += 1;
                    self.hold.push(b);
                    if (0x40..=0x7e).contains(&b) {
                        self.finish_csi(b, out, &mut respond);
                        self.hold.clear();
                        self.state = State::Idle;
                    } else if self.hold.len() >= HOLD_MAX {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.sentinel = false;
                        self.state = State::Idle;
                    }
                }
                State::OscHead => {
                    let b = input[i];
                    if b.is_ascii_digit() && self.hold.len() < 5 {
                        self.hold.push(b);
                        i += 1;
                    } else if is_colour_osc(&self.hold[2..]) && matches!(b, b';' | BEL | ESC) {
                        self.state = State::OscQuery;
                    } else {
                        // Not a colour sequence: release it and skip the string.
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.sentinel = false;
                        self.state = State::InString(StringKind::Osc);
                    }
                }
                State::OscQuery => {
                    let b = input[i];
                    i += 1;
                    match b {
                        BEL => {
                            if !self.finish_osc(Terminator::Bel, out, &mut respond) {
                                out.push(BEL);
                            }
                            self.state = State::Idle;
                        }
                        ESC => {
                            let swallowed = self.finish_osc(Terminator::St, out, &mut respond);
                            self.state = State::OscQueryEsc { swallowed };
                        }
                        CAN | SUB => {
                            out.extend_from_slice(&self.hold);
                            out.push(b);
                            self.hold.clear();
                            self.sentinel = false;
                            self.state = State::Idle;
                        }
                        _ => {
                            self.hold.push(b);
                            if self.hold.len() >= HOLD_MAX {
                                out.extend_from_slice(&self.hold);
                                self.hold.clear();
                                self.sentinel = false;
                                self.state = State::InString(StringKind::Osc);
                            }
                        }
                    }
                }
                State::OscQueryEsc { swallowed } => {
                    if input[i] == b'\\' {
                        i += 1;
                        if !swallowed {
                            out.extend_from_slice(&[ESC, b'\\']);
                        }
                        self.state = State::Idle;
                    } else {
                        // The escape starts a new sequence, as in the model's parser.
                        if !swallowed {
                            out.push(ESC);
                        }
                        self.hold.clear();
                        self.hold.push(ESC);
                        self.state = State::AfterEsc;
                    }
                }
                State::InString(kind) => {
                    let rest = &input[i..];
                    let end = if kind == StringKind::Osc {
                        memchr2(ESC, BEL, rest)
                    } else {
                        memchr(ESC, rest)
                    };
                    match end {
                        None => {
                            out.extend_from_slice(rest);
                            break;
                        }
                        Some(at) => {
                            out.extend_from_slice(&rest[..at]);
                            i += at + 1;
                            if rest[at] == BEL {
                                out.push(BEL);
                                self.state = State::Idle;
                            } else {
                                self.state = State::StringEsc(kind);
                            }
                        }
                    }
                }
                State::StringEsc(kind) => {
                    let b = input[i];
                    if b == b'\\' {
                        i += 1;
                        out.extend_from_slice(&[ESC, b'\\']);
                        self.state = State::Idle;
                    } else if b == ESC && kind == StringKind::Dcs {
                        i += 1;
                        out.extend_from_slice(&[ESC, ESC]);
                        self.state = State::InString(kind);
                    } else {
                        self.hold.clear();
                        self.hold.push(ESC);
                        self.state = State::AfterEsc;
                    }
                }
            }
        }
        if !out.is_empty() {
            self.saw_output = true;
        }
    }

    /// `hold` is a complete CSI sequence ending in `last`.
    fn finish_csi<F: FnMut(&[u8])>(&mut self, last: u8, out: &mut Vec<u8>, respond: &mut F) {
        let sentinel = std::mem::take(&mut self.sentinel);
        match last {
            FINAL_C => {
                let middle = &self.hold[2..self.hold.len() - 1];
                let is_response = memchr2(b'?', b';', middle).is_some();
                let is_startup_query = (!self.saw_output && out.is_empty()) || sentinel;
                let prefix = middle.first().copied().unwrap_or(0);
                if is_response || !is_startup_query {
                    out.extend_from_slice(&self.hold);
                } else {
                    match prefix {
                        PREFIX_GT => respond(DA2_REPLY),
                        PREFIX_EQ => {}
                        0 | b'0'..=b'9' => respond(DA1_REPLY),
                        _ => out.extend_from_slice(&self.hold),
                    }
                }
            }
            FINAL_N => {
                if self.hold.len() == 4
                    && self.hold[2] == b'6'
                    && !self.cpr_replied
                    && !self.saw_output
                    && out.is_empty()
                {
                    respond(DSR_CPR_REPLY);
                    self.cpr_replied = true;
                } else if self.hold == COLOR_SCHEME_QUERY {
                    if let Some(colors) = self.colors.snapshot() {
                        respond(colors.scheme().report());
                        self.sentinel = true;
                    } else {
                        out.extend_from_slice(&self.hold);
                    }
                } else {
                    out.extend_from_slice(&self.hold);
                }
            }
            b'h' | b'l' => {
                if self.hold[2] == b'?'
                    && self.hold[3..self.hold.len() - 1]
                        .split(|&b| b == b';')
                        .any(|mode| mode == SCHEME_REPORTS_MODE)
                {
                    self.colors.set_scheme_reports(last == b'h');
                }
                out.extend_from_slice(&self.hold);
            }
            _ => out.extend_from_slice(&self.hold),
        }
    }

    /// `hold` is `ESC ]` and a colour OSC without its terminator. Returns true
    /// when it was answered and dropped; otherwise the sequence went to `out`
    /// (terminator excepted).
    fn finish_osc<F: FnMut(&[u8])>(
        &mut self,
        terminator: Terminator,
        out: &mut Vec<u8>,
        respond: &mut F,
    ) -> bool {
        let swallowed = answer_osc(
            &self.colors,
            &mut self.reply,
            &self.hold[2..],
            terminator,
            respond,
        );
        if !swallowed {
            out.extend_from_slice(&self.hold);
        }
        self.hold.clear();
        self.sentinel = swallowed;
        swallowed
    }
}

fn is_colour_osc(number: &[u8]) -> bool {
    matches!(
        number,
        b"4" | b"10" | b"11" | b"12" | b"104" | b"110" | b"111" | b"112"
    )
}

fn parse_index(text: &[u8]) -> Option<u8> {
    if text.is_empty() || text.len() > 3 || !text.iter().all(u8::is_ascii_digit) {
        return None;
    }
    text.iter()
        .try_fold(0u16, |n, d| Some(n * 10 + u16::from(d - b'0')))
        .and_then(|n| u8::try_from(n).ok())
}

/// Answers `body` (an OSC without its terminator) when every part of it is a
/// query the theme can answer. Sets and resets are noted, never answered, so a
/// later query for a colour a program changed is left to the model that holds
/// the real value.
fn answer_osc<F: FnMut(&[u8])>(
    colors: &ColorState,
    reply: &mut Vec<u8>,
    body: &[u8],
    terminator: Terminator,
    respond: &mut F,
) -> bool {
    let (number, args) = match memchr(b';', body) {
        Some(at) => (&body[..at], Some(&body[at + 1..])),
        None => (body, None),
    };
    let answered = match number {
        b"10" | b"11" | b"12" => {
            answer_dynamic(colors, reply, number[1] - b'0' + 10, args, terminator)
        }
        b"4" => answer_palette(colors, reply, args, terminator),
        b"104" => {
            match args {
                None => {
                    colors.clear_diverged(diverged::PALETTE_EXTENDED);
                    colors.mark_diverged(diverged::PALETTE_THEMED);
                }
                Some(args) => {
                    for index in args.split(|&b| b == b';').filter_map(parse_index) {
                        if index < 16 {
                            colors.mark_diverged(diverged::PALETTE_THEMED);
                        }
                    }
                }
            }
            false
        }
        b"110" | b"111" | b"112" => {
            colors.clear_diverged(diverged::dynamic(number[2] - b'0' + 10));
            false
        }
        _ => false,
    };
    if answered {
        respond(reply);
    }
    reply.clear();
    answered
}

/// Fills `reply` for `OSC <first> ; ? ; ? ...`; false when any part is a set
/// or cannot be answered from the theme.
fn answer_dynamic(
    colors: &ColorState,
    reply: &mut Vec<u8>,
    first: u8,
    args: Option<&[u8]>,
    terminator: Terminator,
) -> bool {
    let Some(args) = args else { return false };
    let theme = colors.snapshot();
    let mask = colors.diverged();
    let mut answerable = true;
    for (offset, item) in args.split(|&b| b == b';').enumerate() {
        let slot = first.saturating_add(u8::try_from(offset).unwrap_or(u8::MAX));
        if item != b"?" {
            colors.mark_diverged(diverged::dynamic(slot));
            answerable = false;
        } else if let Some(rgb) = theme
            .and_then(|theme| theme.dynamic(slot))
            .filter(|_| mask & diverged::dynamic(slot) == 0)
        {
            push_color_reply(reply, slot, rgb, terminator);
        } else {
            answerable = false;
        }
    }
    answerable
}

/// Fills `reply` for `OSC 4 ; <index> ; ? ; ...`.
fn answer_palette(
    colors: &ColorState,
    reply: &mut Vec<u8>,
    args: Option<&[u8]>,
    terminator: Terminator,
) -> bool {
    let Some(args) = args else { return false };
    let theme = colors.snapshot();
    let mask = colors.diverged();
    let mut answerable = theme.is_some();
    let mut pairs = 0;
    let mut items = args.split(|&b| b == b';');
    while let Some(index_text) = items.next() {
        let (Some(spec), Some(index)) = (items.next(), parse_index(index_text)) else {
            answerable = false;
            continue;
        };
        pairs += 1;
        match theme {
            Some(theme) if spec == b"?" && mask & diverged::palette(index) == 0 => {
                push_color_reply(
                    reply,
                    format_args!("4;{index}"),
                    theme.indexed(index),
                    terminator,
                );
            }
            _ => {
                if spec != b"?" {
                    colors.mark_diverged(diverged::palette(index));
                }
                answerable = false;
            }
        }
    }
    answerable && pairs > 0
}

#[cfg(test)]
mod tests {
    use super::super::terminal_colors::{ColorScheme, TerminalColors};
    use super::*;

    fn run(filter: &mut DaFilter, input: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        filter.process(input, &mut out, |r| replies.push(r.to_vec()));
        (out, replies)
    }

    fn theme(background: [u8; 3]) -> TerminalColors {
        TerminalColors {
            foreground: [0xfb, 0xfb, 0xfb],
            background,
            cursor: [0xaa, 0xbb, 0xcc],
            palette: std::array::from_fn(|i| [i as u8 * 10, 0, 0]),
        }
    }

    fn themed() -> (DaFilter, Arc<ColorState>) {
        let state = Arc::new(ColorState::new(Some(theme([0x09, 0x0b, 0x0c]))));
        (DaFilter::with_colors(state.clone()), state)
    }

    /// Feeds `input` in pieces of `size` bytes, collecting what the reader would.
    fn run_chunked(filter: &mut DaFilter, input: &[u8], size: usize) -> (Vec<u8>, Vec<u8>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        for piece in input.chunks(size) {
            if filter.passes_through(piece) {
                out.extend_from_slice(piece);
            } else {
                filter.process(piece, &mut out, |r| replies.extend_from_slice(r));
            }
        }
        (out, replies)
    }

    #[test]
    fn da1_bare() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da1_with_zero_param() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[0c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da2_secondary() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY.to_vec()]);
    }

    #[test]
    fn da3_consumed_silently() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[=c");
        assert!(out.is_empty());
        assert!(replies.is_empty());
    }

    #[test]
    fn plain_text_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"hello world\n");
        assert_eq!(out, b"hello world\n");
        assert!(replies.is_empty());
    }

    #[test]
    fn da_after_output_in_same_chunk_passes_through() {
        let mut f = DaFilter::new();
        let input = b"pre\x1b[0cpost";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn da_after_osc_queries_passes_through() {
        let mut f = DaFilter::new();
        let input = b"\x1b]10;?\x07\x1b]11;?\x07\x1b[c";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn da_after_output_in_prior_chunk_passes_through() {
        let mut f = DaFilter::new();
        let (initial, initial_replies) = run(&mut f, b"prompt");
        assert_eq!(initial, b"prompt");
        assert!(initial_replies.is_empty());

        let input = b"\x1b[c";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn non_da_csi_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?2004h");
        assert_eq!(out, b"\x1b[?2004h");
        assert!(replies.is_empty());
    }

    #[test]
    fn split_across_chunks() {
        let mut f = DaFilter::new();
        let (out1, r1) = run(&mut f, b"\x1b");
        let (out2, r2) = run(&mut f, b"[");
        let (out3, r3) = run(&mut f, b"c");
        assert!(out1.is_empty() && out2.is_empty() && out3.is_empty());
        assert!(r1.is_empty() && r2.is_empty());
        assert_eq!(r3, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn escape_then_non_csi() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1bM");
        assert_eq!(out, b"\x1bM");
        assert!(replies.is_empty());
    }

    #[test]
    fn da_after_escape_passes_through() {
        let mut f = DaFilter::new();
        let input = b"\x1b\x1b[c";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn da1_response_passes_through_no_loop() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?1;2c");
        assert_eq!(out, b"\x1b[?1;2c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da2_response_passes_through_no_loop() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>0;276;0c");
        assert_eq!(out, b"\x1b[>0;276;0c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da_with_question_prefix_is_response() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?6c");
        assert_eq!(out, b"\x1b[?6c");
        assert!(replies.is_empty());
    }

    #[test]
    fn runaway_csi_flushes_at_hold_max() {
        let mut f = DaFilter::new();
        let mut input = Vec::from(b"\x1b[".as_slice());
        input.extend(std::iter::repeat_n(b'0', HOLD_MAX));
        let (out, replies) = run(&mut f, &input);
        assert_eq!(out.len(), HOLD_MAX + 2);
        assert!(replies.is_empty());
    }

    #[test]
    fn cpr_startup_answered_and_swallowed() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[6n");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DSR_CPR_REPLY.to_vec()]);
    }

    #[test]
    fn cpr_answered_only_once() {
        let mut f = DaFilter::new();
        let (_, r1) = run(&mut f, b"\x1b[6n");
        assert_eq!(r1, vec![DSR_CPR_REPLY.to_vec()]);
        let (out, r2) = run(&mut f, b"\x1b[6n");
        assert_eq!(out, b"\x1b[6n");
        assert!(r2.is_empty());
    }

    #[test]
    fn cpr_passes_through_after_output() {
        let mut f = DaFilter::new();
        let (o1, _) = run(&mut f, b"PS C:\\> ");
        assert_eq!(o1, b"PS C:\\> ");
        let (out, replies) = run(&mut f, b"\x1b[6n");
        assert_eq!(out, b"\x1b[6n");
        assert!(replies.is_empty());
    }

    #[test]
    fn cpr_passes_through_when_output_precedes_in_same_chunk() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"hi\x1b[6n");
        assert_eq!(out, b"hi\x1b[6n");
        assert!(replies.is_empty());
    }

    #[test]
    fn cpr_answered_when_split_across_reads() {
        let mut f = DaFilter::new();
        let (o1, r1) = run(&mut f, b"\x1b[6");
        assert!(o1.is_empty() && r1.is_empty());
        let (o2, r2) = run(&mut f, b"n");
        assert!(o2.is_empty());
        assert_eq!(r2, vec![DSR_CPR_REPLY.to_vec()]);
    }

    #[test]
    fn other_dsr_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[5n");
        assert_eq!(out, b"\x1b[5n");
        assert!(replies.is_empty());
    }

    #[test]
    fn da_still_answered_with_cpr_logic() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn background_query_is_answered_with_the_queried_terminator() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"x\x1b]11;?\x07");
        assert_eq!(out, b"x");
        assert_eq!(replies, vec![b"\x1b]11;rgb:0909/0b0b/0c0c\x07".to_vec()]);

        let (out, replies) = run(&mut f, b"\x1b]11;?\x1b\\");
        assert!(out.is_empty());
        assert_eq!(replies, vec![b"\x1b]11;rgb:0909/0b0b/0c0c\x1b\\".to_vec()]);
    }

    #[test]
    fn foreground_and_cursor_queries_use_their_own_slots() {
        let (mut f, _) = themed();
        let (_, replies) = run(&mut f, b"\x1b]10;?\x07\x1b]12;?\x07");
        assert_eq!(
            replies,
            vec![
                b"\x1b]10;rgb:fbfb/fbfb/fbfb\x07".to_vec(),
                b"\x1b]12;rgb:aaaa/bbbb/cccc\x07".to_vec(),
            ]
        );
    }

    #[test]
    fn chained_dynamic_queries_answer_each_slot() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]10;?;?\x07");
        assert!(out.is_empty());
        assert_eq!(
            replies,
            vec![b"\x1b]10;rgb:fbfb/fbfb/fbfb\x07\x1b]11;rgb:0909/0b0b/0c0c\x07".to_vec()]
        );
    }

    #[test]
    fn the_colour_batch_and_its_da1_sentinel_are_answered_in_order() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b[c");
        assert!(out.is_empty());
        assert_eq!(
            replies,
            vec![
                b"\x1b]10;rgb:fbfb/fbfb/fbfb\x1b\\".to_vec(),
                b"\x1b]11;rgb:0909/0b0b/0c0c\x1b\\".to_vec(),
                DA1_REPLY.to_vec(),
            ]
        );
    }

    #[test]
    fn the_sentinel_is_answered_after_output_and_across_reads() {
        let (mut f, _) = themed();
        let (o1, _) = run(&mut f, b"prompt$ ");
        assert_eq!(o1, b"prompt$ ");
        let (_, r1) = run(&mut f, b"\x1b]11;?\x07");
        assert_eq!(r1.len(), 1);
        let (out, r2) = run(&mut f, b"\x1b[c");
        assert!(out.is_empty());
        assert_eq!(r2, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn a_da1_that_is_not_adjacent_goes_to_the_model() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x07x\x1b[c");
        assert_eq!(replies.len(), 1);
        assert_eq!(out, b"x\x1b[c");

        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x07\x1b[?u\x1b[c");
        assert_eq!(replies.len(), 1);
        assert_eq!(out, b"\x1b[?u\x1b[c");
    }

    #[test]
    fn the_sentinel_is_answered_once() {
        let (mut f, _) = themed();
        run(&mut f, b"prompt");
        let (out, replies) = run(&mut f, b"\x1b]11;?\x07\x1b[c\x1b[c");
        assert_eq!(replies.len(), 2);
        assert_eq!(out, b"\x1b[c");
    }

    #[test]
    fn colour_queries_pass_through_until_the_theme_is_known() {
        let mut f = DaFilter::new();
        let input = b"\x1b]11;?\x07\x1b]4;1;?\x07\x1b[?996n";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn a_pushed_theme_takes_effect_for_the_next_query() {
        let (mut f, state) = themed();
        let (_, before) = run(&mut f, b"\x1b]11;?\x07");
        state.update(theme([255, 255, 255]));
        let (_, after) = run(&mut f, b"\x1b]11;?\x07");
        assert_eq!(before, vec![b"\x1b]11;rgb:0909/0b0b/0c0c\x07".to_vec()]);
        assert_eq!(after, vec![b"\x1b]11;rgb:ffff/ffff/ffff\x07".to_vec()]);
    }

    #[test]
    fn a_split_query_is_answered_once_at_every_chunk_size() {
        let input = b"a\x1b]11;?\x1b\\b\x1b]10;?\x07\x1b[c\x1b[1;31mred\x1b[0m\x1b]4;1;?\x07";
        let (mut whole, _) = themed();
        let (out, replies) = run_chunked(&mut whole, input, input.len());
        assert_eq!(out, b"ab\x1b[1;31mred\x1b[0m");
        assert_eq!(
            replies,
            b"\x1b]11;rgb:0909/0b0b/0c0c\x1b\\\x1b]10;rgb:fbfb/fbfb/fbfb\x07\x1b[?62;22;52c\x1b]4;1;rgb:0a0a/0000/0000\x07"
        );
        for size in 1..=9 {
            let (mut f, _) = themed();
            assert_eq!(
                run_chunked(&mut f, input, size),
                (out.clone(), replies.clone()),
                "chunk size {size}"
            );
        }
    }

    #[test]
    fn ordinary_streams_are_forwarded_byte_for_byte_at_every_chunk_size() {
        let input: &[u8] = b"\x1b]0;title with 11;? inside\x07\x1b]8;;https://x.test\x1b\\link\x1b]8;;\x1b\\\
            \x1b]133;A\x1b\\\x1b]7;file:///tmp\x07\x1b]1337;File=inline=1:AAAA\x07\
            \x1b_Gf=100,a=T;AAAA\x1b\\\x1bP1$r0m\x1b\\\x1bPtmux;\x1b\x1b]11;?\x07\x1b\\\
            \x1b[?2026h\x1b[38;5;196mtext\x1b[0m\x1b[?2026l\x1b(B\x1b=\x1bM";
        for size in [input.len(), 1, 2, 3, 5, 7, 16] {
            let (mut f, _) = themed();
            let (out, replies) = run_chunked(&mut f, input, size);
            assert_eq!(out, input, "chunk size {size}");
            assert!(replies.is_empty(), "chunk size {size}");
        }
    }

    #[test]
    fn queries_inside_other_strings_are_not_answered() {
        let (mut f, _) = themed();
        let input = b"\x1b]0;11;?\x07\x1b_G11;?\x1b\\\x1bPtmux;\x1b\x1b]11;?\x07\x1b\\";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn a_string_stays_open_across_reads() {
        let (mut f, _) = themed();
        let (o1, r1) = run(&mut f, b"\x1b]0;a title");
        let (o2, r2) = run(&mut f, b" continues\x07\x1b]11;?\x07");
        assert_eq!(o1, b"\x1b]0;a title");
        assert_eq!(o2, b" continues\x07");
        assert!(r1.is_empty());
        assert_eq!(r2.len(), 1);
    }

    #[test]
    fn an_escape_inside_a_string_starts_a_new_sequence() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]0;broken\x1b]11;?\x07");
        assert_eq!(out, b"\x1b]0;broken");
        assert_eq!(replies.len(), 1);
    }

    #[test]
    fn an_osc_ended_by_an_escape_that_is_not_st_still_answers() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x1b[c");
        assert!(out.is_empty());
        assert_eq!(
            replies,
            vec![
                b"\x1b]11;rgb:0909/0b0b/0c0c\x1b\\".to_vec(),
                DA1_REPLY.to_vec()
            ]
        );
    }

    #[test]
    fn malformed_colour_sequences_are_left_to_the_model() {
        for input in [
            &b"\x1b]11\x07"[..],
            b"\x1b]11;\x07",
            b"\x1b]11;?x\x07",
            b"\x1b]13;?\x07",
            b"\x1b]10;?;?;?;?\x07",
            b"\x1b]4;?\x07",
            b"\x1b]4;1\x07",
            b"\x1b]4;999;?\x07",
            b"\x1b]4;x;?\x07",
            b"\x1b]011;?\x07",
            b"\x1b]1111;?\x07",
        ] {
            let (mut f, _) = themed();
            let (out, replies) = run(&mut f, input);
            assert_eq!(out, input, "{input:?}");
            assert!(replies.is_empty(), "{input:?}");
        }
    }

    #[test]
    fn a_runaway_colour_sequence_is_forwarded_whole() {
        let (mut f, _) = themed();
        let mut input = b"\x1b]11;".to_vec();
        input.extend(std::iter::repeat_n(b'a', HOLD_MAX * 2));
        input.push(BEL);
        let (out, replies) = run_chunked(&mut f, &input, 37);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn a_cancelled_colour_sequence_is_forwarded() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]11;?\x18ok");
        assert_eq!(out, b"\x1b]11;?\x18ok");
        assert!(replies.is_empty());
    }

    #[test]
    fn a_program_that_set_the_background_is_answered_by_the_model() {
        let (mut f, state) = themed();
        let set = b"\x1b]11;rgb:ff/00/00\x07";
        let (out, replies) = run(&mut f, set);
        assert_eq!(out, set);
        assert!(replies.is_empty());
        assert_eq!(state.diverged(), diverged::BACKGROUND);

        let (out, replies) = run(&mut f, b"\x1b]11;?\x07\x1b]10;?\x07");
        assert_eq!(out, b"\x1b]11;?\x07");
        assert_eq!(replies, vec![b"\x1b]10;rgb:fbfb/fbfb/fbfb\x07".to_vec()]);

        let (out, _) = run(&mut f, b"\x1b]111\x07");
        assert_eq!(out, b"\x1b]111\x07");
        let (_, replies) = run(&mut f, b"\x1b]11;?\x07");
        assert_eq!(replies.len(), 1);
    }

    #[test]
    fn a_theme_push_overrides_what_a_program_set() {
        let (mut f, state) = themed();
        run(&mut f, b"\x1b]10;rgb:00/00/00\x07\x1b]12;#fff\x07");
        assert_eq!(state.diverged(), diverged::FOREGROUND | diverged::CURSOR);
        state.update(theme([1, 2, 3]));
        assert_eq!(state.diverged(), 0);
    }

    #[test]
    fn a_full_reset_hands_colour_queries_back_to_the_model() {
        let (mut f, state) = themed();
        run(&mut f, b"\x1bc");
        let (out, replies) = run(&mut f, b"\x1b]11;?\x07");
        assert_eq!(out, b"\x1b]11;?\x07");
        assert!(replies.is_empty());
        state.update(theme([0, 0, 0]));
        let (_, replies) = run(&mut f, b"\x1b]11;?\x07");
        assert_eq!(replies.len(), 1);
    }

    #[test]
    fn palette_queries_answer_themed_and_extended_entries() {
        let (mut f, _) = themed();
        let (out, replies) = run(&mut f, b"\x1b]4;1;?;196;?\x07");
        assert!(out.is_empty());
        assert_eq!(
            replies,
            vec![b"\x1b]4;1;rgb:0a0a/0000/0000\x07\x1b]4;196;rgb:ffff/0000/0000\x07".to_vec()]
        );
    }

    #[test]
    fn palette_sets_and_resets_are_tracked_by_range() {
        let (mut f, state) = themed();
        run(&mut f, b"\x1b]4;200;rgb:00/00/00\x07");
        assert_eq!(state.diverged(), diverged::PALETTE_EXTENDED);
        let (out, replies) = run(&mut f, b"\x1b]4;1;?\x07\x1b]4;200;?\x07");
        assert_eq!(replies.len(), 1);
        assert_eq!(out, b"\x1b]4;200;?\x07");
        run(&mut f, b"\x1b]104\x07");
        assert_eq!(state.diverged(), diverged::PALETTE_THEMED);
        state.update(theme([0; 3]));
        assert_eq!(state.diverged(), 0);
    }

    #[test]
    fn a_mixed_palette_request_is_not_answered_in_parts() {
        let (mut f, _) = themed();
        let input = b"\x1b]4;1;?;2;rgb:00/00/00\x07";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn colour_scheme_query_reports_the_theme_scheme() {
        let (mut f, state) = themed();
        let (out, replies) = run(&mut f, b"\x1b[?996n");
        assert!(out.is_empty());
        assert_eq!(replies, vec![b"\x1b[?997;1n".to_vec()]);
        state.update(theme([250, 250, 250]));
        let (_, replies) = run(&mut f, b"\x1b[?996n");
        assert_eq!(replies, vec![b"\x1b[?997;2n".to_vec()]);
    }

    #[test]
    fn other_status_reports_still_reach_the_model() {
        let (mut f, _) = themed();
        let input = b"x\x1b[5n\x1b[6n\x1b[?996\x20n\x1b[996n";
        let (out, replies) = run(&mut f, input);
        assert_eq!(out, input);
        assert!(replies.is_empty());
    }

    #[test]
    fn scheme_reports_follow_mode_2031() {
        let (mut f, state) = themed();
        let enable = b"\x1b[?2004;2031h";
        let (out, _) = run(&mut f, enable);
        assert_eq!(out, enable);
        assert_eq!(state.update(theme([255; 3])), Some(ColorScheme::Light));
        run(&mut f, b"\x1b[?2031l");
        assert_eq!(state.update(theme([0; 3])), None);
    }

    #[test]
    fn a_different_mode_that_contains_2031_is_not_the_scheme_mode() {
        let (mut f, state) = themed();
        run(&mut f, b"\x1b[?12031h\x1b[?20310h\x1b[2031h");
        assert_eq!(state.update(theme([255; 3])), None);
    }
}
