use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

mod host;

use host::PiHost;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeSnapshot {
    pub phase: PiPhase,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiPhase {
    Disconnected,
    Starting,
    Ready,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiHostInfo {
    pub host_version: String,
    pub pi_sdk_loaded: bool,
    pub pi_packages: Vec<PiPackageInfo>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageInfo {
    pub name: String,
    pub version: Option<String>,
    pub loaded: bool,
    pub export_count: usize,
    pub error: Option<String>,
}

impl Default for PiRuntimeSnapshot {
    fn default() -> Self {
        Self {
            phase: PiPhase::Disconnected,
            detail: None,
        }
    }
}

#[derive(Default)]
pub struct PiState {
    host: Mutex<Option<PiHost>>,
}

impl PiState {
    pub fn snapshot(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut guard = self.host.lock().map_err(|e| e.to_string())?;
        let Some(host) = guard.as_mut() else {
            return Ok(PiRuntimeSnapshot::default());
        };

        match host.status() {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                *guard = None;
                Ok(error_snapshot(error))
            }
        }
    }

    pub fn start(&self) -> Result<PiRuntimeSnapshot, String> {
        self.start_with_resource_dir(None)
    }

    pub fn start_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> Result<PiRuntimeSnapshot, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(PiHost::spawn(resource_dir)?);
        }
        host.as_mut()
            .ok_or_else(|| "Pi host was not initialized".to_string())?
            .status()
    }

    pub fn info(&self) -> Result<PiHostInfo, String> {
        self.info_with_resource_dir(None)
    }

    pub fn info_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> Result<PiHostInfo, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(PiHost::spawn(resource_dir)?);
        }
        host.as_mut()
            .ok_or_else(|| "Pi host was not initialized".to_string())?
            .info()
    }

    pub fn stop(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if let Some(host) = host.take() {
            host.shutdown();
        }
        Ok(PiRuntimeSnapshot::default())
    }
}

fn error_snapshot(detail: String) -> PiRuntimeSnapshot {
    PiRuntimeSnapshot {
        phase: PiPhase::Error,
        detail: Some(detail),
    }
}

fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

#[tauri::command]
pub async fn pi_status(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub async fn pi_start(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    state.start_with_resource_dir(resource_dir(&app).as_deref())
}

#[tauri::command]
pub async fn pi_stop(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.stop()
}

#[tauri::command]
pub async fn pi_host_info(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiHostInfo, String> {
    state.info_with_resource_dir(resource_dir(&app).as_deref())
}
