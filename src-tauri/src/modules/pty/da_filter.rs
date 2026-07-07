const ESC: u8 = 0x1b;
const LBRACKET: u8 = 0x5b;
const FINAL_C: u8 = 0x63;
const FINAL_N: u8 = 0x6e;
const PREFIX_GT: u8 = 0x3e;
const PREFIX_EQ: u8 = 0x3d;

const DA1_REPLY: &[u8] = b"\x1b[?1;2c";
const DA2_REPLY: &[u8] = b"\x1b[>0;276;0c";
// pwsh/PSReadLine blocks on a startup cursor-position query (ESC[6n) before any
// renderer slot is bound to answer it; on a fresh console the cursor is at home.
const DSR_CPR_REPLY: &[u8] = b"\x1b[1;1R";

const HOLD_MAX: usize = 256;

#[derive(Clone, Copy)]
enum State {
    Idle,
    AfterEsc,
    InsideCsi,
}

pub struct DaFilter {
    state: State,
    hold: Vec<u8>,
    cpr_replied: bool,
    saw_output: bool,
}

impl DaFilter {
    pub fn new() -> Self {
        DaFilter {
            state: State::Idle,
            hold: Vec::with_capacity(16),
            cpr_replied: false,
            saw_output: false,
        }
    }

    pub fn process<F: FnMut(&[u8])>(&mut self, input: &[u8], out: &mut Vec<u8>, mut respond: F) {
        if matches!(self.state, State::Idle) && !input.contains(&ESC) {
            out.extend_from_slice(input);
            if !input.is_empty() {
                self.saw_output = true;
            }
            return;
        }

        for &b in input {
            match self.state {
                State::Idle => {
                    if b == ESC {
                        self.state = State::AfterEsc;
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.push(b);
                    }
                }
                State::AfterEsc => {
                    if b == LBRACKET {
                        self.state = State::InsideCsi;
                        self.hold.push(b);
                    } else if b == ESC {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.extend_from_slice(&self.hold);
                        out.push(b);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
                State::InsideCsi => {
                    self.hold.push(b);
                    if (0x40..=0x7e).contains(&b) {
                        if b == FINAL_C {
                            let middle = &self.hold[2..self.hold.len() - 1];
                            let is_response = middle.contains(&b'?') || middle.contains(&b';');
                            let prefix = middle.first().copied().unwrap_or(0);
                            if is_response {
                                out.extend_from_slice(&self.hold);
                            } else {
                                match prefix {
                                    PREFIX_GT => respond(DA2_REPLY),
                                    PREFIX_EQ => {}
                                    0 | b'0'..=b'9' => respond(DA1_REPLY),
                                    _ => out.extend_from_slice(&self.hold),
                                }
                            }
                        } else if b == FINAL_N
                            && self.hold.len() == 4
                            && self.hold[2] == b'6'
                            && !self.cpr_replied
                            && !self.saw_output
                            && out.is_empty()
                        {
                            respond(DSR_CPR_REPLY);
                            self.cpr_replied = true;
                        } else {
                            out.extend_from_slice(&self.hold);
                        }
                        self.hold.clear();
                        self.state = State::Idle;
                    } else if self.hold.len() >= HOLD_MAX {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
            }
        }
        if !out.is_empty() {
            self.saw_output = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(filter: &mut DaFilter, input: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        filter.process(input, &mut out, |r| replies.push(r.to_vec()));
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
    fn embedded_da_preserves_surrounding() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"pre\x1b[0cpost");
        assert_eq!(out, b"prepost");
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
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
    fn double_esc() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b\x1b[c");
        assert_eq!(out, b"\x1b");
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
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
}
