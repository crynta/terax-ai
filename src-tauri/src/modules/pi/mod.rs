use std::sync::Mutex;

use serde::{Deserialize, Serialize};

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
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(PiHost::spawn()?);
        }
        host.as_mut()
            .ok_or_else(|| "Pi host was not initialized".to_string())?
            .status()
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

#[tauri::command]
pub async fn pi_status(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub async fn pi_start(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.start()
}

#[tauri::command]
pub async fn pi_stop(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.stop()
}
