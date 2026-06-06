use std::time::Duration;

use super::PiMethodTimeoutDiagnostics;

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const STDERR_TAIL_LIMIT: usize = 4096;

#[derive(Clone)]
pub(super) struct RequestTimeouts {
    fallback: Duration,
    ping: Duration,
    status: Duration,
    info: Duration,
    diagnostics: Duration,
    models_list: Duration,
    sessions_list: Duration,
    sessions_create: Duration,
    sessions_send: Duration,
    sessions_resume: Duration,
    sessions_tool_respond: Duration,
    sessions_rename: Duration,
    sessions_delete: Duration,
    sessions_stop: Duration,
    shutdown: Duration,
}

impl RequestTimeouts {
    pub(super) fn production() -> Self {
        Self {
            fallback: DEFAULT_REQUEST_TIMEOUT,
            ping: Duration::from_secs(3),
            status: Duration::from_secs(3),
            info: Duration::from_secs(5),
            diagnostics: Duration::from_secs(30),
            models_list: Duration::from_secs(30),
            sessions_list: Duration::from_secs(5),
            sessions_create: Duration::from_secs(60),
            sessions_send: DEFAULT_REQUEST_TIMEOUT,
            sessions_resume: Duration::from_secs(60),
            sessions_tool_respond: Duration::from_secs(10),
            sessions_rename: Duration::from_secs(5),
            sessions_delete: Duration::from_secs(10),
            sessions_stop: Duration::from_secs(10),
            shutdown: Duration::from_secs(10),
        }
    }

    #[cfg(test)]
    pub(super) fn uniform(timeout: Duration) -> Self {
        Self {
            fallback: timeout,
            ping: timeout,
            status: timeout,
            info: timeout,
            diagnostics: timeout,
            models_list: timeout,
            sessions_list: timeout,
            sessions_create: timeout,
            sessions_send: timeout,
            sessions_resume: timeout,
            sessions_tool_respond: timeout,
            sessions_rename: timeout,
            sessions_delete: timeout,
            sessions_stop: timeout,
            shutdown: timeout,
        }
    }

    #[cfg(test)]
    pub(super) fn for_tests(timeout: Duration) -> Self {
        Self::uniform(timeout)
    }

    #[cfg(test)]
    pub(super) fn with_method(mut self, method: &str, timeout: Duration) -> Self {
        match method {
            "ping" => self.ping = timeout,
            "status" => self.status = timeout,
            "info" => self.info = timeout,
            "diagnostics" => self.diagnostics = timeout,
            "models.list" => self.models_list = timeout,
            "sessions.list" => self.sessions_list = timeout,
            "sessions.create" => self.sessions_create = timeout,
            "sessions.send" => self.sessions_send = timeout,
            "sessions.resume" => self.sessions_resume = timeout,
            "sessions.tool.respond" => self.sessions_tool_respond = timeout,
            "sessions.rename" => self.sessions_rename = timeout,
            "sessions.delete" => self.sessions_delete = timeout,
            "sessions.stop" => self.sessions_stop = timeout,
            "shutdown" => self.shutdown = timeout,
            _ => self.fallback = timeout,
        }
        self
    }

    pub(super) fn for_method(&self, method: &str) -> Duration {
        match method {
            "ping" => self.ping,
            "status" => self.status,
            "info" => self.info,
            "diagnostics" => self.diagnostics,
            "models.list" => self.models_list,
            "sessions.list" => self.sessions_list,
            "sessions.create" => self.sessions_create,
            "sessions.send" => self.sessions_send,
            "sessions.resume" => self.sessions_resume,
            "sessions.tool.respond" => self.sessions_tool_respond,
            "sessions.rename" => self.sessions_rename,
            "sessions.delete" => self.sessions_delete,
            "sessions.stop" => self.sessions_stop,
            "shutdown" => self.shutdown,
            _ => self.fallback,
        }
    }

    pub(super) fn diagnostics(&self) -> Vec<PiMethodTimeoutDiagnostics> {
        [
            "ping",
            "status",
            "info",
            "diagnostics",
            "models.list",
            "sessions.list",
            "sessions.create",
            "sessions.send",
            "sessions.resume",
            "sessions.tool.respond",
            "sessions.rename",
            "sessions.delete",
            "sessions.stop",
            "shutdown",
        ]
        .into_iter()
        .map(|method| PiMethodTimeoutDiagnostics {
            method: method.to_string(),
            timeout_ms: self
                .for_method(method)
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
        })
        .collect()
    }
}
