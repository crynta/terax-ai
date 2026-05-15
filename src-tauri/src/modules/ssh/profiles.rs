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
