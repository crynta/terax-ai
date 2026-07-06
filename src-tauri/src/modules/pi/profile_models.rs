use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::{PiProfileModelInfo, PiProfileModelsList};

const MAX_PROFILE_MODELS: usize = 500;

pub(super) fn default_profile_agent_dir() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".pi").join("agent"))
        .unwrap_or_default()
}

pub(super) fn list_from_dir(profile_agent_dir: &Path) -> PiProfileModelsList {
    let models_path = profile_agent_dir.join("models.json");
    let (models, load_error) = match fs::read_to_string(&models_path) {
        Ok(content) => match parse_models_json(&content) {
            Ok(models) => (models, None),
            Err(error) => (Vec::new(), Some(error)),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            Vec::new(),
            Some("Pi profile models.json was not found".to_string()),
        ),
        Err(error) => (
            Vec::new(),
            Some(format!("failed to read models.json: {error}")),
        ),
    };

    PiProfileModelsList {
        profile_agent_dir: crate::modules::fs::to_canon(profile_agent_dir),
        load_error,
        models,
    }
}

fn parse_models_json(content: &str) -> Result<Vec<PiProfileModelInfo>, String> {
    let value: Value = serde_json::from_str(content).map_err(|error| error.to_string())?;
    let providers = value
        .get("providers")
        .and_then(Value::as_object)
        .ok_or_else(|| "models.json does not contain a providers object".to_string())?;

    let mut models = Vec::new();
    for (provider_id, provider) in providers {
        let Some(provider_object) = provider.as_object() else {
            continue;
        };
        let provider_label = provider_label(provider_id, provider_object);
        match provider_object.get("models") {
            Some(Value::Array(items)) => {
                for item in items {
                    if let Some(model) = parse_model(provider_id, &provider_label, None, item) {
                        models.push(model);
                    }
                    if models.len() >= MAX_PROFILE_MODELS {
                        return Ok(sorted_models(models));
                    }
                }
            }
            Some(Value::Object(items)) => {
                for (model_id, item) in items {
                    if let Some(model) =
                        parse_model(provider_id, &provider_label, Some(model_id.as_str()), item)
                    {
                        models.push(model);
                    }
                    if models.len() >= MAX_PROFILE_MODELS {
                        return Ok(sorted_models(models));
                    }
                }
            }
            _ => {}
        }
    }

    Ok(sorted_models(models))
}

fn sorted_models(mut models: Vec<PiProfileModelInfo>) -> Vec<PiProfileModelInfo> {
    models.sort_by(|a, b| {
        a.provider_label
            .cmp(&b.provider_label)
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.id.cmp(&b.id))
    });
    models
}

fn provider_label(provider_id: &str, provider: &Map<String, Value>) -> String {
    string_field(provider, &["label", "name", "displayName"])
        .unwrap_or_else(|| humanize(provider_id))
}

fn parse_model(
    provider_id: &str,
    provider_label: &str,
    fallback_id: Option<&str>,
    value: &Value,
) -> Option<PiProfileModelInfo> {
    let object = value.as_object()?;
    let id =
        string_field(object, &["id", "modelId"]).or_else(|| fallback_id.map(str::to_string))?;
    let label =
        string_field(object, &["label", "name", "displayName"]).unwrap_or_else(|| id.clone());
    let provider = string_field(object, &["provider"]).unwrap_or_else(|| provider_id.to_string());

    Some(PiProfileModelInfo {
        provider,
        provider_label: provider_label.to_string(),
        id,
        label,
        available: bool_field(object, &["available", "enabled"]).unwrap_or(true),
        context_window: u32_field(object, &["contextWindow", "context_window"]),
        max_tokens: u32_field(object, &["maxTokens", "max_tokens"]),
        reasoning: bool_field(object, &["reasoning", "supportsReasoning", "thinking"])
            .unwrap_or(false),
    })
}

fn string_field(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key)?.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn bool_field(object: &Map<String, Value>, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| object.get(*key)?.as_bool())
}

fn u32_field(object: &Map<String, Value>, keys: &[&str]) -> Option<u32> {
    keys.iter()
        .find_map(|key| object.get(*key)?.as_u64())
        .and_then(|value| u32::try_from(value).ok())
}

fn humanize(value: &str) -> String {
    let label = value
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if label.is_empty() {
        value.to_string()
    } else {
        label
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_profile_models_without_returning_provider_secrets() {
        let content = r#"
        {
          "providers": {
            "groq": {
              "apiKey": "sk-secret",
              "models": [
                {
                  "id": "groq/compound",
                  "name": "Groq Compound",
                  "contextWindow": 131072,
                  "maxTokens": 8192,
                  "reasoning": true
                }
              ]
            }
          }
        }
        "#;

        let models = parse_models_json(content).expect("parse");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].provider, "groq");
        assert_eq!(models[0].provider_label, "Groq");
        assert_eq!(models[0].id, "groq/compound");
        assert_eq!(models[0].label, "Groq Compound");
        assert_eq!(models[0].context_window, Some(131072));
        assert_eq!(models[0].max_tokens, Some(8192));
        assert!(models[0].reasoning);
        assert!(!serde_json::to_string(&models)
            .expect("json")
            .contains("sk-secret"));
    }

    #[test]
    fn parses_object_shaped_model_maps() {
        let content = r#"
        {
          "providers": {
            "anthropic": {
              "label": "Anthropic",
              "models": {
                "claude-sonnet": {
                  "label": "Claude Sonnet",
                  "available": false
                }
              }
            }
          }
        }
        "#;

        let models = parse_models_json(content).expect("parse");

        assert_eq!(models[0].provider, "anthropic");
        assert_eq!(models[0].provider_label, "Anthropic");
        assert_eq!(models[0].id, "claude-sonnet");
        assert_eq!(models[0].label, "Claude Sonnet");
        assert!(!models[0].available);
    }
}
