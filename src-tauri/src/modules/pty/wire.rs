//! Binary framing for the multiplexed `terax-pty` stream. Pure and
//! allocation-light so every boundary rule is unit-testable without a webview.
//!
//! All integers are little-endian.
//!
//! Request body (`POST /poll` and `POST /ack`):
//!
//! ```text
//! [u64 token][u32 count] then count x [u32 pty_id][u64 cumulative_parsed_bytes]
//! ```
//!
//! Response body (`/poll`), frames back to back:
//!
//! ```text
//! [u32 pty_id][u8 kind][u32 len][payload; len bytes]
//!   data   (1): payload = [u64 start_offset][bytes]
//!   exit   (2): payload = [i32 code]
//!   failed (3): payload = UTF-8 reason
//!   sync   (4): payload empty (native is waiting on this PTY's acknowledgement)
//! ```

use std::fmt;

pub(super) const KIND_DATA: u8 = 1;
pub(super) const KIND_EXIT: u8 = 2;
pub(super) const KIND_FAILED: u8 = 3;
pub(super) const KIND_SYNC: u8 = 4;

pub(super) const FRAME_HEADER_LEN: usize = 9;
pub(super) const DATA_PREFIX_LEN: usize = 8;
/// One data frame is also one acknowledgement boundary; small frames keep the
/// credit loop fine-grained during floods.
pub(super) const MAX_FRAME_PAYLOAD: usize = 64 * 1024;
/// Hard cap for one response body. Anything left over goes in the next poll.
pub(super) const RESPONSE_CAP: usize = 1024 * 1024;
/// Room kept for control frames so a data-heavy response can still carry them.
const CONTROL_RESERVE: usize = 16 * 1024;
const MAX_REASON_BYTES: usize = 200;

pub(super) const REQUEST_HEADER_LEN: usize = 12;
pub(super) const ACK_ENTRY_LEN: usize = 12;
/// Wire maximum. The frontend sends at most 64 per request so a request body
/// stays below 1 KiB, which WebKitGTK's body reader handles in one pass.
pub(super) const MAX_ACKS_PER_REQUEST: usize = 256;
/// Longest legal request body. Anything longer is refused before it is read.
pub(super) const MAX_REQUEST_LEN: usize = REQUEST_HEADER_LEN + MAX_ACKS_PER_REQUEST * ACK_ENTRY_LEN;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Ack {
    pub id: u32,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct StreamRequest {
    pub token: u64,
    pub acks: Vec<Ack>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WireError {
    Truncated,
    TooManyAcks,
    LengthMismatch,
    #[cfg(test)]
    UnknownKind,
    #[cfg(test)]
    BadUtf8,
}

impl WireError {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::Truncated => "request is shorter than its header",
            Self::TooManyAcks => "request carries too many acknowledgements",
            Self::LengthMismatch => "request length does not match its acknowledgement count",
            #[cfg(test)]
            Self::UnknownKind => "unknown frame kind",
            #[cfg(test)]
            Self::BadUtf8 => "frame reason is not UTF-8",
        }
    }
}

impl fmt::Display for WireError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

pub(super) fn decode_request(body: &[u8]) -> Result<StreamRequest, WireError> {
    let Some((header, entries)) = body.split_at_checked(REQUEST_HEADER_LEN) else {
        return Err(WireError::Truncated);
    };
    let token = u64::from_le_bytes(header[..8].try_into().expect("8-byte slice"));
    let count = u32::from_le_bytes(header[8..].try_into().expect("4-byte slice")) as usize;
    if count > MAX_ACKS_PER_REQUEST {
        return Err(WireError::TooManyAcks);
    }
    if entries.len() != count * ACK_ENTRY_LEN {
        return Err(WireError::LengthMismatch);
    }
    let acks = entries
        .as_chunks::<ACK_ENTRY_LEN>()
        .0
        .iter()
        .map(|entry| Ack {
            id: u32::from_le_bytes(entry[..4].try_into().expect("4-byte slice")),
            bytes: u64::from_le_bytes(entry[4..].try_into().expect("8-byte slice")),
        })
        .collect();
    Ok(StreamRequest { token, acks })
}

#[cfg(test)]
pub(super) fn encode_request(token: u64, acks: &[Ack]) -> Vec<u8> {
    let mut body = Vec::with_capacity(REQUEST_HEADER_LEN + acks.len() * ACK_ENTRY_LEN);
    body.extend_from_slice(&token.to_le_bytes());
    body.extend_from_slice(&(acks.len() as u32).to_le_bytes());
    for ack in acks {
        body.extend_from_slice(&ack.id.to_le_bytes());
        body.extend_from_slice(&ack.bytes.to_le_bytes());
    }
    body
}

/// Accumulates frames for one response. Data frames stop at the response cap
/// (minus a control reserve); control frames use the reserve and are refused
/// only if even that is exhausted, in which case the hub retries them in the
/// next response.
pub(super) struct ResponseBuilder {
    buf: Vec<u8>,
    cap: usize,
}

impl ResponseBuilder {
    pub fn new() -> Self {
        Self::with_cap(RESPONSE_CAP)
    }

    pub fn with_cap(cap: usize) -> Self {
        Self {
            buf: Vec::new(),
            cap,
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// Largest data payload one more data frame may carry right now.
    pub fn data_room(&self) -> usize {
        self.cap
            .saturating_sub(CONTROL_RESERVE)
            .saturating_sub(self.buf.len())
            .saturating_sub(FRAME_HEADER_LEN + DATA_PREFIX_LEN)
            .min(MAX_FRAME_PAYLOAD)
    }

    /// Reserves a data frame header, lets `take` append up to `max` payload
    /// bytes (returning the PTY stream offset of the first byte and the count),
    /// then seals the header. Nothing is left behind when `take` yields none.
    pub fn push_data_with<F>(&mut self, id: u32, max: usize, take: F) -> Option<usize>
    where
        F: FnOnce(&mut Vec<u8>, usize) -> Option<(u64, usize)>,
    {
        let max = max.min(self.data_room());
        if max == 0 {
            return None;
        }
        let start = self.buf.len();
        self.buf
            .resize(start + FRAME_HEADER_LEN + DATA_PREFIX_LEN, 0);
        let Some((offset, len)) = take(&mut self.buf, max) else {
            self.buf.truncate(start);
            return None;
        };
        debug_assert!(len > 0 && len <= max);
        debug_assert_eq!(
            self.buf.len(),
            start + FRAME_HEADER_LEN + DATA_PREFIX_LEN + len
        );
        self.buf[start..start + 4].copy_from_slice(&id.to_le_bytes());
        self.buf[start + 4] = KIND_DATA;
        self.buf[start + 5..start + FRAME_HEADER_LEN]
            .copy_from_slice(&((DATA_PREFIX_LEN + len) as u32).to_le_bytes());
        self.buf[start + FRAME_HEADER_LEN..start + FRAME_HEADER_LEN + DATA_PREFIX_LEN]
            .copy_from_slice(&offset.to_le_bytes());
        Some(len)
    }

    pub fn push_exit(&mut self, id: u32, code: i32) -> bool {
        self.push_control(id, KIND_EXIT, &code.to_le_bytes())
    }

    pub fn push_failed(&mut self, id: u32, reason: &str) -> bool {
        let mut end = reason.len().min(MAX_REASON_BYTES);
        while !reason.is_char_boundary(end) {
            end -= 1;
        }
        self.push_control(id, KIND_FAILED, &reason.as_bytes()[..end])
    }

    pub fn push_sync(&mut self, id: u32) -> bool {
        self.push_control(id, KIND_SYNC, &[])
    }

    fn push_control(&mut self, id: u32, kind: u8, payload: &[u8]) -> bool {
        if self.buf.len() + FRAME_HEADER_LEN + payload.len() > self.cap {
            return false;
        }
        self.buf.extend_from_slice(&id.to_le_bytes());
        self.buf.push(kind);
        self.buf
            .extend_from_slice(&(payload.len() as u32).to_le_bytes());
        self.buf.extend_from_slice(payload);
        true
    }

    pub fn into_body(self) -> Vec<u8> {
        self.buf
    }
}

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Frame<'a> {
    Data {
        id: u32,
        offset: u64,
        payload: &'a [u8],
    },
    Exit {
        id: u32,
        code: i32,
    },
    Failed {
        id: u32,
        reason: &'a str,
    },
    Sync {
        id: u32,
    },
}

#[cfg(test)]
pub(super) fn decode_frames(mut body: &[u8]) -> Result<Vec<Frame<'_>>, WireError> {
    let mut frames = Vec::new();
    while !body.is_empty() {
        let Some((header, rest)) = body.split_at_checked(FRAME_HEADER_LEN) else {
            return Err(WireError::Truncated);
        };
        let id = u32::from_le_bytes(header[..4].try_into().unwrap());
        let kind = header[4];
        let len = u32::from_le_bytes(header[5..].try_into().unwrap()) as usize;
        let Some((payload, rest)) = rest.split_at_checked(len) else {
            return Err(WireError::Truncated);
        };
        body = rest;
        frames.push(match kind {
            KIND_DATA => {
                let Some((offset, bytes)) = payload.split_at_checked(DATA_PREFIX_LEN) else {
                    return Err(WireError::Truncated);
                };
                Frame::Data {
                    id,
                    offset: u64::from_le_bytes(offset.try_into().unwrap()),
                    payload: bytes,
                }
            }
            KIND_EXIT => Frame::Exit {
                id,
                code: i32::from_le_bytes(payload.try_into().map_err(|_| WireError::Truncated)?),
            },
            KIND_FAILED => Frame::Failed {
                id,
                reason: std::str::from_utf8(payload).map_err(|_| WireError::BadUtf8)?,
            },
            KIND_SYNC if payload.is_empty() => Frame::Sync { id },
            _ => return Err(WireError::UnknownKind),
        });
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fill(builder: &mut ResponseBuilder, id: u32, offset: u64, bytes: &[u8]) -> Option<usize> {
        builder.push_data_with(id, bytes.len(), |buf, max| {
            let n = bytes.len().min(max);
            buf.extend_from_slice(&bytes[..n]);
            Some((offset, n))
        })
    }

    #[test]
    fn request_round_trips_many_acknowledgements() {
        let acks = [
            Ack { id: 1, bytes: 0 },
            Ack {
                id: u32::MAX,
                bytes: u64::MAX,
            },
            Ack { id: 7, bytes: 4096 },
        ];
        let body = encode_request(0xDEAD_BEEF_0123_4567, &acks);
        assert_eq!(body.len(), REQUEST_HEADER_LEN + 3 * ACK_ENTRY_LEN);
        let decoded = decode_request(&body).unwrap();
        assert_eq!(decoded.token, 0xDEAD_BEEF_0123_4567);
        assert_eq!(decoded.acks, acks);
        assert_eq!(decode_request(&encode_request(9, &[])).unwrap().acks, []);
    }

    #[test]
    fn malformed_requests_are_errors_and_never_panic() {
        let good = encode_request(1, &[Ack { id: 2, bytes: 3 }]);
        assert_eq!(decode_request(&[]), Err(WireError::Truncated));
        assert_eq!(decode_request(&good[..11]), Err(WireError::Truncated));
        assert_eq!(
            decode_request(&good[..good.len() - 1]),
            Err(WireError::LengthMismatch)
        );
        let mut trailing = good.clone();
        trailing.push(0);
        assert_eq!(decode_request(&trailing), Err(WireError::LengthMismatch));
        let mut huge = good.clone();
        huge[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(decode_request(&huge), Err(WireError::TooManyAcks));
        let mut over = encode_request(1, &[]);
        over[8..12].copy_from_slice(&(MAX_ACKS_PER_REQUEST as u32 + 1).to_le_bytes());
        assert_eq!(decode_request(&over), Err(WireError::TooManyAcks));
        // Exhaustively truncated and bit-flipped prefixes must fail cleanly.
        for len in 0..good.len() {
            let _ = decode_request(&good[..len]);
        }
        for byte in 0..good.len() {
            for bit in 0..8 {
                let mut flipped = good.clone();
                flipped[byte] ^= 1 << bit;
                let _ = decode_request(&flipped);
            }
        }
    }

    #[test]
    fn frames_round_trip_in_order_across_ptys() {
        let mut builder = ResponseBuilder::new();
        assert_eq!(fill(&mut builder, 3, 0, b"hello"), Some(5));
        assert_eq!(fill(&mut builder, 4, 100, b"\x1b[31mred"), Some(8));
        assert!(builder.push_sync(4));
        assert!(builder.push_failed(5, "reader failed: \u{2603}"));
        assert!(builder.push_exit(3, -1));
        let body = builder.into_body();
        let frames = decode_frames(&body).unwrap();
        assert_eq!(
            frames,
            [
                Frame::Data {
                    id: 3,
                    offset: 0,
                    payload: b"hello"
                },
                Frame::Data {
                    id: 4,
                    offset: 100,
                    payload: b"\x1b[31mred"
                },
                Frame::Sync { id: 4 },
                Frame::Failed {
                    id: 5,
                    reason: "reader failed: \u{2603}"
                },
                Frame::Exit { id: 3, code: -1 },
            ]
        );
    }

    #[test]
    fn truncated_or_unknown_frames_do_not_decode() {
        let mut builder = ResponseBuilder::new();
        fill(&mut builder, 1, 0, b"abc");
        let body = builder.into_body();
        for len in 1..body.len() {
            assert!(decode_frames(&body[..len]).is_err(), "prefix {len}");
        }
        let mut unknown = body.clone();
        unknown[4] = 99;
        assert_eq!(decode_frames(&unknown), Err(WireError::UnknownKind));
    }

    #[test]
    fn data_frames_are_capped_and_split_at_the_frame_limit() {
        let mut builder = ResponseBuilder::new();
        let payload = vec![7u8; MAX_FRAME_PAYLOAD * 3];
        let mut written = 0;
        while written < payload.len() {
            let Some(n) = builder.push_data_with(1, payload.len() - written, |buf, max| {
                let n = (payload.len() - written).min(max);
                buf.extend_from_slice(&payload[written..written + n]);
                Some((written as u64, n))
            }) else {
                break;
            };
            assert!(n <= MAX_FRAME_PAYLOAD);
            written += n;
        }
        assert_eq!(written, payload.len());
        let body = builder.into_body();
        assert_eq!(decode_frames(&body).unwrap().len(), 3);
    }

    #[test]
    fn response_never_exceeds_the_cap_and_defers_the_rest() {
        let mut builder = ResponseBuilder::new();
        let chunk = vec![1u8; MAX_FRAME_PAYLOAD];
        let mut frames = 0;
        while builder
            .push_data_with(1, chunk.len(), |buf, max| {
                buf.extend_from_slice(&chunk[..max]);
                Some((0, max))
            })
            .is_some()
        {
            frames += 1;
            assert!(builder.len() <= RESPONSE_CAP);
        }
        assert!(builder.len() <= RESPONSE_CAP - CONTROL_RESERVE);
        assert!(builder.len() > RESPONSE_CAP - CONTROL_RESERVE - 2 * MAX_FRAME_PAYLOAD);
        assert!((14..=16).contains(&frames), "{frames} frames");
        // The reserve still takes control frames, up to the hard cap.
        while builder.push_exit(2, 0) {}
        assert!(builder.len() <= RESPONSE_CAP);
        assert!(builder.len() + FRAME_HEADER_LEN + 4 > RESPONSE_CAP);
    }

    #[test]
    fn a_take_that_yields_nothing_leaves_no_header_behind() {
        let mut builder = ResponseBuilder::new();
        assert_eq!(builder.push_data_with(1, 10, |_, _| None), None);
        assert!(builder.is_empty());
        assert_eq!(builder.push_data_with(1, 0, |_, _| Some((0, 0))), None);
        assert!(builder.is_empty());
    }

    #[test]
    fn failure_reasons_are_truncated_on_a_character_boundary() {
        let mut builder = ResponseBuilder::new();
        let long = "\u{1F600}".repeat(200);
        assert!(builder.push_failed(1, &long));
        let body = builder.into_body();
        let Frame::Failed { reason, .. } = &decode_frames(&body).unwrap()[0] else {
            unreachable!()
        };
        assert!(reason.len() <= MAX_REASON_BYTES);
        assert!(reason.chars().all(|c| c == '\u{1F600}'));
    }
}
