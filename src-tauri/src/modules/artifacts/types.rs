use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Html,
    React,
    Markdown,
    Text,
    Json,
    Svg,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactDiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDiagnostic {
    pub code: String,
    pub severity: ArtifactDiagnosticSeverity,
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
    pub excerpt: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ArtifactDiagnostic>,
}

impl ArtifactDiagnostic {
    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            severity: ArtifactDiagnosticSeverity::Error,
            message: message.into(),
            line: None,
            column: None,
            end_line: None,
            end_column: None,
            excerpt: None,
        }
    }

    pub fn with_location(
        mut self,
        line: usize,
        column: usize,
        end_line: usize,
        end_column: usize,
        excerpt: impl Into<String>,
    ) -> Self {
        self.line = Some(line);
        self.column = Some(column);
        self.end_line = Some(end_line);
        self.end_column = Some(end_column);
        self.excerpt = Some(excerpt.into());
        self
    }
}

impl ArtifactError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            diagnostics: Vec::new(),
        }
    }

    pub fn with_diagnostics(mut self, diagnostics: Vec<ArtifactDiagnostic>) -> Self {
        self.diagnostics = diagnostics;
        self
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_NOT_FOUND", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_CONFLICT", message)
    }

    pub fn invalid_kind(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_INVALID_KIND", message)
    }

    pub fn invalid_edit(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_INVALID_EDIT", message)
    }

    pub fn invalid_id(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_INVALID_ID", message)
    }

    pub fn too_large(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_TOO_LARGE", message)
    }

    pub fn export_denied(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_EXPORT_DENIED", message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_UNAUTHORIZED", message)
    }

    pub fn compile_failed(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_COMPILE_FAILED", message)
    }

    pub fn compile_failed_with_diagnostic(diagnostic: ArtifactDiagnostic) -> Self {
        Self::compile_failed(diagnostic.message.clone()).with_diagnostics(vec![diagnostic])
    }

    pub fn store_unavailable(message: impl Into<String>) -> Self {
        Self::new("ARTIFACT_STORE_UNAVAILABLE", message)
    }
}

pub type ArtifactResult<T> = Result<T, ArtifactError>;

pub fn validate_conversation_id(conversation_id: &str) -> ArtifactResult<String> {
    let trimmed = conversation_id.trim();
    if trimmed.is_empty() {
        return Err(ArtifactError::invalid_id(
            "artifact conversation id must not be empty",
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ArtifactError::invalid_id(
            "artifact conversation id must not contain control characters",
        ));
    }
    Ok(trimmed.to_string())
}

pub fn conversation_key(conversation_id: &str) -> ArtifactResult<String> {
    let conversation_id = validate_conversation_id(conversation_id)?;
    let mut key = String::with_capacity(2 + conversation_id.len() * 2);
    key.push_str("c_");
    for byte in conversation_id.as_bytes() {
        key.push(hex_nibble(byte >> 4));
        key.push(hex_nibble(byte & 0x0f));
    }
    Ok(key)
}

pub fn normalize_slug(input: &str) -> ArtifactResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ArtifactError::invalid_id("artifact slug must not be empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(ArtifactError::invalid_id(
            "artifact slug must not be a dot segment",
        ));
    }
    if trimmed
        .chars()
        .any(|character| character == '/' || character == '\\' || character.is_control())
    {
        return Err(ArtifactError::invalid_id(
            "artifact slug must not contain path separators or control characters",
        ));
    }

    let mut slug = String::with_capacity(trimmed.len());
    let mut previous_dash = false;
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err(ArtifactError::invalid_id("artifact slug must not be empty"));
    }
    if slug.len() > 48 {
        return Err(ArtifactError::invalid_id(
            "artifact slug must be 48 characters or fewer",
        ));
    }
    Ok(slug)
}

fn hex_nibble(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + (value - 10)) as char,
        _ => '0',
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_display_slug_to_kebab_id() {
        assert_eq!(normalize_slug("  Hero Card v2  ").unwrap(), "hero-card-v2");
        assert_eq!(normalize_slug("react_widget").unwrap(), "react-widget");
    }

    #[test]
    fn rejects_unsafe_slug_inputs() {
        assert_eq!(
            normalize_slug("../secret").unwrap_err().code,
            "ARTIFACT_INVALID_ID"
        );
        assert_eq!(normalize_slug(" ").unwrap_err().code, "ARTIFACT_INVALID_ID");
        assert_eq!(
            normalize_slug(&"a".repeat(49)).unwrap_err().code,
            "ARTIFACT_INVALID_ID"
        );
    }

    #[test]
    fn conversation_key_is_path_safe_and_does_not_expose_raw_id() {
        let key = conversation_key("pi/session:alpha").unwrap();
        assert_eq!(key, "c_70692f73657373696f6e3a616c706861");
        assert!(!key.contains('/'));
        assert!(!key.contains(':'));
    }

    #[test]
    fn conversation_key_rejects_empty_or_control_ids() {
        assert_eq!(
            conversation_key(" ").unwrap_err().code,
            "ARTIFACT_INVALID_ID"
        );
        assert_eq!(
            conversation_key("pi\n1").unwrap_err().code,
            "ARTIFACT_INVALID_ID"
        );
    }
}
