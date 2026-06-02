use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

mod host;
mod store;

use host::{PiHost, PiSessionEventSink};

pub const PI_SESSION_EVENT_NAME: &str = "pi:session-event";

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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDiagnostics {
    pub host_version: String,
    pub pi_sdk_loaded: bool,
    pub pi_packages: Vec<PiPackageInfo>,
    pub node: PiNodeDiagnostics,
    pub config: PiConfigDiagnostics,
    pub sessions: Vec<PiDiagnosticSession>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiNodeDiagnostics {
    pub version: String,
    pub exec_path: String,
    pub platform: String,
    pub arch: String,
    pub pid: u32,
    pub cwd: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiConfigDiagnostics {
    pub tool_mode: String,
    pub session_storage: String,
    pub api_keys: Vec<PiEnvVarStatus>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiEnvVarStatus {
    pub name: String,
    pub configured: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDiagnosticSession {
    pub id: String,
    pub title: String,
    pub status: String,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSession {
    pub id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_prompt: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub session_id: String,
    pub created_at: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionsList {
    pub sessions: Vec<PiSession>,
    #[serde(default)]
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionCreateResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionSendResult {
    pub accepted: bool,
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionStopResult {
    pub session: PiSession,
    pub events: Vec<PiSessionEvent>,
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
    fn with_host<R>(
        &self,
        resource_dir: Option<&Path>,
        action: impl FnOnce(&mut PiHost) -> Result<R, String>,
    ) -> Result<R, String> {
        self.with_host_event_sink(resource_dir, None, action)
    }

    fn with_host_event_sink<R>(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        action: impl FnOnce(&mut PiHost) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(PiHost::spawn_with_event_sink(resource_dir, event_sink)?);
        }
        match action(
            host.as_mut()
                .ok_or_else(|| "Pi host was not initialized".to_string())?,
        ) {
            Ok(result) => Ok(result),
            Err(error) => {
                *host = None;
                Err(error)
            }
        }
    }

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
        self.start_with_resource_dir_and_event_sink(resource_dir, None)
    }

    pub fn start_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<PiRuntimeSnapshot, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(PiHost::spawn_with_event_sink(
                resource_dir,
                event_sink.clone(),
            )?);
        }

        let status = host
            .as_mut()
            .ok_or_else(|| "Pi host was not initialized".to_string())?
            .status();

        match status {
            Ok(snapshot) => Ok(snapshot),
            Err(first_error) => {
                *host = None;
                *host = Some(PiHost::spawn_with_event_sink(resource_dir, event_sink)?);
                host.as_mut()
                    .ok_or_else(|| "Pi host was not initialized".to_string())?
                    .status()
                    .map_err(|second_error| {
                        format!(
                            "Pi host restart failed after error ({first_error}): {second_error}"
                        )
                    })
            }
        }
    }

    pub fn info(&self) -> Result<PiHostInfo, String> {
        self.info_with_resource_dir(None)
    }

    pub fn info_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> Result<PiHostInfo, String> {
        self.with_host(resource_dir, PiHost::info)
    }

    pub fn info_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<PiHostInfo, String> {
        self.with_host_event_sink(resource_dir, event_sink, PiHost::info)
    }

    pub fn diagnostics_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<PiDiagnostics, String> {
        self.with_host_event_sink(resource_dir, event_sink, PiHost::diagnostics)
    }

    pub fn sessions_list_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> Result<PiSessionsList, String> {
        self.with_host(resource_dir, PiHost::sessions_list)
    }

    pub fn sessions_list_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<PiSessionsList, String> {
        self.with_host_event_sink(resource_dir, event_sink, PiHost::sessions_list)
    }

    pub fn session_create_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        title: Option<String>,
    ) -> Result<PiSessionCreateResult, String> {
        self.with_host(resource_dir, |host| host.session_create(title))
    }

    pub fn session_create_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
    ) -> Result<PiSessionCreateResult, String> {
        self.with_host_event_sink(resource_dir, event_sink, |host| host.session_create(title))
    }

    pub fn session_send_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
        prompt: String,
    ) -> Result<PiSessionSendResult, String> {
        self.with_host(resource_dir, |host| host.session_send(session_id, prompt))
    }

    pub fn session_send_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
        prompt: String,
    ) -> Result<PiSessionSendResult, String> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_send(session_id, prompt)
        })
    }

    pub fn session_stop_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
    ) -> Result<PiSessionStopResult, String> {
        self.with_host(resource_dir, |host| host.session_stop(session_id))
    }

    pub fn session_stop_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
    ) -> Result<PiSessionStopResult, String> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_stop(session_id)
        })
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

fn session_event_sink(app: &AppHandle) -> PiSessionEventSink {
    let app = app.clone();
    let history_path = store::history_path(&app).ok();
    Arc::new(move |event| {
        if let Some(path) = history_path.as_deref() {
            let _ = store::record_event_at_path(path, &event);
        }
        let _ = app.emit(PI_SESSION_EVENT_NAME, event);
    })
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
    state.start_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
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
    state.info_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub async fn pi_diagnostics(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiDiagnostics, String> {
    state.diagnostics_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub async fn pi_sessions_history(app: AppHandle) -> Result<PiSessionsList, String> {
    store::load(&app)
}

#[tauri::command]
pub async fn pi_sessions_list(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiSessionsList, String> {
    state.sessions_list_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub async fn pi_session_create(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    title: Option<String>,
) -> Result<PiSessionCreateResult, String> {
    let result = state.session_create_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        title,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    Ok(result)
}

#[tauri::command]
pub async fn pi_session_send(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
    prompt: String,
) -> Result<PiSessionSendResult, String> {
    let result = state.session_send_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        session_id,
        prompt,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    Ok(result)
}

#[tauri::command]
pub async fn pi_session_stop(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> Result<PiSessionStopResult, String> {
    let result = state.session_stop_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        session_id,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    Ok(result)
}
