use std::io::{Read, Write};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_SAMPLE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_LANGUAGE_BYTES: usize = 64;
const REQUEST_MAGIC: &[u8; 4] = b"TRXQ";
const RESPONSE_MAGIC: &[u8; 4] = b"TRXP";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum SpeechProfile {
    Nemotron = 1,
    Parakeet = 2,
}

impl SpeechProfile {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "nemotron" => Ok(Self::Nemotron),
            "parakeet" => Ok(Self::Parakeet),
            _ => Err("unknown native speech profile".into()),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Nemotron => "nemotron",
            Self::Parakeet => "parakeet",
        }
    }
}

#[derive(Clone, Copy)]
#[repr(u8)]
enum Operation {
    Transcribe = 1,
    Ping = 2,
    Shutdown = 3,
}

pub struct BridgeResponse {
    pub success: bool,
    pub profile: SpeechProfile,
    pub body: String,
}

pub fn validate_pcm_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("audio recording is empty".into());
    }
    if bytes.len() > MAX_SAMPLE_BYTES {
        return Err("audio recording exceeds the 32 MiB native transcription limit".into());
    }
    if !bytes.len().is_multiple_of(4) {
        return Err("native transcription audio must contain Float32 PCM".into());
    }
    for chunk in bytes.chunks_exact(4) {
        let value = f32::from_bits(u32::from_le_bytes(chunk.try_into().unwrap()));
        if !value.is_finite() {
            return Err("native transcription audio contains a non-finite sample".into());
        }
    }
    Ok(())
}

pub fn validate_sample_rate(sample_rate: u32) -> Result<(), String> {
    if !(8_000..=96_000).contains(&sample_rate) {
        return Err("native transcription sample rate is invalid".into());
    }
    Ok(())
}

pub fn validate_language_tag(language: &str) -> Result<(), String> {
    if language.is_empty()
        || language.len() > MAX_LANGUAGE_BYTES
        || language
            .bytes()
            .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
    {
        return Err("native transcription language tag is invalid".into());
    }
    Ok(())
}

pub fn write_transcribe_request(
    output: &mut impl Write,
    profile: SpeechProfile,
    sample_rate: u32,
    language: &str,
    samples: &[u8],
) -> Result<(), String> {
    validate_pcm_bytes(samples)?;
    validate_sample_rate(sample_rate)?;
    validate_language_tag(language)?;
    write_request(
        output,
        Operation::Transcribe,
        profile,
        sample_rate,
        language,
        samples,
    )
}

pub fn write_ping_request(output: &mut impl Write, profile: SpeechProfile) -> Result<(), String> {
    write_request(output, Operation::Ping, profile, 0, "", &[])
}

pub fn write_shutdown_request(
    output: &mut impl Write,
    profile: SpeechProfile,
) -> Result<(), String> {
    write_request(output, Operation::Shutdown, profile, 0, "", &[])
}

fn write_request(
    output: &mut impl Write,
    operation: Operation,
    profile: SpeechProfile,
    sample_rate: u32,
    language: &str,
    samples: &[u8],
) -> Result<(), String> {
    let language = language.as_bytes();
    if language.len() > MAX_LANGUAGE_BYTES {
        return Err("native transcription language tag is too long".into());
    }
    let sample_count = samples
        .len()
        .checked_div(4)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| "native transcription audio is too large".to_string())?;
    let mut header = Vec::with_capacity(20 + language.len());
    header.extend_from_slice(REQUEST_MAGIC);
    header.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    header.push(operation as u8);
    header.push(profile as u8);
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&(language.len() as u16).to_le_bytes());
    header.extend_from_slice(&0u16.to_le_bytes());
    header.extend_from_slice(&sample_count.to_le_bytes());
    header.extend_from_slice(language);
    output
        .write_all(&header)
        .map_err(|error| error.to_string())?;
    output
        .write_all(samples)
        .and_then(|_| output.flush())
        .map_err(|error| error.to_string())
}

pub fn read_response(input: &mut impl Read) -> Result<BridgeResponse, String> {
    let mut header = [0u8; 12];
    input
        .read_exact(&mut header)
        .map_err(|error| format!("native speech bridge closed: {error}"))?;
    if &header[..4] != RESPONSE_MAGIC {
        return Err("native speech bridge returned invalid framing".into());
    }
    if u16::from_le_bytes(header[4..6].try_into().unwrap()) != PROTOCOL_VERSION {
        return Err("native speech bridge protocol version does not match Terax".into());
    }
    let success = match header[6] {
        0 => true,
        1 => false,
        _ => return Err("native speech bridge returned an invalid status".into()),
    };
    let profile = match header[7] {
        1 => SpeechProfile::Nemotron,
        2 => SpeechProfile::Parakeet,
        _ => return Err("native speech bridge returned an invalid profile".into()),
    };
    let body_len = u32::from_le_bytes(header[8..12].try_into().unwrap()) as usize;
    if body_len > MAX_RESPONSE_BYTES {
        return Err("native speech bridge response exceeds 1 MiB".into());
    }
    let mut body = vec![0; body_len];
    input
        .read_exact(&mut body)
        .map_err(|error| format!("native speech bridge response was truncated: {error}"))?;
    let body = String::from_utf8(body)
        .map_err(|_| "native speech bridge returned non-UTF-8 text".to_string())?;
    Ok(BridgeResponse {
        success,
        profile,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_matches_cross_platform_wire_format() {
        let samples = [0.25f32.to_le_bytes(), (-0.5f32).to_le_bytes()].concat();
        let mut frame = Vec::new();
        write_transcribe_request(
            &mut frame,
            SpeechProfile::Nemotron,
            16_000,
            "en-US",
            &samples,
        )
        .unwrap();

        assert_eq!(&frame[..4], b"TRXQ");
        assert_eq!(u16::from_le_bytes(frame[4..6].try_into().unwrap()), 1);
        assert_eq!(frame[6], 1);
        assert_eq!(frame[7], 1);
        assert_eq!(u32::from_le_bytes(frame[8..12].try_into().unwrap()), 16_000);
        assert_eq!(u16::from_le_bytes(frame[12..14].try_into().unwrap()), 5);
        assert_eq!(u32::from_le_bytes(frame[16..20].try_into().unwrap()), 2);
        assert_eq!(&frame[20..25], b"en-US");
    }

    #[test]
    fn rejects_non_finite_samples() {
        assert!(validate_pcm_bytes(&f32::NAN.to_le_bytes()).is_err());
        assert!(validate_pcm_bytes(&f32::INFINITY.to_le_bytes()).is_err());
    }

    #[test]
    fn transcription_writer_rejects_invalid_metadata() {
        let samples = 0.25f32.to_le_bytes();
        assert!(write_transcribe_request(
            &mut Vec::new(),
            SpeechProfile::Nemotron,
            7_999,
            "auto",
            &samples,
        )
        .is_err());
        assert!(write_transcribe_request(
            &mut Vec::new(),
            SpeechProfile::Nemotron,
            16_000,
            "../../en",
            &samples,
        )
        .is_err());
    }

    #[test]
    fn response_parser_bounds_and_decodes_body() {
        let mut response = Vec::from(&b"TRXP\x01\x00\x00\x02\x05\x00\x00\x00"[..]);
        response.extend_from_slice(b"hello");
        let parsed = read_response(&mut response.as_slice()).unwrap();
        assert!(parsed.success);
        assert_eq!(parsed.profile, SpeechProfile::Parakeet);
        assert_eq!(parsed.body, "hello");
    }

    #[test]
    fn response_parser_rejects_oversized_bodies_before_allocation() {
        let mut response = Vec::from(&b"TRXP\x01\x00\x00\x01"[..]);
        response.extend_from_slice(&((MAX_RESPONSE_BYTES as u32) + 1).to_le_bytes());
        assert!(read_response(&mut response.as_slice()).is_err());
    }
}
