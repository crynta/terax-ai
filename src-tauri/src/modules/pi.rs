use std::sync::Mutex;

use serde::{Deserialize, Serialize};

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
    snapshot: Mutex<PiRuntimeSnapshot>,
}

impl PiState {
    pub fn snapshot(&self) -> Result<PiRuntimeSnapshot, String> {
        let snapshot = self.snapshot.lock().map_err(|e| e.to_string())?;
        Ok(snapshot.clone())
    }

    pub fn start_placeholder(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut snapshot = self.snapshot.lock().map_err(|e| e.to_string())?;
        *snapshot = PiRuntimeSnapshot {
            phase: PiPhase::Ready,
            detail: Some("Placeholder Pi runtime".to_string()),
        };
        Ok(snapshot.clone())
    }

    pub fn stop(&self) -> Result<PiRuntimeSnapshot, String> {
        let mut snapshot = self.snapshot.lock().map_err(|e| e.to_string())?;
        *snapshot = PiRuntimeSnapshot::default();
        Ok(snapshot.clone())
    }
}

#[tauri::command]
pub async fn pi_status(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub async fn pi_start(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.start_placeholder()
}

#[tauri::command]
pub async fn pi_stop(state: tauri::State<'_, PiState>) -> Result<PiRuntimeSnapshot, String> {
    state.stop()
}
