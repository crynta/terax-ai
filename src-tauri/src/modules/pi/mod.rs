use std::env;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::modules::secrets::{self, SecretsState};
use crate::modules::workspace::{self, WorkspaceEnv, WorkspaceRegistry};

mod host;
mod store;

use host::{HostCallError, PiHost, PiSessionEventSink};

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
    #[serde(default)]
    pub capabilities: PiCapabilityDiagnostics,
    #[serde(default)]
    pub protocol: PiProtocolDiagnostics,
    #[serde(default)]
    pub limits: PiLimitDiagnostics,
    #[serde(default)]
    pub manager: PiManagerDiagnostics,
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
    #[serde(default)]
    pub forwarded_env_names: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCapabilityDiagnostics {
    pub tools: bool,
    pub files: bool,
    pub shell: bool,
    pub git: bool,
    pub terminal: bool,
    pub editor: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProtocolDiagnostics {
    pub allowed_methods: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiLimitDiagnostics {
    pub max_prompt_chars: usize,
    pub max_sessions: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiManagerDiagnostics {
    pub idle_shutdown_ms: u64,
    pub method_timeouts: Vec<PiMethodTimeoutDiagnostics>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiMethodTimeoutDiagnostics {
    pub method: String,
    pub timeout_ms: u64,
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
    #[serde(default)]
    pub cwd: Option<String>,
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
    #[serde(default)]
    pub cwd: Option<String>,
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

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPromptContext {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub active_terminal_cwd: Option<String>,
    #[serde(default)]
    pub active_file: Option<String>,
    #[serde(default)]
    pub active_terminal_private: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PiAuthMode {
    #[default]
    Terax,
    Profile,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderConfig {
    pub provider: String,
    pub model_id: String,
    #[serde(default)]
    pub source_model_id: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub context_limit: Option<u32>,
    #[serde(default)]
    pub custom_endpoint_id: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<PiAuthMode>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PiResolvedProviderConfig {
    pub auth_mode: PiAuthMode,
    pub provider: String,
    pub model_id: String,
    #[serde(default)]
    pub source_model_id: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub context_limit: Option<u32>,
    #[serde(default)]
    pub custom_endpoint_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_agent_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProfileModelInfo {
    pub provider: String,
    pub provider_label: String,
    pub id: String,
    pub label: String,
    pub available: bool,
    pub context_window: Option<u32>,
    pub max_tokens: Option<u32>,
    pub reasoning: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProfileModelsList {
    pub profile_agent_dir: String,
    pub load_error: Option<String>,
    pub models: Vec<PiProfileModelInfo>,
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

const DEFAULT_IDLE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone)]
struct IdleShutdownController {
    generation: Arc<AtomicU64>,
    timeout: Duration,
}

impl Default for IdleShutdownController {
    fn default() -> Self {
        Self::with_timeout(DEFAULT_IDLE_SHUTDOWN_TIMEOUT)
    }
}

impl IdleShutdownController {
    fn with_timeout(timeout: Duration) -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
            timeout,
        }
    }

    fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    fn schedule(
        &self,
        host_slot: Arc<Mutex<Option<Arc<PiHost>>>>,
        history_path: Arc<Mutex<Option<PathBuf>>>,
    ) {
        if self.timeout.is_zero() {
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let controller = self.clone();
        let timeout = self.timeout;
        thread::spawn(move || {
            thread::sleep(timeout);
            if controller.generation.load(Ordering::Relaxed) != generation {
                return;
            }
            let host = match host_slot.lock() {
                Ok(slot) => slot.as_ref().cloned(),
                Err(_) => None,
            };
            let Some(host) = host else {
                return;
            };
            match host.has_running_sessions() {
                Ok(true) => {
                    if controller.generation.load(Ordering::Relaxed) == generation {
                        controller.schedule(host_slot, history_path);
                    }
                }
                Ok(false) => {
                    let removed = match host_slot.lock() {
                        Ok(mut slot) => {
                            if slot
                                .as_ref()
                                .is_some_and(|current| Arc::ptr_eq(current, &host))
                            {
                                slot.take()
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    };
                    if let Some(host) = removed {
                        mark_unfinished_sessions_stopped_for_history_path(&history_path);
                        host.shutdown();
                    }
                }
                Err(_) => {}
            }
        });
    }
}

pub struct PiState {
    host: Arc<Mutex<Option<Arc<PiHost>>>>,
    history_path: Arc<Mutex<Option<PathBuf>>>,
    idle_shutdown: IdleShutdownController,
}

fn mark_unfinished_sessions_stopped_for_history_path(history_path: &Arc<Mutex<Option<PathBuf>>>) {
    let path = match history_path.lock() {
        Ok(path) => path.clone(),
        Err(_) => None,
    };
    if let Some(path) = path {
        let _ = store::mark_unfinished_sessions_stopped_at_path(&path);
    }
}

impl Default for PiState {
    fn default() -> Self {
        Self {
            host: Arc::new(Mutex::new(None)),
            history_path: Arc::new(Mutex::new(None)),
            idle_shutdown: IdleShutdownController::default(),
        }
    }
}

impl PiState {
    pub fn with_idle_shutdown_timeout(timeout: Duration) -> Self {
        Self {
            host: Arc::new(Mutex::new(None)),
            history_path: Arc::new(Mutex::new(None)),
            idle_shutdown: IdleShutdownController::with_timeout(timeout),
        }
    }

    pub fn set_history_path(&self, history_path: Option<PathBuf>) -> Result<(), String> {
        *self.history_path.lock().map_err(|e| e.to_string())? = history_path;
        Ok(())
    }

    fn mark_unfinished_sessions_stopped(&self) {
        mark_unfinished_sessions_stopped_for_history_path(&self.history_path);
    }

    fn schedule_idle_shutdown(&self) {
        self.idle_shutdown
            .schedule(Arc::clone(&self.host), Arc::clone(&self.history_path));
    }

    fn cancel_idle_shutdown(&self) {
        self.idle_shutdown.cancel();
    }

    fn host_handle(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Arc<PiHost>, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(Arc::new(PiHost::spawn_with_event_sink(
                resource_dir,
                event_sink,
            )?));
        }
        host.as_ref()
            .cloned()
            .ok_or_else(|| "Pi host was not initialized".to_string())
    }

    fn clear_host_if_same(&self, expected: &Arc<PiHost>) -> Result<(), String> {
        let mut cleared = false;
        {
            let mut host = self.host.lock().map_err(|e| e.to_string())?;
            if host
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, expected))
            {
                *host = None;
                cleared = true;
            }
        }
        if cleared {
            self.cancel_idle_shutdown();
            self.mark_unfinished_sessions_stopped();
        }
        Ok(())
    }

    fn with_host<R>(
        &self,
        resource_dir: Option<&Path>,
        action: impl FnOnce(&PiHost) -> Result<R, HostCallError>,
    ) -> Result<R, String> {
        self.with_host_event_sink(resource_dir, None, action)
    }

    fn with_host_event_sink<R>(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        action: impl FnOnce(&PiHost) -> Result<R, HostCallError>,
    ) -> Result<R, String> {
        let host = self.host_handle(resource_dir, event_sink)?;
        match action(&host) {
            Ok(result) => {
                self.schedule_idle_shutdown();
                Ok(result)
            }
            Err(error) => {
                let clear = error.is_transport();
                let message = error.message();
                if clear {
                    let _ = self.clear_host_if_same(&host);
                }
                Err(message)
            }
        }
    }

    pub fn snapshot(&self) -> Result<PiRuntimeSnapshot, String> {
        let host = {
            let guard = self.host.lock().map_err(|e| e.to_string())?;
            let Some(host) = guard.as_ref() else {
                return Ok(PiRuntimeSnapshot::default());
            };
            Arc::clone(host)
        };

        match host.status() {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                let message = error.message();
                let _ = self.clear_host_if_same(&host);
                Ok(error_snapshot(message))
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
        let host = self.host_handle(resource_dir, event_sink.clone())?;
        match host.status() {
            Ok(snapshot) => {
                self.schedule_idle_shutdown();
                Ok(snapshot)
            }
            Err(first_error) => {
                let first_message = first_error.message();
                let _ = self.clear_host_if_same(&host);
                let host = self.host_handle(resource_dir, event_sink)?;
                match host.status() {
                    Ok(snapshot) => {
                        self.schedule_idle_shutdown();
                        Ok(snapshot)
                    }
                    Err(second_error) => Err(format!(
                        "Pi host restart failed after error ({first_message}): {}",
                        second_error.message()
                    )),
                }
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
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            let mut diagnostics = host.diagnostics()?;
            diagnostics.manager.idle_shutdown_ms = self.idle_shutdown.timeout.as_millis() as u64;
            Ok(diagnostics)
        })
    }

    pub fn sessions_list_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> Result<PiSessionsList, String> {
        self.with_host(resource_dir, PiHost::sessions_list)
    }

    pub fn models_list_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        profile_agent_dir: String,
    ) -> Result<PiProfileModelsList, String> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.models_list(profile_agent_dir)
        })
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
        cwd: Option<String>,
    ) -> Result<PiSessionCreateResult, String> {
        self.session_create_with_resource_dir_and_provider(resource_dir, title, cwd, None)
    }

    fn session_create_with_resource_dir_and_provider(
        &self,
        resource_dir: Option<&Path>,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
    ) -> Result<PiSessionCreateResult, String> {
        self.with_host(resource_dir, |host| {
            host.session_create(title, cwd, provider_config)
        })
    }

    pub fn session_create_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
        cwd: Option<String>,
    ) -> Result<PiSessionCreateResult, String> {
        self.session_create_with_resource_dir_and_event_sink_and_provider(
            resource_dir,
            event_sink,
            title,
            cwd,
            None,
        )
    }

    fn session_create_with_resource_dir_and_event_sink_and_provider(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
    ) -> Result<PiSessionCreateResult, String> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_create(title, cwd, provider_config)
        })
    }

    pub fn session_send_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
    ) -> Result<PiSessionSendResult, String> {
        self.with_host(resource_dir, |host| {
            host.session_send(session_id, prompt, context)
        })
    }

    pub fn session_send_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
    ) -> Result<PiSessionSendResult, String> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_send(session_id, prompt, context)
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
        self.cancel_idle_shutdown();
        let host = {
            let mut host = self.host.lock().map_err(|e| e.to_string())?;
            host.take()
        };
        self.mark_unfinished_sessions_stopped();
        if let Some(host) = host {
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

fn resolve_session_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace_env: &WorkspaceEnv,
) -> Result<String, String> {
    let Some(resolved) = workspace::authorize_spawn_cwd(registry, cwd, workspace_env)? else {
        return Err("Pi session requires an authorized workspace cwd".to_string());
    };
    Ok(crate::modules::fs::to_canon(&resolved))
}

fn resolve_context_dir(
    registry: &WorkspaceRegistry,
    value: Option<&str>,
    workspace_env: &WorkspaceEnv,
    label: &str,
) -> Result<Option<String>, String> {
    let Some(raw) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = workspace::authorize_spawn_cwd(registry, Some(raw), workspace_env)
        .map_err(|error| format!("{label} is invalid: {error}"))?;
    Ok(resolved.as_deref().map(crate::modules::fs::to_canon))
}

fn resolve_context_file(
    registry: &WorkspaceRegistry,
    value: Option<&str>,
    workspace_env: &WorkspaceEnv,
    label: &str,
) -> Result<Option<String>, String> {
    let Some(raw) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let resolved = workspace::resolve_path(raw, workspace_env);
    let canonical = std::fs::canonicalize(&resolved)
        .map_err(|error| format!("{label} is not accessible: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("{label} is not a file: {}", canonical.display()));
    }
    if !registry.is_authorized(&canonical) {
        return Err(format!(
            "{label} is outside the authorized workspace: {}",
            canonical.display()
        ));
    }
    Ok(Some(crate::modules::fs::to_canon(&canonical)))
}

fn resolve_prompt_context(
    registry: &WorkspaceRegistry,
    context: Option<PiPromptContext>,
    workspace_env: &WorkspaceEnv,
) -> Result<Option<PiPromptContext>, String> {
    let Some(context) = context else {
        return Ok(None);
    };
    let resolved = PiPromptContext {
        workspace_root: resolve_context_dir(
            registry,
            context.workspace_root.as_deref(),
            workspace_env,
            "workspace_root",
        )?,
        active_terminal_cwd: resolve_context_dir(
            registry,
            context.active_terminal_cwd.as_deref(),
            workspace_env,
            "active_terminal_cwd",
        )?,
        active_file: resolve_context_file(
            registry,
            context.active_file.as_deref(),
            workspace_env,
            "active_file",
        )?,
        active_terminal_private: context.active_terminal_private,
    };

    if resolved.workspace_root.is_none()
        && resolved.active_terminal_cwd.is_none()
        && resolved.active_file.is_none()
        && !resolved.active_terminal_private
    {
        Ok(None)
    } else {
        Ok(Some(resolved))
    }
}

const KEYRING_SERVICE: &str = "terax-ai";
const MIN_CONTEXT_LIMIT: u32 = 1_000;
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

fn provider_key_account(config: &PiResolvedProviderConfig) -> Option<String> {
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

fn normalize_provider_config(
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

    Ok(Some(PiResolvedProviderConfig {
        auth_mode,
        provider,
        model_id: normalize_required_config_string(config.model_id, "modelId")?,
        source_model_id: normalize_optional_config_string(config.source_model_id, "sourceModelId")?,
        base_url: normalize_base_url(config.base_url)?,
        context_limit: config.context_limit,
        custom_endpoint_id: normalize_optional_config_string(
            config.custom_endpoint_id,
            "customEndpointId",
        )?,
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

fn default_pi_agent_dir() -> Result<String, String> {
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

fn resolve_provider_config(
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

fn bind_history_path(app: &AppHandle, state: &PiState) {
    if let Ok(path) = store::history_path(app) {
        let _ = state.set_history_path(Some(path));
    }
}

#[tauri::command]
pub fn pi_status(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.snapshot()
}

#[tauri::command]
pub fn pi_start(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    state.start_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub fn pi_stop(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiRuntimeSnapshot, String> {
    bind_history_path(&app, &state);
    let _ = store::mark_unfinished_sessions_stopped(&app);
    state.stop()
}

#[tauri::command]
pub fn pi_host_info(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiHostInfo, String> {
    bind_history_path(&app, &state);
    state.info_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub fn pi_diagnostics(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiDiagnostics, String> {
    bind_history_path(&app, &state);
    state.diagnostics_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[tauri::command]
pub fn pi_models_list(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiProfileModelsList, String> {
    bind_history_path(&app, &state);
    state.models_list_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        default_pi_agent_dir()?,
    )
}

#[tauri::command]
pub fn pi_sessions_history(app: AppHandle) -> Result<PiSessionsList, String> {
    store::load(&app)
}

#[tauri::command]
pub fn pi_sessions_list(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
) -> Result<PiSessionsList, String> {
    bind_history_path(&app, &state);
    state.sessions_list_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
    )
}

#[allow(
    clippy::too_many_arguments,
    reason = "Tauri injects app state beside serialized session create arguments"
)]
#[tauri::command]
pub fn pi_session_create(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    secrets_state: tauri::State<'_, SecretsState>,
    title: Option<String>,
    cwd: Option<String>,
    provider_config: Option<PiProviderConfig>,
    workspace: Option<WorkspaceEnv>,
) -> Result<PiSessionCreateResult, String> {
    bind_history_path(&app, &state);
    let workspace_env = WorkspaceEnv::from_option(workspace);
    let cwd = resolve_session_cwd(&registry, cwd.as_deref(), &workspace_env)?;
    let provider_config = resolve_provider_config(&app, &secrets_state, provider_config)?;
    let result = state.session_create_with_resource_dir_and_event_sink_and_provider(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        title,
        Some(cwd),
        provider_config,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    Ok(result)
}

#[tauri::command]
pub fn pi_session_send(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    session_id: String,
    prompt: String,
    context: Option<PiPromptContext>,
    workspace: Option<WorkspaceEnv>,
) -> Result<PiSessionSendResult, String> {
    bind_history_path(&app, &state);
    let workspace_env = WorkspaceEnv::from_option(workspace);
    let context = resolve_prompt_context(&registry, context, &workspace_env)?;
    let result = state.session_send_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        session_id,
        prompt,
        context,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    Ok(result)
}

#[tauri::command]
pub fn pi_session_stop(
    app: AppHandle,
    state: tauri::State<'_, PiState>,
    session_id: String,
) -> Result<PiSessionStopResult, String> {
    bind_history_path(&app, &state);
    let result = state.session_stop_with_resource_dir_and_event_sink(
        resource_dir(&app).as_deref(),
        Some(session_event_sink(&app)),
        session_id,
    )?;
    store::record_session_result(&app, &result.session, &result.events)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

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
            custom_endpoint_id: None,
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
    fn normalize_provider_config_allows_pi_profile_providers() {
        let resolved = normalize_provider_config(Some(PiProviderConfig {
            provider: " openai-codex ".to_string(),
            model_id: " gpt-5.3-codex ".to_string(),
            source_model_id: Some(" pi-profile:openai-codex:gpt-5.3-codex ".to_string()),
            base_url: None,
            context_limit: None,
            custom_endpoint_id: None,
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
    fn normalize_provider_config_rejects_invalid_base_url() {
        let error = normalize_provider_config(Some(PiProviderConfig {
            provider: "openai-compatible".to_string(),
            model_id: "qwen3-max".to_string(),
            source_model_id: None,
            base_url: Some("file:///tmp/model".to_string()),
            context_limit: Some(128_000),
            custom_endpoint_id: Some("abc123".to_string()),
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
            custom_endpoint_id: None,
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
            custom_endpoint_id: Some("abc123".to_string()),
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
}
