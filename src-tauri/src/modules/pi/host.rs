use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    PiDiagnostics, PiHostInfo, PiPhase, PiRuntimeSnapshot, PiSessionCreateResult, PiSessionEvent,
    PiSessionSendResult, PiSessionStopResult, PiSessionsList,
};

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const STDERR_TAIL_LIMIT: usize = 4096;
const HOST_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SHELL",
    "PI_CODING_AGENT_DIR",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "XAI_API_KEY",
    "CEREBRAS_API_KEY",
    "TERAX_PI_NODE_MODULES",
    "TERAX_PI_HOST_TEST_FAUX_RESPONSE",
    "TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND",
];

pub type PiSessionEventSink = Arc<dyn Fn(PiSessionEvent) + Send + Sync + 'static>;

#[derive(Deserialize)]
struct HostResponse<T> {
    jsonrpc: String,
    id: u64,
    result: Option<T>,
    error: Option<HostError>,
}

#[derive(Deserialize)]
struct HostError {
    code: i64,
    message: String,
}

#[derive(Deserialize)]
struct HostNotification {
    jsonrpc: String,
    method: String,
    params: PiSessionEvent,
}

#[derive(Deserialize)]
struct PingResult {
    pong: bool,
}

#[derive(Deserialize)]
struct ShutdownResult {
    ok: bool,
}

#[derive(Deserialize)]
struct HostStatus {
    phase: PiPhase,
    detail: Option<String>,
}

impl From<HostStatus> for PiRuntimeSnapshot {
    fn from(status: HostStatus) -> Self {
        Self {
            phase: status.phase,
            detail: status.detail,
        }
    }
}

#[derive(Clone, Default)]
struct StderrTail {
    inner: Arc<Mutex<String>>,
}

impl StderrTail {
    fn push_lossy(&self, bytes: &[u8]) {
        let mut tail = match self.inner.lock() {
            Ok(tail) => tail,
            Err(_) => return,
        };
        tail.push_str(&String::from_utf8_lossy(bytes));
        if tail.len() <= STDERR_TAIL_LIMIT {
            return;
        }

        let min_start = tail.len() - STDERR_TAIL_LIMIT;
        let start = tail
            .char_indices()
            .map(|(index, _)| index)
            .find(|index| *index >= min_start)
            .unwrap_or(tail.len());
        tail.drain(..start);
    }

    fn snapshot(&self) -> String {
        self.inner
            .lock()
            .map(|tail| tail.trim().to_string())
            .unwrap_or_default()
    }
}

pub struct PiHost {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<Result<String, String>>,
    stderr_tail: StderrTail,
    request_timeout: Duration,
    next_id: u64,
}

impl PiHost {
    pub fn spawn_with_event_sink(
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Self, String> {
        let host_path = resolve_host_path(resource_dir)?;
        Self::spawn_inner(
            node_binary(resource_dir),
            host_path,
            DEFAULT_REQUEST_TIMEOUT,
            event_sink,
        )
    }

    fn spawn_inner(
        node_binary: PathBuf,
        host_path: PathBuf,
        request_timeout: Duration,
        event_sink: Option<PiSessionEventSink>,
    ) -> Result<Self, String> {
        let mut command = Command::new(node_binary);
        command
            .arg(host_path)
            .env_clear()
            .envs(host_environment())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to start Pi host: {e}"))?;

        let stdin = child.stdin.take().ok_or_else(|| {
            let _ = child.kill();
            "Pi host stdin unavailable".to_string()
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            let _ = child.kill();
            "Pi host stdout unavailable".to_string()
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            let _ = child.kill();
            "Pi host stderr unavailable".to_string()
        })?;

        let stderr_tail = StderrTail::default();
        spawn_stderr_reader(stderr, stderr_tail.clone());
        let responses = spawn_stdout_reader(stdout, event_sink);

        let mut host = Self {
            child,
            stdin,
            responses,
            stderr_tail,
            request_timeout,
            next_id: 1,
        };
        let ping: PingResult = host.call("ping")?;
        if !ping.pong {
            return Err("Pi host ping failed".to_string());
        }
        Ok(host)
    }

    pub fn status(&mut self) -> Result<PiRuntimeSnapshot, String> {
        let status: HostStatus = self.call("status")?;
        Ok(status.into())
    }

    pub fn info(&mut self) -> Result<PiHostInfo, String> {
        self.call("info")
    }

    pub fn diagnostics(&mut self) -> Result<PiDiagnostics, String> {
        self.call("diagnostics")
    }

    pub fn sessions_list(&mut self) -> Result<PiSessionsList, String> {
        self.call("sessions.list")
    }

    pub fn session_create(
        &mut self,
        title: Option<String>,
    ) -> Result<PiSessionCreateResult, String> {
        self.call_with_params("sessions.create", json!({ "title": title }))
    }

    pub fn session_send(
        &mut self,
        session_id: String,
        prompt: String,
    ) -> Result<PiSessionSendResult, String> {
        self.call_with_params(
            "sessions.send",
            json!({ "sessionId": session_id, "prompt": prompt }),
        )
    }

    pub fn session_stop(&mut self, session_id: String) -> Result<PiSessionStopResult, String> {
        self.call_with_params("sessions.stop", json!({ "sessionId": session_id }))
    }

    pub fn shutdown(mut self) {
        let result = self.call::<ShutdownResult>("shutdown");
        if !matches!(result, Ok(ShutdownResult { ok: true })) {
            let _ = self.child.kill();
        }
        self.wait_or_kill();
    }

    fn call<T: DeserializeOwned>(&mut self, method: &str) -> Result<T, String> {
        self.call_json(method, None)
    }

    fn call_with_params<T: DeserializeOwned>(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<T, String> {
        self.call_json(method, Some(params))
    }

    fn call_json<T: DeserializeOwned>(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<T, String> {
        self.ensure_running()?;

        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).unwrap_or(1);
        let mut request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        if let Some(params) = params {
            request["params"] = params;
        }
        let request = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        self.stdin
            .write_all(request.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|e| self.with_stderr(format!("Pi host write failed: {e}")))?;

        let line = match self.responses.recv_timeout(self.request_timeout) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(self.with_stderr(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = self.child.kill();
                return Err(self.with_stderr(format!(
                    "Pi host request `{method}` timed out after {}ms",
                    self.request_timeout.as_millis()
                )));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(self.with_stderr("Pi host response reader stopped".to_string()));
            }
        };

        let response: HostResponse<T> = serde_json::from_str(line.trim_end())
            .map_err(|e| self.with_stderr(format!("Pi host response was not valid JSON: {e}")))?;
        if response.jsonrpc != "2.0" || response.id != id {
            return Err(self.with_stderr("Pi host response id mismatch".to_string()));
        }
        if let Some(error) = response.error {
            return Err(
                self.with_stderr(format!("Pi host error {}: {}", error.code, error.message))
            );
        }
        response
            .result
            .ok_or_else(|| self.with_stderr("Pi host response had no result".to_string()))
    }

    fn ensure_running(&mut self) -> Result<(), String> {
        match self.child.try_wait() {
            Ok(Some(status)) => Err(self.with_stderr(format!("Pi host exited with {status}"))),
            Ok(None) => Ok(()),
            Err(error) => Err(self.with_stderr(format!("Pi host status check failed: {error}"))),
        }
    }

    fn with_stderr(&self, message: String) -> String {
        let stderr = self.stderr_tail.snapshot();
        if stderr.is_empty() {
            message
        } else {
            format!("{message}; stderr: {stderr}")
        }
    }

    fn wait_or_kill(&mut self) {
        for _ in 0..20 {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => return,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for PiHost {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn session_event_notification(line: &str) -> Option<PiSessionEvent> {
    let notification = serde_json::from_str::<HostNotification>(line.trim_end()).ok()?;
    if notification.jsonrpc == "2.0" && notification.method == "session.event" {
        Some(notification.params)
    } else {
        None
    }
}

fn spawn_stdout_reader(
    stdout: ChildStdout,
    event_sink: Option<PiSessionEventSink>,
) -> mpsc::Receiver<Result<String, String>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = tx.send(Err("Pi host closed stdout".to_string()));
                    break;
                }
                Ok(_) => {
                    if let Some(event) = session_event_notification(&line) {
                        if let Some(event_sink) = event_sink.as_ref() {
                            event_sink(event);
                        }
                        continue;
                    }
                    if tx.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = tx.send(Err(format!("Pi host read failed: {error}")));
                    break;
                }
            }
        }
    });
    rx
}

fn spawn_stderr_reader(mut stderr: ChildStderr, tail: StderrTail) {
    thread::spawn(move || {
        let mut buffer = [0; 1024];
        loop {
            match stderr.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => tail.push_lossy(&buffer[..read]),
                Err(_) => break,
            }
        }
    });
}

fn host_environment() -> Vec<(String, String)> {
    HOST_ENV_ALLOWLIST
        .iter()
        .filter_map(|name| {
            env::var(name)
                .ok()
                .map(|value| ((*name).to_string(), value))
        })
        .collect()
}

fn node_binary(resource_dir: Option<&Path>) -> PathBuf {
    if let Ok(path) = env::var("TERAX_NODE_BINARY") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    for candidate in node_binary_candidates(resource_dir) {
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from("node")
}

fn node_binary_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    resource_dir
        .map(|dir| vec![dir.join(bundled_node_relative_path())])
        .unwrap_or_default()
}

fn bundled_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/node.exe")
    } else {
        PathBuf::from("sidecars/node/bin/node")
    }
}

fn resolve_host_path(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("TERAX_PI_HOST_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "TERAX_PI_HOST_PATH is not a file: {}",
            path.display()
        ));
    }

    for candidate in host_path_candidates(resource_dir) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err("could not find sidecars/pi-host/host.js".to_string())
}

fn host_path_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let relative = PathBuf::from("sidecars/pi-host/host.js");
    let mut candidates = Vec::new();

    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join(&relative));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(&relative));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(&relative));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("..").join(relative));
    candidates
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn bundled_resource_candidate_is_first() {
        let resource_dir = PathBuf::from("resources-root");
        let candidates = host_path_candidates(Some(&resource_dir));

        assert_eq!(
            candidates.first(),
            Some(&resource_dir.join("sidecars/pi-host/host.js"))
        );
    }

    #[test]
    fn bundled_node_candidate_uses_resource_dir() {
        let resource_dir = PathBuf::from("resources-root");
        let candidates = node_binary_candidates(Some(&resource_dir));

        assert_eq!(
            candidates.first(),
            Some(&resource_dir.join(bundled_node_relative_path()))
        );
    }

    #[test]
    fn dev_candidates_include_repo_root_from_manifest_dir() {
        let candidates = host_path_candidates(None);
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

        assert!(candidates.contains(&manifest_dir.join("..").join("sidecars/pi-host/host.js")));
    }

    #[test]
    fn host_environment_uses_allowlist() {
        std::env::set_var("ANTHROPIC_API_KEY", "allowed-secret");
        std::env::set_var("TERAX_SHOULD_NOT_LEAK", "blocked-secret");
        let environment = host_environment();

        assert!(environment
            .iter()
            .any(|(name, value)| name == "ANTHROPIC_API_KEY" && value == "allowed-secret"));
        assert!(!environment
            .iter()
            .any(|(name, _)| name == "TERAX_SHOULD_NOT_LEAK"));

        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::remove_var("TERAX_SHOULD_NOT_LEAK");
    }

    #[test]
    fn session_event_notification_parses_event_envelope() {
        let event = session_event_notification(
            r#"{"jsonrpc":"2.0","method":"session.event","params":{"id":"evt-1","type":"session.output.delta","sessionId":"pi-1","createdAt":"2026-01-01T00:00:00.000Z","payload":{"text":"hi"}}}"#,
        )
        .unwrap();

        assert_eq!(event.id, "evt-1");
        assert_eq!(event.event_type, "session.output.delta");
        assert_eq!(event.session_id, "pi-1");
        assert_eq!(event.payload["text"], "hi");
    }

    #[test]
    fn session_event_notification_ignores_responses() {
        assert!(
            session_event_notification(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#)
                .is_none()
        );
    }

    #[test]
    fn startup_timeout_includes_captured_stderr() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("host.js");
        fs::write(
            &script,
            "process.stderr.write('pi host boot note\\n'); setInterval(() => {}, 1000);",
        )
        .unwrap();

        let error = match PiHost::spawn_inner(
            PathBuf::from("node"),
            script,
            Duration::from_millis(100),
            None,
        ) {
            Ok(_) => panic!("host should time out during ping"),
            Err(error) => error,
        };

        assert!(error.contains("timed out"), "{error}");
        assert!(error.contains("pi host boot note"), "{error}");
    }
}
