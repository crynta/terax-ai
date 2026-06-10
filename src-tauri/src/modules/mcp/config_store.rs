use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::modules::capabilities::ApprovalPolicy;

use super::sanitize::{
    is_safe_env_name, parse_qualified_tool_name, sanitize_server_id, sanitize_text_token,
    validate_config_text, validate_http_url,
};
use super::{
    McpEnvVar, McpServerConfig, McpState, McpStoredEnvVar, McpStoredServerConfig,
    McpToolPreference, McpTransport, MCP_NAME_LIMIT, MCP_STORED_ARG_LIMIT,
    MCP_STORED_CONFIG_MAX_BYTES, MCP_STORED_ENV_LIMIT, MCP_STORED_SERVER_LIMIT,
    MCP_STORED_TEXT_LIMIT, MCP_TOOL_PREFERENCES_MAX_BYTES, MCP_TOOL_PREFERENCE_LIMIT,
};

pub fn mcp_server_configs_list_at_path(path: &Path) -> Result<Vec<McpStoredServerConfig>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MCP_STORED_CONFIG_MAX_BYTES {
        return Err("MCP server config store is too large".to_string());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let records: Vec<McpStoredServerConfig> =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    let mut sanitized = records
        .into_iter()
        .take(MCP_STORED_SERVER_LIMIT)
        .map(sanitize_stored_server_config)
        .collect::<Result<Vec<_>, _>>()?;
    sanitized.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(sanitized)
}

pub fn mcp_server_config_save_at_path(
    path: &Path,
    config: McpServerConfig,
) -> Result<McpStoredServerConfig, String> {
    let saved = sanitize_runtime_server_config(config)?;
    let mut records = mcp_server_configs_list_at_path(path)?;
    if let Some(existing) = records.iter_mut().find(|record| record.id == saved.id) {
        *existing = saved.clone();
    } else {
        if records.len() >= MCP_STORED_SERVER_LIMIT {
            return Err("MCP server config store is full".to_string());
        }
        records.push(saved.clone());
    }
    records.sort_by(|left, right| left.id.cmp(&right.id));
    write_server_configs_at_path(path, &records)?;
    Ok(saved)
}

pub fn mcp_server_config_remove_at_path(path: &Path, server_id: &str) -> Result<bool, String> {
    let server_id = sanitize_server_id(server_id)?;
    let mut records = mcp_server_configs_list_at_path(path)?;
    let before = records.len();
    records.retain(|record| record.id != server_id);
    let removed = records.len() != before;
    if removed {
        write_server_configs_at_path(path, &records)?;
    }
    Ok(removed)
}

pub fn mcp_tool_preferences_list_at_path(path: &Path) -> Result<Vec<McpToolPreference>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MCP_TOOL_PREFERENCES_MAX_BYTES {
        return Err("MCP tool preference store is too large".to_string());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let records: Vec<McpToolPreference> =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    let mut sanitized = records
        .into_iter()
        .take(MCP_TOOL_PREFERENCE_LIMIT)
        .map(sanitize_tool_preference)
        .collect::<Result<Vec<_>, _>>()?;
    sanitized.sort_by(|left, right| left.qualified_name.cmp(&right.qualified_name));
    Ok(sanitized)
}

pub fn mcp_tool_preference_set_at_path(
    path: &Path,
    qualified_name: &str,
    model_visible: bool,
) -> Result<McpToolPreference, String> {
    let approval_policy = if model_visible {
        ApprovalPolicy::Ask
    } else {
        ApprovalPolicy::Deny
    };
    mcp_tool_policy_set_at_path(path, qualified_name, approval_policy)
}

pub fn mcp_tool_policy_set_at_path(
    path: &Path,
    qualified_name: &str,
    approval_policy: ApprovalPolicy,
) -> Result<McpToolPreference, String> {
    let preference = sanitize_tool_preference(McpToolPreference {
        qualified_name: qualified_name.to_string(),
        model_visible: approval_policy != ApprovalPolicy::Deny,
        approval_policy,
    })?;
    let mut records = mcp_tool_preferences_list_at_path(path)?;
    if let Some(existing) = records
        .iter_mut()
        .find(|record| record.qualified_name == preference.qualified_name)
    {
        *existing = preference.clone();
    } else {
        if records.len() >= MCP_TOOL_PREFERENCE_LIMIT {
            return Err("MCP tool preference store is full".to_string());
        }
        records.push(preference.clone());
    }
    records.sort_by(|left, right| left.qualified_name.cmp(&right.qualified_name));
    write_tool_preferences_at_path(path, &records)?;
    Ok(preference)
}

pub fn mcp_connect_saved_stdio_at_path(
    state: &McpState,
    path: &Path,
    server_id: &str,
) -> Result<(), String> {
    mcp_connect_saved_stdio_at_path_with_env_loader(state, path, server_id, |_, env_name| {
        env::var(env_name).ok()
    })
}

pub fn mcp_connect_saved_stdio_at_path_with_env_loader<F>(
    state: &McpState,
    path: &Path,
    server_id: &str,
    env_loader: F,
) -> Result<(), String>
where
    F: Fn(&str, &str) -> Option<String>,
{
    let server_id = sanitize_server_id(server_id)?;
    let records = mcp_server_configs_list_at_path(path)?;
    let record = records
        .into_iter()
        .find(|record| record.id == server_id)
        .ok_or_else(|| format!("MCP server config is not saved: {server_id}"))?;
    state.connect_config(mcp_runtime_config_from_stored_with_env_loader(
        record, env_loader,
    ))
}

pub(super) fn mcp_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("mcp")
        .join("servers.json"))
}

pub(super) fn mcp_tool_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("mcp")
        .join("tool-preferences.json"))
}

pub(super) fn sync_tool_preferences_from_app(
    app: &AppHandle,
    state: &McpState,
) -> Result<(), String> {
    let preferences = mcp_tool_preferences_list_at_path(&mcp_tool_preferences_path(app)?)?;
    state.set_tool_preferences(preferences);
    Ok(())
}

pub(super) fn write_server_configs_at_path(
    path: &Path,
    records: &[McpStoredServerConfig],
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(records).map_err(|error| error.to_string())?;
    if content.len() as u64 > MCP_STORED_CONFIG_MAX_BYTES {
        return Err("MCP server config store is too large".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(super) fn write_tool_preferences_at_path(
    path: &Path,
    records: &[McpToolPreference],
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(records).map_err(|error| error.to_string())?;
    if content.len() as u64 > MCP_TOOL_PREFERENCES_MAX_BYTES {
        return Err("MCP tool preference store is too large".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn sanitize_tool_preference(preference: McpToolPreference) -> Result<McpToolPreference, String> {
    parse_qualified_tool_name(&preference.qualified_name)?;
    let approval_policy = if preference.model_visible {
        preference.approval_policy
    } else {
        ApprovalPolicy::Deny
    };
    Ok(McpToolPreference {
        qualified_name: preference.qualified_name,
        model_visible: approval_policy != ApprovalPolicy::Deny,
        approval_policy,
    })
}

fn sanitize_stored_server_config(
    record: McpStoredServerConfig,
) -> Result<McpStoredServerConfig, String> {
    sanitize_runtime_server_config(McpServerConfig {
        id: record.id,
        name: record.name,
        transport: record.transport,
        command: record.command,
        args: record.args,
        cwd: record.cwd,
        url: record.url,
        oauth_token_env: record.oauth_token_env,
        env: record
            .env
            .into_iter()
            .map(|env| McpEnvVar {
                name: env.name,
                value: String::new(),
            })
            .collect(),
    })
}

fn sanitize_runtime_server_config(
    config: McpServerConfig,
) -> Result<McpStoredServerConfig, String> {
    let id = sanitize_server_id(&config.id)?;
    let name = sanitize_text_token(&config.name, MCP_NAME_LIMIT);
    let name = if name.is_empty() { id.clone() } else { name };
    let (command, args, cwd, url) = match config.transport {
        McpTransport::Stdio => {
            let command = validate_config_text(
                &config.command,
                "MCP stdio command",
                MCP_STORED_TEXT_LIMIT,
                false,
                true,
            )?;
            if config.args.len() > MCP_STORED_ARG_LIMIT {
                return Err("MCP stdio config has too many arguments".to_string());
            }
            let args = config
                .args
                .iter()
                .map(|arg| {
                    validate_config_text(
                        arg,
                        "MCP stdio argument",
                        MCP_STORED_TEXT_LIMIT,
                        true,
                        false,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            let cwd = config
                .cwd
                .as_deref()
                .map(str::trim)
                .filter(|cwd| !cwd.is_empty())
                .map(|cwd| {
                    validate_config_text(cwd, "MCP stdio cwd", MCP_STORED_TEXT_LIMIT, false, false)
                })
                .transpose()?;
            (command, args, cwd, None)
        }
        McpTransport::Http => {
            let url = validate_http_url(config.url.as_deref())?;
            (String::new(), Vec::new(), None, Some(url))
        }
    };
    if config.env.len() > MCP_STORED_ENV_LIMIT {
        return Err("MCP config has too many env vars".to_string());
    }
    let oauth_token_env = config
        .oauth_token_env
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| {
            if is_safe_env_name(name) {
                Ok(name.to_string())
            } else {
                Err("MCP OAuth token env name is not allowed".to_string())
            }
        })
        .transpose()?;
    let mut env = Vec::new();
    for item in &config.env {
        let name = item.name.trim();
        if is_safe_env_name(name)
            && !env
                .iter()
                .any(|existing: &McpStoredEnvVar| existing.name == name)
        {
            env.push(McpStoredEnvVar {
                name: name.to_string(),
            });
        }
    }
    if let Some(name) = oauth_token_env.as_deref() {
        if !env.iter().any(|existing| existing.name == name) {
            env.push(McpStoredEnvVar {
                name: name.to_string(),
            });
        }
    }
    env.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(McpStoredServerConfig {
        id,
        name,
        transport: config.transport,
        command,
        args,
        cwd,
        url,
        oauth_token_env,
        env,
    })
}

pub fn mcp_runtime_config_from_stored_with_env_loader<F>(
    record: McpStoredServerConfig,
    env_loader: F,
) -> McpServerConfig
where
    F: Fn(&str, &str) -> Option<String>,
{
    let server_id = record.id.clone();
    let env = record
        .env
        .into_iter()
        .filter_map(|item| {
            env_loader(&server_id, &item.name).map(|value| McpEnvVar {
                name: item.name,
                value,
            })
        })
        .collect();
    McpServerConfig {
        id: record.id,
        name: record.name,
        transport: record.transport,
        command: record.command,
        args: record.args,
        cwd: record.cwd,
        url: record.url,
        oauth_token_env: record.oauth_token_env,
        env,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::capabilities::ApprovalPolicy;
    use crate::modules::mcp::McpTransport;

    fn stored_stdio(id: &str, env_names: &[&str]) -> McpStoredServerConfig {
        McpStoredServerConfig {
            id: id.to_string(),
            name: id.to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: env_names
                .iter()
                .map(|name| McpStoredEnvVar {
                    name: name.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn sanitize_tool_preference_rejects_invalid_qualified_name() {
        let pref = McpToolPreference {
            qualified_name: "bad_name".to_string(),
            model_visible: true,
            approval_policy: ApprovalPolicy::Ask,
        };
        assert!(sanitize_tool_preference(pref).is_err());
    }

    #[test]
    fn sanitize_tool_preference_forces_deny_when_not_visible() {
        let pref = McpToolPreference {
            qualified_name: "mcp__srv__tool".to_string(),
            model_visible: false,
            approval_policy: ApprovalPolicy::Ask,
        };
        let result = sanitize_tool_preference(pref).unwrap();
        assert_eq!(result.approval_policy, ApprovalPolicy::Deny);
        assert!(!result.model_visible);
    }

    #[test]
    fn sanitize_tool_preference_keeps_ask_when_visible() {
        let pref = McpToolPreference {
            qualified_name: "mcp__srv__tool".to_string(),
            model_visible: true,
            approval_policy: ApprovalPolicy::Ask,
        };
        let result = sanitize_tool_preference(pref).unwrap();
        assert_eq!(result.approval_policy, ApprovalPolicy::Ask);
        assert!(result.model_visible);
    }

    #[test]
    fn sanitize_runtime_server_config_rejects_bad_id() {
        let config = McpServerConfig {
            id: "".to_string(),
            name: "test".to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![],
        };
        assert!(sanitize_runtime_server_config(config).is_err());
    }

    #[test]
    fn sanitize_runtime_server_config_valid_stdio() {
        let config = McpServerConfig {
            id: "my_server".to_string(),
            name: "My Server".to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![],
        };
        let stored = sanitize_runtime_server_config(config).unwrap();
        assert_eq!(stored.id, "my_server");
        assert_eq!(stored.name, "My Server");
        assert_eq!(stored.transport, McpTransport::Stdio);
        assert_eq!(stored.url, None);
    }

    #[test]
    fn sanitize_runtime_server_config_valid_http() {
        let config = McpServerConfig {
            id: "http_srv".to_string(),
            name: "HTTP".to_string(),
            transport: McpTransport::Http,
            command: String::new(),
            args: vec![],
            cwd: None,
            url: Some("https://api.example.com/mcp".to_string()),
            oauth_token_env: None,
            env: vec![],
        };
        let stored = sanitize_runtime_server_config(config).unwrap();
        assert_eq!(stored.url.as_deref(), Some("https://api.example.com/mcp"));
        assert!(stored.command.is_empty());
    }

    #[test]
    fn sanitize_runtime_server_config_filters_unsafe_env_names() {
        let config = McpServerConfig {
            id: "srv".to_string(),
            name: "S".to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![
                McpEnvVar {
                    name: "GOOD_VAR".to_string(),
                    value: "val".to_string(),
                },
                McpEnvVar {
                    name: "bad-name".to_string(),
                    value: "val".to_string(),
                },
                McpEnvVar {
                    name: "TERAX_SECRET".to_string(),
                    value: "val".to_string(),
                },
            ],
        };
        let stored = sanitize_runtime_server_config(config).unwrap();
        assert_eq!(stored.env.len(), 1);
        assert_eq!(stored.env[0].name, "GOOD_VAR");
    }

    #[test]
    fn sanitize_runtime_server_config_deduplicates_env() {
        let config = McpServerConfig {
            id: "srv".to_string(),
            name: "S".to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![
                McpEnvVar {
                    name: "MY_VAR".to_string(),
                    value: "1".to_string(),
                },
                McpEnvVar {
                    name: "MY_VAR".to_string(),
                    value: "2".to_string(),
                },
            ],
        };
        let stored = sanitize_runtime_server_config(config).unwrap();
        assert_eq!(stored.env.len(), 1);
    }

    #[test]
    fn runtime_config_from_stored_injects_env_values() {
        let record = stored_stdio("srv", &["API_KEY", "OPTIONAL"]);
        let config = mcp_runtime_config_from_stored_with_env_loader(record, |_server_id, name| {
            if name == "API_KEY" {
                Some("secret123".to_string())
            } else {
                None
            }
        });
        assert_eq!(config.env.len(), 1);
        assert_eq!(config.env[0].name, "API_KEY");
        assert_eq!(config.env[0].value, "secret123");
    }

    #[test]
    fn list_at_path_empty_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("servers.json");
        std::fs::write(&path, "").unwrap();
        let result = mcp_server_configs_list_at_path(&path).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn list_at_path_missing_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = mcp_server_configs_list_at_path(&path).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn save_and_list_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("servers.json");
        let config = McpServerConfig {
            id: "test_srv".to_string(),
            name: "Test".to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![],
        };
        let saved = mcp_server_config_save_at_path(&path, config).unwrap();
        assert_eq!(saved.id, "test_srv");

        let list = mcp_server_configs_list_at_path(&path).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "test_srv");
    }

    #[test]
    fn remove_returns_false_for_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("servers.json");
        let config = McpServerConfig {
            id: "srv1".to_string(),
            name: "S".to_string(),
            transport: McpTransport::Stdio,
            command: "echo".to_string(),
            args: vec![],
            cwd: None,
            url: None,
            oauth_token_env: None,
            env: vec![],
        };
        mcp_server_config_save_at_path(&path, config).unwrap();
        assert!(!mcp_server_config_remove_at_path(&path, "nope").unwrap());
        assert!(mcp_server_config_remove_at_path(&path, "srv1").unwrap());
        assert!(mcp_server_configs_list_at_path(&path).unwrap().is_empty());
    }
}
