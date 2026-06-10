use std::env;
use std::path::PathBuf;

use tauri::AppHandle;

use crate::modules::secrets::{self, SecretsState};

use super::types::{PiAuthMode, PiProviderConfig, PiResolvedProviderConfig};

const KEYRING_SERVICE: &str = "terax-ai";
const MIN_CONTEXT_LIMIT: u32 = 1_000;
const SUPPORTED_THINKING_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh"];
const SUPPORTED_PROVIDERS: &[&str] = &[
    "openai",
    "anthropic",
    "google",
    "xai",
    "cerebras",
    "groq",
    "deepseek",
    "mistral",
    "openrouter",
    "openai-compatible",
    "lmstudio",
    "mlx",
    "ollama",
];

fn provider_label(provider: &str) -> &str {
    match provider {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "google" => "Google",
        "xai" => "xAI",
        "cerebras" => "Cerebras",
        "groq" => "Groq",
        "deepseek" => "DeepSeek",
        "mistral" => "Mistral",
        "openrouter" => "OpenRouter",
        "openai-compatible" => "OpenAI Compatible",
        "lmstudio" => "LM Studio",
        "mlx" => "MLX",
        "ollama" => "Ollama",
        _ => "provider",
    }
}

fn provider_requires_key(provider: &str) -> bool {
    !matches!(
        provider,
        "lmstudio" | "mlx" | "ollama" | "openai-compatible"
    )
}

pub(super) fn provider_key_account(config: &PiResolvedProviderConfig) -> Option<String> {
    if config.auth_mode != PiAuthMode::Terax {
        return None;
    }
    if config.provider == "openai-compatible" {
        return Some(match config.custom_endpoint_id.as_deref() {
            Some(endpoint_id) => format!("compat-{endpoint_id}-api-key"),
            None => "openai-compatible-api-key".to_string(),
        });
    }

    match config.provider.as_str() {
        "openai" => Some("openai-api-key".to_string()),
        "anthropic" => Some("anthropic-api-key".to_string()),
        "google" => Some("google-api-key".to_string()),
        "xai" => Some("xai-api-key".to_string()),
        "cerebras" => Some("cerebras-api-key".to_string()),
        "groq" => Some("groq-api-key".to_string()),
        "deepseek" => Some("deepseek-api-key".to_string()),
        "mistral" => Some("mistral-api-key".to_string()),
        "openrouter" => Some("openrouter-api-key".to_string()),
        _ => None,
    }
}

fn normalize_required_config_string(value: String, name: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("providerConfig.{name} must be a non-empty string"));
    }
    if trimmed.contains('\r') || trimmed.contains('\n') {
        return Err(format!("providerConfig.{name} must not contain newlines"));
    }
    Ok(trimmed)
}

fn normalize_optional_config_string(
    value: Option<String>,
    name: &str,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.contains('\r') || trimmed.contains('\n') {
        return Err(format!("providerConfig.{name} must not contain newlines"));
    }
    Ok(Some(trimmed))
}

fn normalize_base_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(base_url) = normalize_optional_config_string(value, "baseUrl")? else {
        return Ok(None);
    };
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("providerConfig.baseUrl must start with http:// or https://".to_string());
    }
    Ok(Some(base_url))
}

fn normalize_thinking_level(value: Option<String>) -> Result<Option<String>, String> {
    let Some(level) = normalize_optional_config_string(value, "thinkingLevel")? else {
        return Ok(None);
    };
    if !SUPPORTED_THINKING_LEVELS.contains(&level.as_str()) {
        return Err(format!(
            "providerConfig.thinkingLevel is not supported: {level}"
        ));
    }
    Ok(Some(level))
}

pub(super) fn normalize_provider_config(
    config: Option<PiProviderConfig>,
) -> Result<Option<PiResolvedProviderConfig>, String> {
    let Some(config) = config else {
        return Ok(None);
    };
    let auth_mode = config.auth_mode.unwrap_or_default();
    let provider = normalize_required_config_string(config.provider, "provider")?;
    if auth_mode == PiAuthMode::Terax && !SUPPORTED_PROVIDERS.contains(&provider.as_str()) {
        return Err(format!(
            "providerConfig.provider is not supported: {provider}"
        ));
    }
    if let Some(limit) = config.context_limit {
        if limit < MIN_CONTEXT_LIMIT {
            return Err(format!(
                "providerConfig.contextLimit must be at least {MIN_CONTEXT_LIMIT}"
            ));
        }
    }
    if let Some(max_tokens) = config.max_tokens {
        if max_tokens == 0 {
            return Err("providerConfig.maxTokens must be a positive integer".to_string());
        }
        if let Some(limit) = config.context_limit {
            if max_tokens > limit {
                return Err("providerConfig.maxTokens must not exceed contextLimit".to_string());
            }
        }
    }

    Ok(Some(PiResolvedProviderConfig {
        auth_mode,
        provider,
        model_id: normalize_required_config_string(config.model_id, "modelId")?,
        source_model_id: normalize_optional_config_string(config.source_model_id, "sourceModelId")?,
        base_url: normalize_base_url(config.base_url)?,
        context_limit: config.context_limit,
        max_tokens: config.max_tokens,
        reasoning: config.reasoning,
        custom_endpoint_id: normalize_optional_config_string(
            config.custom_endpoint_id,
            "customEndpointId",
        )?,
        thinking_level: normalize_thinking_level(config.thinking_level)?,
        profile_agent_dir: None,
        api_key: None,
    }))
}

fn expand_home_path(path: &str) -> Result<PathBuf, String> {
    if path == "~" {
        return dirs::home_dir().ok_or_else(|| "home directory not available".to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or_else(|| "home directory not available".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(path))
}

pub(super) fn default_pi_agent_dir() -> Result<String, String> {
    let raw = env::var("PI_CODING_AGENT_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let path = match raw {
        Some(value) => expand_home_path(&value)?,
        None => dirs::home_dir()
            .ok_or_else(|| "home directory not available".to_string())?
            .join(".pi")
            .join("agent"),
    };
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Pi profile directory not found at {}: {e}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Pi profile path is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(crate::modules::fs::to_canon(canonical))
}

pub(super) fn resolve_provider_config(
    app: &AppHandle,
    secrets_state: &SecretsState,
    config: Option<PiProviderConfig>,
) -> Result<Option<PiResolvedProviderConfig>, String> {
    let Some(mut config) = normalize_provider_config(config)? else {
        return Ok(None);
    };

    if config.auth_mode == PiAuthMode::Profile {
        config.profile_agent_dir = Some(default_pi_agent_dir()?);
        return Ok(Some(config));
    }

    if let Some(account) = provider_key_account(&config) {
        let api_key = secrets::get_secret_value(app, secrets_state, KEYRING_SERVICE, &account)?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if api_key.is_none() && provider_requires_key(&config.provider) {
            return Err(format!(
                "No API key configured for {}. Open Settings > Models.",
                provider_label(&config.provider)
            ));
        }
        config.api_key = api_key;
    }

    Ok(Some(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_label_returns_known_names() {
        assert_eq!(provider_label("openai"), "OpenAI");
        assert_eq!(provider_label("anthropic"), "Anthropic");
        assert_eq!(provider_label("unknown"), "provider");
    }

    #[test]
    fn provider_requires_key_true_for_major_providers() {
        assert!(provider_requires_key("openai"));
        assert!(provider_requires_key("anthropic"));
        assert!(!provider_requires_key("ollama"));
        assert!(!provider_requires_key("lmstudio"));
        assert!(!provider_requires_key("openai-compatible"));
    }

    #[test]
    fn normalize_required_config_string_trims_and_validates() {
        assert_eq!(
            normalize_required_config_string("  hello  ".into(), "f").unwrap(),
            "hello"
        );
        assert!(normalize_required_config_string("".into(), "f").is_err());
        assert!(normalize_required_config_string("  ".into(), "f").is_err());
        assert!(normalize_required_config_string("a\nb".into(), "f").is_err());
        assert!(normalize_required_config_string("a\rb".into(), "f").is_err());
    }

    #[test]
    fn normalize_optional_config_string_trims_and_returns_none_for_empty() {
        assert_eq!(
            normalize_optional_config_string(Some("  val  ".into()), "f").unwrap(),
            Some("val".to_string())
        );
        assert_eq!(
            normalize_optional_config_string(None, "f").unwrap(),
            None
        );
        assert_eq!(
            normalize_optional_config_string(Some("  ".into()), "f").unwrap(),
            None
        );
        assert!(normalize_optional_config_string(Some("a\nb".into()), "f").is_err());
    }

    #[test]
    fn normalize_base_url_requires_http_scheme() {
        assert!(normalize_base_url(Some("https://api.example.com".into())).is_ok());
        assert!(normalize_base_url(Some("http://localhost:8080".into())).is_ok());
        assert!(normalize_base_url(Some("ftp://example.com".into())).is_err());
        assert!(normalize_base_url(None).unwrap().is_none());
    }

    #[test]
    fn normalize_thinking_level_validates_against_allowlist() {
        assert!(normalize_thinking_level(Some("high".into())).is_ok());
        assert!(normalize_thinking_level(Some("off".into())).is_ok());
        assert!(normalize_thinking_level(Some("invalid".into())).is_err());
        assert!(normalize_thinking_level(None).unwrap().is_none());
    }

    #[test]
    fn normalize_provider_config_rejects_unsupported_provider() {
        let config = PiProviderConfig {
            provider: "unsupported_provider".into(),
            model_id: "model".into(),
            auth_mode: Some(PiAuthMode::Terax),
            ..Default::default()
        };
        let err = normalize_provider_config(Some(config)).unwrap_err();
        assert!(err.contains("not supported"));
    }

    #[test]
    fn normalize_provider_config_rejects_low_context_limit() {
        let config = PiProviderConfig {
            provider: "openai".into(),
            model_id: "model".into(),
            auth_mode: Some(PiAuthMode::Terax),
            context_limit: Some(500),
            ..Default::default()
        };
        let err = normalize_provider_config(Some(config)).unwrap_err();
        assert!(err.contains("contextLimit"));
    }

    #[test]
    fn normalize_provider_config_rejects_zero_max_tokens() {
        let config = PiProviderConfig {
            provider: "openai".into(),
            model_id: "model".into(),
            auth_mode: Some(PiAuthMode::Terax),
            max_tokens: Some(0),
            ..Default::default()
        };
        let err = normalize_provider_config(Some(config)).unwrap_err();
        assert!(err.contains("maxTokens"));
    }

    #[test]
    fn normalize_provider_config_rejects_max_tokens_exceeding_context() {
        let config = PiProviderConfig {
            provider: "openai".into(),
            model_id: "model".into(),
            auth_mode: Some(PiAuthMode::Terax),
            context_limit: Some(10_000),
            max_tokens: Some(20_000),
            ..Default::default()
        };
        let err = normalize_provider_config(Some(config)).unwrap_err();
        assert!(err.contains("maxTokens"));
    }

    #[test]
    fn normalize_provider_config_none_returns_none() {
        assert!(normalize_provider_config(None).unwrap().is_none());
    }

    #[test]
    fn provider_key_account_returns_correct_accounts() {
        let config = PiResolvedProviderConfig {
            auth_mode: PiAuthMode::Terax,
            provider: "openai".into(),
            ..Default::default()
        };
        assert_eq!(provider_key_account(&config), Some("openai-api-key".into()));

        let config = PiResolvedProviderConfig {
            auth_mode: PiAuthMode::Terax,
            provider: "anthropic".into(),
            ..Default::default()
        };
        assert_eq!(
            provider_key_account(&config),
            Some("anthropic-api-key".into())
        );
    }

    #[test]
    fn provider_key_account_returns_none_for_non_terax_auth() {
        let config = PiResolvedProviderConfig {
            auth_mode: PiAuthMode::Profile,
            provider: "openai".into(),
            ..Default::default()
        };
        assert!(provider_key_account(&config).is_none());
    }

    #[test]
    fn provider_key_account_openai_compatible_uses_endpoint_id() {
        let config = PiResolvedProviderConfig {
            auth_mode: PiAuthMode::Terax,
            provider: "openai-compatible".into(),
            custom_endpoint_id: Some("my-endpoint".into()),
            ..Default::default()
        };
        assert_eq!(
            provider_key_account(&config),
            Some("compat-my-endpoint-api-key".into())
        );

        let config = PiResolvedProviderConfig {
            auth_mode: PiAuthMode::Terax,
            provider: "openai-compatible".into(),
            custom_endpoint_id: None,
            ..Default::default()
        };
        assert_eq!(
            provider_key_account(&config),
            Some("openai-compatible-api-key".into())
        );
    }
}
