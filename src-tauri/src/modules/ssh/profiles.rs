use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_KEY: &str = "ssh_profiles";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: AuthMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_fingerprint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Key,
    Agent,
}

#[tauri::command]
pub fn ssh_profile_list(app: tauri::AppHandle) -> Result<Vec<SshProfile>, String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let profiles = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(profiles)
}

#[tauri::command]
pub fn ssh_profile_save(app: tauri::AppHandle, profile: SshProfile) -> Result<SshProfile, String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let mut profiles: Vec<SshProfile> = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    if let Some(existing) = profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile.clone();
    } else {
        profiles.push(profile.clone());
    }
    store.set(STORE_KEY, serde_json::to_value(&profiles).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn ssh_profile_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let mut profiles: Vec<SshProfile> = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    profiles.retain(|p| p.id != id);
    store.set(STORE_KEY, serde_json::to_value(&profiles).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

pub fn update_fingerprint(app: &tauri::AppHandle, id: &str, fingerprint: String) -> Result<(), String> {
    let store = app.store("terax.json").map_err(|e| e.to_string())?;
    let mut profiles: Vec<SshProfile> = store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    if let Some(p) = profiles.iter_mut().find(|p| p.id == id) {
        p.known_fingerprint = Some(fingerprint);
    }
    store.set(STORE_KEY, serde_json::to_value(&profiles).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_profile_serde_round_trip_key_auth() {
        let profile = SshProfile {
            id: "abc-123".into(),
            name: "prod".into(),
            host: "example.com".into(),
            port: 22,
            user: "alice".into(),
            auth_method: AuthMethod::Key,
            key_path: Some("/home/alice/.ssh/id_ed25519".into()),
            known_fingerprint: Some("SHA256:abc123".into()),
        };
        let json = serde_json::to_string(&profile).unwrap();
        let back: SshProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, profile.id);
        assert_eq!(back.host, profile.host);
        assert_eq!(back.port, profile.port);
        assert!(matches!(back.auth_method, AuthMethod::Key));
        assert_eq!(back.key_path, profile.key_path);
        assert_eq!(back.known_fingerprint, profile.known_fingerprint);
    }

    #[test]
    fn ssh_profile_serde_round_trip_agent_auth() {
        let profile = SshProfile {
            id: "xyz-456".into(),
            name: "dev".into(),
            host: "dev.internal".into(),
            port: 2222,
            user: "bob".into(),
            auth_method: AuthMethod::Agent,
            key_path: None,
            known_fingerprint: None,
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert!(!json.contains("keyPath"));
        assert!(!json.contains("knownFingerprint"));
        let back: SshProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, profile.id);
        assert!(matches!(back.auth_method, AuthMethod::Agent));
        assert_eq!(back.key_path, None);
    }

    #[test]
    fn auth_method_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&AuthMethod::Key).unwrap(), "\"key\"");
        assert_eq!(serde_json::to_string(&AuthMethod::Agent).unwrap(), "\"agent\"");
    }
}
