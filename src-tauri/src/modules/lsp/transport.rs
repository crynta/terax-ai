//! LSP stdio framing: `Content-Length: N\r\n\r\n` + JSON body.

pub fn encode_message(body: &[u8]) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut out = header.into_bytes();
    out.extend_from_slice(body);
    out
}

pub struct FrameReader {
    buffer: Vec<u8>,
}

impl Default for FrameReader {
    fn default() -> Self {
        Self {
            buffer: Vec::with_capacity(4096),
        }
    }
}

impl FrameReader {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some((len, header_end)) = parse_content_length(&self.buffer) {
            let frame_end = header_end + len;
            if self.buffer.len() < frame_end {
                break;
            }
            let body = &self.buffer[header_end..frame_end];
            frames.push(String::from_utf8_lossy(body).into_owned());
            self.buffer.drain(..frame_end);
        }
        frames
    }
}

fn parse_content_length(buf: &[u8]) -> Option<(usize, usize)> {
    let header_end = buf.windows(4).position(|w| w == b"\r\n\r\n")? + 4;
    let header = std::str::from_utf8(&buf[..header_end]).ok()?;
    for line in header.lines() {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case("Content-Length") {
            let len: usize = value.trim().parse().ok()?;
            return Some((len, header_end));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_round_trip() {
        let body = br#"{"jsonrpc":"2.0","id":1}"#;
        let encoded = encode_message(body);
        let mut reader = FrameReader::default();
        let frames = reader.push(&encoded);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0], r#"{"jsonrpc":"2.0","id":1}"#);
    }

    #[test]
    fn parses_chunked_frames() {
        let a = encode_message(br#"{"a":1}"#);
        let b = encode_message(br#"{"b":2}"#);
        let mut reader = FrameReader::default();
        let mut combined = a.clone();
        combined.extend_from_slice(&b);
        let mid = combined.len() / 2;
        let f1 = reader.push(&combined[..mid]);
        let f2 = reader.push(&combined[mid..]);
        let all: Vec<_> = f1.into_iter().chain(f2).collect();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], r#"{"a":1}"#);
        assert_eq!(all[1], r#"{"b":2}"#);
    }
}
