#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::local_agents::resolve_local_agent_binary_in_path;
use super::provider_config::{normalize_provider_config, provider_key_account};
use super::*;

fn command_error_with_code(message: &str, code: Option<&str>) -> PiCommandError {
    PiCommandError {
        message: message.to_string(),
        code: code.map(str::to_string),
        category: None,
        retryable: None,
        remediation: None,
    }
}

#[test]
fn pi_session_not_found_match_uses_structured_error_code() {
    assert!(is_pi_session_not_found_error(&command_error_with_code(
        "Pi host wording can change without breaking history-only delete",
        Some("PI_SESSION_NOT_FOUND"),
    )));
    assert!(!is_pi_session_not_found_error(&command_error_with_code(
        "Pi host error -32004: Pi session not found: pi-1",
        None,
    )));
    assert!(!is_pi_session_not_found_error(&command_error_with_code(
        "Pi host error -32007: Pi session is already running: pi-1",
        Some("PI_SESSION_BUSY"),
    )));
}

#[test]
fn sdk_session_file_validation_rejects_paths_outside_session_dir() {
    let root = tempfile::tempdir().unwrap();
    let session_dir = root.path().join("sessions");
    let outside_dir = root.path().join("outside");
    std::fs::create_dir(&session_dir).unwrap();
    std::fs::create_dir(&outside_dir).unwrap();
    let inside = session_dir.join("session.jsonl");
    let outside = outside_dir.join("session.jsonl");
    let symlink_path = session_dir.join("symlink.jsonl");
    std::fs::write(&inside, "{}").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&inside, &symlink_path).unwrap();

    let canonical_inside = crate::modules::fs::to_canon(std::fs::canonicalize(&inside).unwrap());
    assert_eq!(
        validate_sdk_session_file_path(inside.to_str().unwrap(), &session_dir).unwrap(),
        canonical_inside
    );
    assert_eq!(
        validate_existing_sdk_session_file_path(inside.to_str().unwrap(), &session_dir).unwrap(),
        canonical_inside
    );
    assert!(validate_sdk_session_file_path(outside.to_str().unwrap(), &session_dir).is_err());
    assert!(
        validate_existing_sdk_session_file_path(outside.to_str().unwrap(), &session_dir).is_err()
    );
    #[cfg(unix)]
    assert!(validate_sdk_session_file_path(symlink_path.to_str().unwrap(), &session_dir).is_err());
}

#[test]
fn local_agent_detection_uses_allowlisted_binaries() {
    let dir = tempfile::tempdir().unwrap();
    let claude = dir.path().join("claude");
    let codex = dir.path().join("codex");
    let pi = dir.path().join("pi");
    std::fs::write(&claude, "").unwrap();
    std::fs::write(&codex, "").unwrap();
    std::fs::write(&pi, "").unwrap();
    #[cfg(unix)]
    std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
    #[cfg(unix)]
    std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = dir.path().to_str().unwrap();

    assert_eq!(
        resolve_local_agent_binary_in_path("claude", path),
        Some(claude)
    );
    assert_eq!(resolve_local_agent_binary_in_path("pi", path), Some(pi));
    #[cfg(unix)]
    assert!(resolve_local_agent_binary_in_path("codex", path).is_none());
    assert!(resolve_local_agent_binary_in_path("sh", path).is_none());
}

#[test]
fn resolve_session_cwd_canonicalizes_authorized_roots() {
    let registry = WorkspaceRegistry::default();
    let root = tempfile::tempdir().unwrap();
    registry.authorize(root.path()).unwrap();
    let nested = root.path().join("nested");
    std::fs::create_dir(&nested).unwrap();

    let resolved = resolve_session_cwd(
        &registry,
        Some(nested.to_str().unwrap()),
        &WorkspaceEnv::Local,
    )
    .unwrap();

    let canonical_nested = std::fs::canonicalize(&nested).unwrap();
    assert_eq!(resolved, crate::modules::fs::to_canon(&canonical_nested));
}

#[test]
fn resolve_session_cwd_rejects_missing_cwd() {
    let registry = WorkspaceRegistry::default();

    let error = resolve_session_cwd(&registry, None, &WorkspaceEnv::Local).unwrap_err();

    assert_eq!(error, "Pi session requires an authorized workspace cwd");
}

#[test]
fn resolve_session_cwd_rejects_unauthorized_paths() {
    let registry = WorkspaceRegistry::default();
    let root = tempfile::tempdir().unwrap();

    let error = resolve_session_cwd(
        &registry,
        Some(root.path().to_str().unwrap()),
        &WorkspaceEnv::Local,
    )
    .unwrap_err();

    assert!(error.contains("outside the authorized workspace"));
}

#[test]
fn resolve_prompt_context_canonicalizes_authorized_paths() {
    let registry = WorkspaceRegistry::default();
    let root = tempfile::tempdir().unwrap();
    registry.authorize(root.path()).unwrap();
    let src = root.path().join("src");
    std::fs::create_dir(&src).unwrap();
    let file = src.join("App.tsx");
    std::fs::write(&file, "export default null;\n").unwrap();

    let resolved = resolve_prompt_context(
        &registry,
        Some(PiPromptContext {
            workspace_root: Some(root.path().to_str().unwrap().to_string()),
            active_terminal_cwd: Some(src.to_str().unwrap().to_string()),
            active_file: Some(file.to_str().unwrap().to_string()),
            active_terminal_private: true,
        }),
        &WorkspaceEnv::Local,
    )
    .unwrap()
    .unwrap();

    assert_eq!(
        resolved.workspace_root,
        Some(crate::modules::fs::to_canon(
            std::fs::canonicalize(root.path()).unwrap()
        ))
    );
    assert_eq!(
        resolved.active_terminal_cwd,
        Some(crate::modules::fs::to_canon(
            std::fs::canonicalize(&src).unwrap()
        ))
    );
    assert_eq!(
        resolved.active_file,
        Some(crate::modules::fs::to_canon(
            std::fs::canonicalize(&file).unwrap()
        ))
    );
    assert!(resolved.active_terminal_private);
}

#[test]
fn resolve_prompt_context_rejects_unauthorized_paths() {
    let registry = WorkspaceRegistry::default();
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("outside.ts");
    std::fs::write(&file, "export default null;\n").unwrap();

    let error = resolve_prompt_context(
        &registry,
        Some(PiPromptContext {
            workspace_root: Some(root.path().to_str().unwrap().to_string()),
            active_terminal_cwd: None,
            active_file: Some(file.to_str().unwrap().to_string()),
            active_terminal_private: false,
        }),
        &WorkspaceEnv::Local,
    )
    .unwrap_err();

    assert!(error.contains("outside the authorized workspace"));
}

#[test]
fn normalize_provider_config_trims_runtime_fields() {
    let resolved = normalize_provider_config(Some(PiProviderConfig {
        provider: " anthropic ".to_string(),
        model_id: " claude-sonnet-4-6 ".to_string(),
        source_model_id: Some(" claude-sonnet-4-6 ".to_string()),
        base_url: None,
        context_limit: None,
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: None,
        thinking_level: None,
        auth_mode: None,
    }))
    .unwrap()
    .unwrap();

    assert_eq!(resolved.auth_mode, PiAuthMode::Terax);
    assert_eq!(resolved.provider, "anthropic");
    assert_eq!(resolved.model_id, "claude-sonnet-4-6");
    assert_eq!(
        resolved.source_model_id.as_deref(),
        Some("claude-sonnet-4-6")
    );
}

#[test]
fn normalize_provider_config_preserves_runtime_model_metadata() {
    let resolved = normalize_provider_config(Some(PiProviderConfig {
        provider: "openai-compatible".to_string(),
        model_id: "qwen3-max".to_string(),
        source_model_id: None,
        base_url: Some("https://gateway.example.com/v1".to_string()),
        context_limit: Some(256_000),
        max_tokens: Some(64_000),
        reasoning: Some(true),
        custom_endpoint_id: Some("abc123".to_string()),
        thinking_level: None,
        auth_mode: None,
    }))
    .unwrap()
    .unwrap();

    assert_eq!(resolved.context_limit, Some(256_000));
    assert_eq!(resolved.max_tokens, Some(64_000));
    assert_eq!(resolved.reasoning, Some(true));
}

#[test]
fn normalize_provider_config_allows_pi_profile_providers() {
    let resolved = normalize_provider_config(Some(PiProviderConfig {
        provider: " openai-codex ".to_string(),
        model_id: " gpt-5.3-codex ".to_string(),
        source_model_id: Some(" pi-profile:openai-codex:gpt-5.3-codex ".to_string()),
        base_url: None,
        context_limit: None,
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: None,
        thinking_level: None,
        auth_mode: Some(PiAuthMode::Profile),
    }))
    .unwrap()
    .unwrap();

    assert_eq!(resolved.auth_mode, PiAuthMode::Profile);
    assert_eq!(resolved.provider, "openai-codex");
    assert_eq!(resolved.model_id, "gpt-5.3-codex");
    assert_eq!(provider_key_account(&resolved), None);
}

#[test]
fn normalize_provider_config_validates_thinking_level() {
    let resolved = normalize_provider_config(Some(PiProviderConfig {
        provider: "anthropic".to_string(),
        model_id: "claude-sonnet-4-6".to_string(),
        source_model_id: None,
        base_url: None,
        context_limit: None,
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: None,
        thinking_level: Some(" high ".to_string()),
        auth_mode: None,
    }))
    .unwrap()
    .unwrap();
    assert_eq!(resolved.thinking_level.as_deref(), Some("high"));

    let error = normalize_provider_config(Some(PiProviderConfig {
        provider: "anthropic".to_string(),
        model_id: "claude-sonnet-4-6".to_string(),
        source_model_id: None,
        base_url: None,
        context_limit: None,
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: None,
        thinking_level: Some("extreme".to_string()),
        auth_mode: None,
    }))
    .unwrap_err();
    assert_eq!(
        error,
        "providerConfig.thinkingLevel is not supported: extreme"
    );
}

#[test]
fn normalize_provider_config_rejects_invalid_base_url() {
    let error = normalize_provider_config(Some(PiProviderConfig {
        provider: "openai-compatible".to_string(),
        model_id: "qwen3-max".to_string(),
        source_model_id: None,
        base_url: Some("file:///tmp/model".to_string()),
        context_limit: Some(128_000),
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: Some("abc123".to_string()),
        thinking_level: None,
        auth_mode: None,
    }))
    .unwrap_err();

    assert_eq!(
        error,
        "providerConfig.baseUrl must start with http:// or https://"
    );
}

#[test]
fn provider_key_account_uses_existing_keyring_accounts() {
    let cloud = normalize_provider_config(Some(PiProviderConfig {
        provider: "anthropic".to_string(),
        model_id: "claude-sonnet-4-6".to_string(),
        source_model_id: None,
        base_url: None,
        context_limit: None,
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: None,
        thinking_level: None,
        auth_mode: None,
    }))
    .unwrap()
    .unwrap();
    let custom = normalize_provider_config(Some(PiProviderConfig {
        provider: "openai-compatible".to_string(),
        model_id: "qwen3-max".to_string(),
        source_model_id: None,
        base_url: Some("https://gateway.example.com/v1".to_string()),
        context_limit: Some(128_000),
        max_tokens: None,
        reasoning: None,
        custom_endpoint_id: Some("abc123".to_string()),
        thinking_level: None,
        auth_mode: None,
    }))
    .unwrap()
    .unwrap();

    assert_eq!(
        provider_key_account(&cloud).as_deref(),
        Some("anthropic-api-key")
    );
    assert_eq!(
        provider_key_account(&custom).as_deref(),
        Some("compat-abc123-api-key")
    );
}
