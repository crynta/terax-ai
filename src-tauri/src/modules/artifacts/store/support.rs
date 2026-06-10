use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::super::react::{compile_react_artifact, ReactCompileInput};
use super::super::types::{conversation_key, ArtifactError, ArtifactKind, ArtifactResult};
use super::models::{Artifact, ArtifactExportResult, ArtifactSummary};
use super::{MAX_ARTIFACT_CONTENT_BYTES, MAX_ARTIFACT_TITLE_CHARS};

pub(super) fn normalized_title(title: Option<&str>, slug: &str) -> String {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| truncate_title(value).to_string())
        .unwrap_or_else(|| slug.to_string())
}

pub(super) fn validate_title(title: &str) -> ArtifactResult<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(ArtifactError::invalid_id(
            "artifact title must not be empty",
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ArtifactError::invalid_id(
            "artifact title must not contain control characters",
        ));
    }
    if trimmed.chars().count() > MAX_ARTIFACT_TITLE_CHARS {
        return Err(ArtifactError::invalid_id(format!(
            "artifact title must be {MAX_ARTIFACT_TITLE_CHARS} characters or fewer"
        )));
    }
    Ok(trimmed.to_string())
}

fn truncate_title(title: &str) -> &str {
    if title.chars().count() <= MAX_ARTIFACT_TITLE_CHARS {
        return title;
    }
    let end = title
        .char_indices()
        .nth(MAX_ARTIFACT_TITLE_CHARS)
        .map(|(index, _)| index)
        .unwrap_or(title.len());
    &title[..end]
}

pub(super) fn validate_content_size(content: &str) -> ArtifactResult<()> {
    if content.len() > MAX_ARTIFACT_CONTENT_BYTES {
        return Err(ArtifactError::too_large(format!(
            "artifact content must be at most {MAX_ARTIFACT_CONTENT_BYTES} bytes"
        )));
    }
    Ok(())
}

fn export_content_for_artifact(artifact: &Artifact) -> ArtifactResult<String> {
    match artifact.summary.kind {
        ArtifactKind::React => compile_react_artifact(ReactCompileInput {
            content: artifact.content.clone(),
            preview_token: None,
        })
        .map(|result| result.document),
        _ => Ok(artifact.content.clone()),
    }
}

pub(super) fn export_artifact_to(
    artifact: Artifact,
    destination: &Path,
) -> ArtifactResult<ArtifactExportResult> {
    validate_export_destination(&artifact.summary.kind, destination)?;
    let export_content = export_content_for_artifact(&artifact)?;
    write_atomic(destination, export_content.as_bytes())?;
    Ok(ArtifactExportResult {
        conversation_id: artifact.summary.conversation_id,
        slug: artifact.summary.slug,
        version: artifact.summary.version,
        path: destination.to_path_buf(),
        content_hash: sha256_hex(&export_content),
        content_bytes: export_content.len(),
    })
}

pub(super) fn export_filename(summary: &ArtifactSummary) -> ArtifactResult<String> {
    let conversation_key = conversation_key(&summary.conversation_id)?;
    Ok(format!(
        "{}-{}-v{}.{}",
        conversation_key,
        summary.slug,
        summary.version,
        export_extension(&summary.kind)
    ))
}

fn export_extension(kind: &ArtifactKind) -> &'static str {
    match kind {
        ArtifactKind::Html => "html",
        ArtifactKind::Markdown => "md",
        ArtifactKind::Text => "txt",
        ArtifactKind::Json => "json",
        ArtifactKind::Svg => "svg",
        ArtifactKind::React => "html",
    }
}

fn validate_export_destination(kind: &ArtifactKind, destination: &Path) -> ArtifactResult<()> {
    if destination.as_os_str().is_empty() || destination.file_name().is_none() {
        return Err(ArtifactError::export_denied(
            "artifact export destination must include a file name",
        ));
    }
    if destination.is_dir() {
        return Err(ArtifactError::export_denied(
            "artifact export destination must be a file path",
        ));
    }
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| {
            ArtifactError::export_denied("artifact export destination must have a file extension")
        })?;
    let allowed = match kind {
        ArtifactKind::Html => matches!(extension.as_str(), "html" | "htm"),
        ArtifactKind::Markdown => matches!(extension.as_str(), "md" | "markdown"),
        ArtifactKind::Text => matches!(extension.as_str(), "txt" | "text"),
        ArtifactKind::Json => extension == "json",
        ArtifactKind::Svg => extension == "svg",
        ArtifactKind::React => matches!(extension.as_str(), "html" | "htm"),
    };
    if allowed {
        Ok(())
    } else {
        Err(ArtifactError::export_denied(
            "artifact export destination extension does not match artifact kind",
        ))
    }
}

pub(super) fn sha256_hex(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    bytes_to_hex(&digest)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(hex_nibble(byte >> 4));
        output.push(hex_nibble(byte & 0x0f));
    }
    output
}

fn hex_nibble(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + (value - 10)) as char,
        _ => '0',
    }
}

pub(super) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> ArtifactResult<()> {
    let contents = serde_json::to_vec_pretty(value)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    let mut with_newline = contents;
    with_newline.push(b'\n');
    write_atomic(path, &with_newline)
}

pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> ArtifactResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| ArtifactError::store_unavailable("artifact path has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    temp.write_all(bytes)
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    temp.flush()
        .map_err(|error| ArtifactError::store_unavailable(error.to_string()))?;
    temp.persist(path)
        .map_err(|error| ArtifactError::store_unavailable(error.error.to_string()))?;
    Ok(())
}

pub(super) fn validate_undo_token(token: &str) -> ArtifactResult<String> {
    let trimmed = token.trim();
    if trimmed.is_empty()
        || trimmed.len() > 96
        || trimmed.chars().any(|character| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '-'
        })
    {
        return Err(ArtifactError::invalid_id("artifact undo token is invalid"));
    }
    Ok(trimmed.to_string())
}

pub(super) fn now_iso_timestamp() -> String {
    epoch_millis_to_iso_utc(unix_epoch_millis())
}

pub(super) fn unix_epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn epoch_millis_to_iso_utc(epoch_millis: u128) -> String {
    let total_seconds = (epoch_millis / 1_000) as i64;
    let milliseconds = epoch_millis % 1_000;
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds:03}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let days = days_since_unix_epoch + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_title_uses_slug_when_empty() {
        assert_eq!(normalized_title(None, "my-artifact"), "my-artifact");
        assert_eq!(normalized_title(Some(""), "my-artifact"), "my-artifact");
        assert_eq!(normalized_title(Some("  "), "my-artifact"), "my-artifact");
    }

    #[test]
    fn normalized_title_trims_and_truncates() {
        assert_eq!(normalized_title(Some("My Title"), "slug"), "My Title");
    }

    #[test]
    fn validate_title_rejects_empty() {
        assert!(validate_title("").is_err());
        assert!(validate_title("  ").is_err());
    }

    #[test]
    fn validate_title_rejects_control_chars() {
        assert!(validate_title("hello\nworld").is_err());
    }

    #[test]
    fn validate_title_accepts_valid() {
        assert_eq!(validate_title("My Artifact").unwrap(), "My Artifact");
    }

    #[test]
    fn validate_content_size_accepts_small() {
        assert!(validate_content_size("hello").is_ok());
    }

    #[test]
    fn validate_content_size_rejects_oversized() {
        let big = "a".repeat(MAX_ARTIFACT_CONTENT_BYTES + 1);
        assert!(validate_content_size(&big).is_err());
    }

    #[test]
    fn validate_undo_token_accepts_valid() {
        assert_eq!(validate_undo_token("abc123_-").unwrap(), "abc123_-");
    }

    #[test]
    fn validate_undo_token_rejects_empty() {
        assert!(validate_undo_token("").is_err());
        assert!(validate_undo_token("  ").is_err());
    }

    #[test]
    fn validate_undo_token_rejects_special_chars() {
        assert!(validate_undo_token("abc!@#").is_err());
    }

    #[test]
    fn validate_undo_token_rejects_overlong() {
        assert!(validate_undo_token(&"a".repeat(97)).is_err());
        assert!(validate_undo_token(&"a".repeat(96)).is_ok());
    }

    #[test]
    fn sha256_hex_produces_deterministic_hash() {
        let a = sha256_hex("hello");
        let b = sha256_hex("hello");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn sha256_hex_differs_for_different_input() {
        assert_ne!(sha256_hex("hello"), sha256_hex("world"));
    }

    #[test]
    fn export_extension_returns_correct_extensions() {
        assert_eq!(export_extension(&ArtifactKind::Html), "html");
        assert_eq!(export_extension(&ArtifactKind::Markdown), "md");
        assert_eq!(export_extension(&ArtifactKind::Text), "txt");
        assert_eq!(export_extension(&ArtifactKind::Json), "json");
        assert_eq!(export_extension(&ArtifactKind::Svg), "svg");
        assert_eq!(export_extension(&ArtifactKind::React), "html");
    }

    #[test]
    fn epoch_millis_to_iso_utc_known_values() {
        assert_eq!(epoch_millis_to_iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            epoch_millis_to_iso_utc(1_704_067_200_000),
            "2024-01-01T00:00:00.000Z"
        );
        assert_eq!(
            epoch_millis_to_iso_utc(900_061_200_123),
            "1998-07-10T09:00:00.123Z"
        );
    }

    #[test]
    fn validate_export_destination_rejects_no_extension() {
        let err = validate_export_destination(&ArtifactKind::Html, Path::new("noext")).unwrap_err();
        assert_eq!(err.code, "ARTIFACT_EXPORT_DENIED");
    }

    #[test]
    fn validate_export_destination_rejects_wrong_extension() {
        let err =
            validate_export_destination(&ArtifactKind::Html, Path::new("file.txt")).unwrap_err();
        assert_eq!(err.code, "ARTIFACT_EXPORT_DENIED");
    }

    #[test]
    fn validate_export_destination_accepts_matching_extension() {
        assert!(validate_export_destination(&ArtifactKind::Html, Path::new("f.html")).is_ok());
        assert!(validate_export_destination(&ArtifactKind::Html, Path::new("f.htm")).is_ok());
        assert!(validate_export_destination(&ArtifactKind::Markdown, Path::new("f.md")).is_ok());
        assert!(validate_export_destination(&ArtifactKind::Text, Path::new("f.txt")).is_ok());
        assert!(validate_export_destination(&ArtifactKind::Json, Path::new("f.json")).is_ok());
        assert!(validate_export_destination(&ArtifactKind::Svg, Path::new("f.svg")).is_ok());
    }
}
