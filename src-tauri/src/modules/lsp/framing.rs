//! Incremental Content-Length framing codec for the LSP base protocol.

use std::fmt;

// Cap so a misbehaving server can't make us buffer unbounded data.
const MAX_CONTENT_LEN: usize = 64 * 1024 * 1024;
const HEADER_TERMINATOR: &[u8] = b"\r\n\r\n";

#[derive(Debug, PartialEq, Eq)]
pub enum FramingError {
    MissingContentLength,
    InvalidContentLength(String),
    ContentTooLarge(usize),
    InvalidUtf8,
}

impl fmt::Display for FramingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingContentLength => write!(f, "lsp frame missing Content-Length header"),
            Self::InvalidContentLength(v) => write!(f, "lsp frame invalid Content-Length: {v}"),
            Self::ContentTooLarge(n) => {
                write!(f, "lsp frame Content-Length {n} exceeds cap {MAX_CONTENT_LEN}")
            }
            Self::InvalidUtf8 => write!(f, "lsp frame payload is not valid UTF-8"),
        }
    }
}

enum Phase {
    Headers { scan_from: usize },
    Body { len: usize },
}

pub struct FrameDecoder {
    buf: Vec<u8>,
    phase: Phase,
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self {
            buf: Vec::with_capacity(8 * 1024),
            phase: Phase::Headers { scan_from: 0 },
        }
    }
}

impl FrameDecoder {
    /// After an error the decoder is poisoned; tear the session down.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, FramingError> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            match self.phase {
                Phase::Headers { scan_from } => {
                    match find_terminator(&self.buf, scan_from) {
                        Some(header_end) => {
                            let len = parse_content_length(&self.buf[..header_end])?;
                            if len > MAX_CONTENT_LEN {
                                return Err(FramingError::ContentTooLarge(len));
                            }
                            self.buf.drain(..header_end + HEADER_TERMINATOR.len());
                            self.phase = Phase::Body { len };
                        }
                        None => {
                            // Terminator may straddle this chunk and the next.
                            self.phase = Phase::Headers {
                                scan_from: self.buf.len().saturating_sub(HEADER_TERMINATOR.len() - 1),
                            };
                            return Ok(out);
                        }
                    }
                }
                Phase::Body { len } => {
                    if self.buf.len() < len {
                        return Ok(out);
                    }
                    let rest = self.buf.split_off(len);
                    let payload = std::mem::replace(&mut self.buf, rest);
                    out.push(String::from_utf8(payload).map_err(|_| FramingError::InvalidUtf8)?);
                    self.phase = Phase::Headers { scan_from: 0 };
                }
            }
        }
    }
}

pub fn encode_frame(payload: &str) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    let mut out = Vec::with_capacity(header.len() + payload.len());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(payload.as_bytes());
    out
}

fn find_terminator(buf: &[u8], from: usize) -> Option<usize> {
    buf.get(from..)?
        .windows(HEADER_TERMINATOR.len())
        .position(|w| w == HEADER_TERMINATOR)
        .map(|p| from + p)
}

fn parse_content_length(headers: &[u8]) -> Result<usize, FramingError> {
    for line in headers.split(|&b| b == b'\n') {
        let line = std::str::from_utf8(line).map_err(|_| FramingError::MissingContentLength)?;
        let line = line.trim_end_matches('\r');
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            let value = value.trim();
            return value
                .parse::<usize>()
                .map_err(|_| FramingError::InvalidContentLength(value.to_string()));
        }
    }
    Err(FramingError::MissingContentLength)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(payload: &str) -> Vec<u8> {
        encode_frame(payload)
    }

    #[test]
    fn single_message_roundtrip() {
        let mut d = FrameDecoder::default();
        let msgs = d.push(&frame(r#"{"jsonrpc":"2.0"}"#)).unwrap();
        assert_eq!(msgs, vec![r#"{"jsonrpc":"2.0"}"#.to_string()]);
    }

    #[test]
    fn multiple_messages_in_one_chunk() {
        let mut d = FrameDecoder::default();
        let mut bytes = frame(r#"{"a":1}"#);
        bytes.extend(frame(r#"{"b":2}"#));
        let msgs = d.push(&bytes).unwrap();
        assert_eq!(msgs, vec![r#"{"a":1}"#.to_string(), r#"{"b":2}"#.to_string()]);
    }

    #[test]
    fn message_split_byte_by_byte() {
        let mut d = FrameDecoder::default();
        let bytes = frame(r#"{"jsonrpc":"2.0","id":1}"#);
        let mut got = Vec::new();
        for b in bytes {
            got.extend(d.push(&[b]).unwrap());
        }
        assert_eq!(got, vec![r#"{"jsonrpc":"2.0","id":1}"#.to_string()]);
    }

    #[test]
    fn terminator_straddles_chunks() {
        let mut d = FrameDecoder::default();
        let bytes = frame(r#"{"x":1}"#);
        // Split in the middle of \r\n\r\n.
        let split = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 2;
        assert!(d.push(&bytes[..split]).unwrap().is_empty());
        assert_eq!(d.push(&bytes[split..]).unwrap(), vec![r#"{"x":1}"#.to_string()]);
    }

    #[test]
    fn extra_headers_are_tolerated() {
        let mut d = FrameDecoder::default();
        let payload = r#"{"ok":true}"#;
        let raw = format!(
            "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
            payload.len(),
            payload
        );
        assert_eq!(d.push(raw.as_bytes()).unwrap(), vec![payload.to_string()]);
    }

    #[test]
    fn header_name_is_case_insensitive() {
        let mut d = FrameDecoder::default();
        let payload = r#"{}"#;
        let raw = format!("content-length: {}\r\n\r\n{}", payload.len(), payload);
        assert_eq!(d.push(raw.as_bytes()).unwrap(), vec![payload.to_string()]);
    }

    #[test]
    fn utf8_payload_with_multibyte_chars() {
        let mut d = FrameDecoder::default();
        let payload = r#"{"msg":"привет 世界"}"#;
        assert_eq!(d.push(&frame(payload)).unwrap(), vec![payload.to_string()]);
    }

    #[test]
    fn missing_content_length_errors() {
        let mut d = FrameDecoder::default();
        assert_eq!(
            d.push(b"Content-Type: text/json\r\n\r\n{}"),
            Err(FramingError::MissingContentLength)
        );
    }

    #[test]
    fn oversized_content_length_errors() {
        let mut d = FrameDecoder::default();
        let raw = format!("Content-Length: {}\r\n\r\n", MAX_CONTENT_LEN + 1);
        assert!(matches!(
            d.push(raw.as_bytes()),
            Err(FramingError::ContentTooLarge(_))
        ));
    }

    #[test]
    fn invalid_content_length_errors() {
        let mut d = FrameDecoder::default();
        assert!(matches!(
            d.push(b"Content-Length: abc\r\n\r\n"),
            Err(FramingError::InvalidContentLength(_))
        ));
    }

    #[test]
    fn invalid_utf8_payload_errors() {
        let mut d = FrameDecoder::default();
        let mut raw = b"Content-Length: 2\r\n\r\n".to_vec();
        raw.extend([0xFF, 0xFE]);
        assert_eq!(d.push(&raw), Err(FramingError::InvalidUtf8));
    }

    #[test]
    fn interleaved_partial_body_then_next_frame() {
        let mut d = FrameDecoder::default();
        let f1 = frame(r#"{"first":1}"#);
        let f2 = frame(r#"{"second":2}"#);
        let cut = f1.len() - 3;
        assert!(d.push(&f1[..cut]).unwrap().is_empty());
        let mut rest = f1[cut..].to_vec();
        rest.extend(&f2);
        assert_eq!(
            d.push(&rest).unwrap(),
            vec![r#"{"first":1}"#.to_string(), r#"{"second":2}"#.to_string()]
        );
    }
}
