use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::host::{HostCallError, PiHost, PiSessionEventSink};
use super::native_tools;
use super::store;
use super::types::*;

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
        tokio::spawn(async move {
            tokio::time::sleep(timeout).await;
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
                Err(e) => {
                    log::debug!("idle shutdown has_running_sessions error: {e}");
                }
            }
        });
    }
}

pub struct PiState {
    host: Arc<Mutex<Option<Arc<PiHost>>>>,
    history_path: Arc<Mutex<Option<PathBuf>>>,
    idle_shutdown: IdleShutdownController,
}

mod compat;
mod requests;
pub(super) use requests::{
    CreateSessionRequest, DeleteSessionRequest, PiHostContext, RenameSessionRequest,
    ResumeSessionRequest, SendPromptRequest, ToolRespondRequest,
};

fn mark_unfinished_sessions_stopped_for_history_path(history_path: &Arc<Mutex<Option<PathBuf>>>) {
    let path = match history_path.lock() {
        Ok(path) => path.clone(),
        Err(_) => None,
    };
    if let Some(path) = path {
        if let Err(e) = store::mark_unfinished_sessions_stopped_at_path(&path) {
            log::debug!("mark unfinished sessions stopped failed: {e}");
        }
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
        native_tool_context: native_tools::NativeToolContext,
    ) -> Result<Arc<PiHost>, String> {
        let mut host = self.host.lock().map_err(|e| e.to_string())?;
        if host.is_none() {
            *host = Some(Arc::new(
                PiHost::spawn_with_event_sink_and_native_tool_context(
                    resource_dir,
                    event_sink,
                    native_tool_context,
                )?,
            ));
        } else if let Some(host) = host.as_ref() {
            host.set_native_tool_context(native_tool_context)?;
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

    fn replace_host_if_same(
        &self,
        expected: &Arc<PiHost>,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        native_tool_context: native_tools::NativeToolContext,
    ) -> Result<Arc<PiHost>, String> {
        let next_host = Arc::new(PiHost::spawn_with_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tool_context,
        )?);
        let mut replaced = false;
        let host = {
            let mut slot = self.host.lock().map_err(|e| e.to_string())?;
            if slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, expected))
            {
                *slot = Some(Arc::clone(&next_host));
                replaced = true;
                next_host
            } else {
                slot.as_ref()
                    .cloned()
                    .ok_or_else(|| "Pi host was not initialized".to_string())?
            }
        };
        if replaced {
            self.cancel_idle_shutdown();
            self.mark_unfinished_sessions_stopped();
        }
        Ok(host)
    }

    fn with_host<R>(
        &self,
        resource_dir: Option<&Path>,
        action: impl FnOnce(&PiHost) -> Result<R, HostCallError>,
    ) -> PiCommandResult<R> {
        self.with_host_event_sink(resource_dir, None, action)
    }

    fn with_host_event_sink<R>(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        action: impl FnOnce(&PiHost) -> Result<R, HostCallError>,
    ) -> PiCommandResult<R> {
        self.with_host_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tools::NativeToolContext::default(),
            action,
        )
    }

    fn with_host_event_sink_and_native_tool_context<R>(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        native_tool_context: native_tools::NativeToolContext,
        action: impl FnOnce(&PiHost) -> Result<R, HostCallError>,
    ) -> PiCommandResult<R> {
        let host = self
            .host_handle(resource_dir, event_sink, native_tool_context)
            .map_err(PiCommandError::from)?;
        match action(&host) {
            Ok(result) => {
                self.schedule_idle_shutdown();
                Ok(result)
            }
            Err(error) => {
                let clear = error.is_transport();
                let command_error = error.into_command_error();
                if clear {
                    if let Err(e) = self.clear_host_if_same(&host) {
                        log::debug!("clear_host_if_same failed: {e}");
                    }
                }
                Err(command_error)
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
                if let Err(e) = self.clear_host_if_same(&host) {
                    log::debug!("snapshot clear_host_if_same failed: {e}");
                }
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
        let host = self.host_handle(
            resource_dir,
            event_sink.clone(),
            native_tools::NativeToolContext::default(),
        )?;
        match host.status() {
            Ok(snapshot) => {
                self.schedule_idle_shutdown();
                Ok(snapshot)
            }
            Err(first_error) => {
                let first_message = first_error.message();
                let host = self.replace_host_if_same(
                    &host,
                    resource_dir,
                    event_sink,
                    native_tools::NativeToolContext::default(),
                )?;
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

    pub fn info(&self) -> PiCommandResult<PiHostInfo> {
        self.info_with_resource_dir(None)
    }

    pub fn info_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> PiCommandResult<PiHostInfo> {
        self.with_host(resource_dir, PiHost::info)
    }

    pub fn info_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> PiCommandResult<PiHostInfo> {
        self.with_host_event_sink(resource_dir, event_sink, PiHost::info)
    }

    pub fn diagnostics_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> PiCommandResult<PiDiagnostics> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            let mut diagnostics = host.diagnostics()?;
            diagnostics.manager.idle_shutdown_ms = self
                .idle_shutdown
                .timeout
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX);
            Ok(diagnostics)
        })
    }

    pub fn sessions_list_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
    ) -> PiCommandResult<PiSessionsList> {
        self.with_host(resource_dir, PiHost::sessions_list)
    }

    pub fn models_list_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        profile_agent_dir: String,
    ) -> PiCommandResult<PiProfileModelsList> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.models_list(profile_agent_dir)
        })
    }

    pub fn sessions_list_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> PiCommandResult<PiSessionsList> {
        self.with_host_event_sink(resource_dir, event_sink, PiHost::sessions_list)
    }

    pub(super) fn session_create(
        &self,
        context: PiHostContext,
        request: CreateSessionRequest,
    ) -> PiCommandResult<PiSessionCreateResult> {
        let PiHostContext {
            resource_dir,
            event_sink,
            native_tool_context,
        } = context;
        self.with_host_event_sink_and_native_tool_context(
            resource_dir.as_deref(),
            event_sink,
            native_tool_context,
            |host| {
                host.session_create(
                    request.title,
                    request.cwd,
                    request.provider_config,
                    request.session_dir,
                    request.workspace_env,
                )
            },
        )
    }

    pub(super) fn session_resume(
        &self,
        context: PiHostContext,
        request: ResumeSessionRequest,
    ) -> PiCommandResult<PiSessionResumeResult> {
        let PiHostContext {
            resource_dir,
            event_sink,
            native_tool_context,
        } = context;
        self.with_host_event_sink_and_native_tool_context(
            resource_dir.as_deref(),
            event_sink,
            native_tool_context,
            |host| {
                host.session_resume(
                    request.session_id,
                    request.title,
                    request.cwd,
                    request.sdk_session_file,
                    request.session_dir,
                    request.provider_config,
                    request.created_at,
                    request.last_prompt,
                    request.thinking_level,
                    request.workspace_env,
                )
            },
        )
    }

    pub(super) fn session_send(
        &self,
        context: PiHostContext,
        request: SendPromptRequest,
    ) -> PiCommandResult<PiSessionSendResult> {
        let PiHostContext {
            resource_dir,
            event_sink,
            native_tool_context,
        } = context;
        self.with_host_event_sink_and_native_tool_context(
            resource_dir.as_deref(),
            event_sink,
            native_tool_context,
            |host| {
                host.session_send(
                    request.session_id,
                    request.prompt,
                    request.context,
                    request.regenerate_branch_group_id,
                    request.thinking_level,
                )
            },
        )
    }

    pub(super) fn session_tool_respond(
        &self,
        context: PiHostContext,
        request: ToolRespondRequest,
    ) -> PiCommandResult<PiSessionToolRespondResult> {
        let PiHostContext {
            resource_dir,
            event_sink,
            native_tool_context,
        } = context;
        self.with_host_event_sink_and_native_tool_context(
            resource_dir.as_deref(),
            event_sink,
            native_tool_context,
            |host| {
                host.session_tool_respond(
                    request.session_id,
                    request.tool_call_id,
                    request.approved,
                )
            },
        )
    }

    pub(super) fn session_rename(
        &self,
        context: PiHostContext,
        request: RenameSessionRequest,
    ) -> PiCommandResult<PiSessionRenameResult> {
        let PiHostContext {
            resource_dir,
            event_sink,
            native_tool_context,
        } = context;
        self.with_host_event_sink_and_native_tool_context(
            resource_dir.as_deref(),
            event_sink,
            native_tool_context,
            |host| host.session_rename(request.session_id, request.title),
        )
    }

    pub(super) fn session_delete(
        &self,
        context: PiHostContext,
        request: DeleteSessionRequest,
    ) -> PiCommandResult<PiSessionDeleteResult> {
        let PiHostContext {
            resource_dir,
            event_sink,
            native_tool_context,
        } = context;
        self.with_host_event_sink_and_native_tool_context(
            resource_dir.as_deref(),
            event_sink,
            native_tool_context,
            |host| host.session_delete(request.session_id),
        )
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
