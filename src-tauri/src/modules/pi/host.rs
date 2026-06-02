use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    PiDiagnostics, PiHostInfo, PiPhase, PiPromptContext, PiRuntimeSnapshot, PiSessionCreateResult,
    PiSessionEvent, PiSessionSendResult, PiSessionStopResult, PiSessionsList,
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
struct HostResponseEnvelope {
    jsonrpc: String,
    id: u64,
}

#[derive(Debug)]
pub(super) enum HostCallError {
    Method(String),
    Transport(String),
}

impl HostCallError {
    pub(super) fn message(self) -> String {
        match self {
            Self::Method(message) | Self::Transport(message) => message,
        }
    }

    pub(super) fn is_transport(&self) -> bool {
        matches!(self, Self::Transport(_))
    }
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

type PendingReceiver = mpsc::Receiver<Result<String, String>>;
type PendingSender = mpsc::Sender<Result<String, String>>;

#[derive(Clone, Default)]
struct PendingResponses {
    inner: Arc<Mutex<HashMap<u64, PendingSender>>>,
}

impl PendingResponses {
    fn register(&self, id: u64) -> PendingReceiver {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = self.inner.lock() {
            pending.insert(id, tx);
        }
        rx
    }

    fn complete_response(&self, id: u64, line: String) -> bool {
        let sender = match self.inner.lock() {
            Ok(mut pending) => pending.remove(&id),
            Err(_) => None,
        };
        let Some(sender) = sender else {
            return false;
        };
        let _ = sender.send(Ok(line));
        true
    }

    fn remove(&self, id: u64) {
        if let Ok(mut pending) = self.inner.lock() {
            pending.remove(&id);
        }
    }

    fn fail_all(&self, error: String) {
        let senders = match self.inner.lock() {
            Ok(mut pending) => pending
                .drain()
                .map(|(_, sender)| sender)
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };
        for sender in senders {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

pub struct PiHost {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: PendingResponses,
    stderr_tail: StderrTail,
    request_timeout: Duration,
    next_id: AtomicU64,
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
        let pending = PendingResponses::default();
        spawn_stderr_reader(stderr, stderr_tail.clone());
        spawn_stdout_reader(stdout, pending.clone(), event_sink);

        let host = Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            stderr_tail,
            request_timeout,
            next_id: AtomicU64::new(1),
        };
        let ping: PingResult = host.call("ping").map_err(HostCallError::message)?;
        if !ping.pong {
            return Err("Pi host ping failed".to_string());
        }
        Ok(host)
    }

    pub fn status(&self) -> Result<PiRuntimeSnapshot, HostCallError> {
        let status: HostStatus = self.call("status")?;
        Ok(status.into())
    }

    pub fn info(&self) -> Result<PiHostInfo, HostCallError> {
        self.call("info")
    }

    pub fn diagnostics(&self) -> Result<PiDiagnostics, HostCallError> {
        self.call("diagnostics")
    }

    pub fn sessions_list(&self) -> Result<PiSessionsList, HostCallError> {
        self.call("sessions.list")
    }

    pub fn session_create(
        &self,
        title: Option<String>,
        cwd: Option<String>,
    ) -> Result<PiSessionCreateResult, HostCallError> {
        self.call_with_params("sessions.create", json!({ "title": title, "cwd": cwd }))
    }

    pub fn session_send(
        &self,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
    ) -> Result<PiSessionSendResult, HostCallError> {
        self.call_with_params(
            "sessions.send",
            json!({ "sessionId": session_id, "prompt": prompt, "context": context }),
        )
    }

    pub fn session_stop(&self, session_id: String) -> Result<PiSessionStopResult, HostCallError> {
        self.call_with_params("sessions.stop", json!({ "sessionId": session_id }))
    }

    pub fn shutdown(&self) {
        let result = self.call::<ShutdownResult>("shutdown");
        if !matches!(result, Ok(ShutdownResult { ok: true })) {
            self.kill_child();
        }
        self.wait_or_kill();
    }

    fn call<T: DeserializeOwned>(&self, method: &str) -> Result<T, HostCallError> {
        self.call_json(method, None)
    }

    fn call_with_params<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T, HostCallError> {
        self.call_json(method, Some(params))
    }

    fn call_json<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<T, HostCallError> {
        self.ensure_running()?;

        let id = self.next_request_id();
        let response_rx = self.pending.register(id);
        let write_result = self.write_request(id, method, params);
        if let Err(error) = write_result {
            self.pending.remove(id);
            return Err(error);
        }

        let line = match response_rx.recv_timeout(self.request_timeout) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(HostCallError::Transport(self.with_stderr(error))),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.remove(id);
                self.kill_child();
                return Err(HostCallError::Transport(self.with_stderr(format!(
                    "Pi host request `{method}` timed out after {}ms",
                    self.request_timeout.as_millis()
                ))));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(HostCallError::Transport(
                    self.with_stderr("Pi host response reader stopped".to_string()),
                ));
            }
        };

        let response: HostResponse<T> = serde_json::from_str(line.trim_end()).map_err(|e| {
            HostCallError::Transport(
                self.with_stderr(format!("Pi host response was not valid JSON: {e}")),
            )
        })?;
        if response.jsonrpc != "2.0" || response.id != id {
            return Err(HostCallError::Transport(
                self.with_stderr("Pi host response id mismatch".to_string()),
            ));
        }
        if let Some(error) = response.error {
            return Err(HostCallError::Method(self.with_stderr(format!(
                "Pi host error {}: {}",
                error.code, error.message
            ))));
        }
        response.result.ok_or_else(|| {
            HostCallError::Transport(self.with_stderr("Pi host response had no result".to_string()))
        })
    }

    fn next_request_id(&self) -> u64 {
        self.next_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                Some(current.checked_add(1).unwrap_or(1))
            })
            .unwrap_or(1)
    }

    fn write_request(
        &self,
        id: u64,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), HostCallError> {
        let mut request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        if let Some(params) = params {
            request["params"] = params;
        }
        let request = serde_json::to_string(&request).map_err(|e| {
            HostCallError::Transport(self.with_stderr(format!("Pi host request failed: {e}")))
        })?;
        let mut stdin = self.stdin.lock().map_err(|e| {
            HostCallError::Transport(self.with_stderr(format!("Pi host stdin lock failed: {e}")))
        })?;
        stdin
            .write_all(request.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| {
                HostCallError::Transport(self.with_stderr(format!("Pi host write failed: {e}")))
            })
    }

    fn ensure_running(&self) -> Result<(), HostCallError> {
        let mut child = self.child.lock().map_err(|e| {
            HostCallError::Transport(self.with_stderr(format!("Pi host child lock failed: {e}")))
        })?;
        match child.try_wait() {
            Ok(Some(status)) => Err(HostCallError::Transport(
                self.with_stderr(format!("Pi host exited with {status}")),
            )),
            Ok(None) => Ok(()),
            Err(error) => Err(HostCallError::Transport(
                self.with_stderr(format!("Pi host status check failed: {error}")),
            )),
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

    fn kill_child(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }

    fn wait_or_kill(&self) {
        let Ok(mut child) = self.child.lock() else {
            return;
        };
        for _ in 0..20 {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => return,
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for PiHost {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
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

fn response_id(line: &str) -> Result<Option<u64>, String> {
    let value: Value = serde_json::from_str(line.trim_end())
        .map_err(|error| format!("Pi host response was not valid JSON: {error}"))?;
    if value.get("method").is_some() {
        return Ok(None);
    }
    let envelope: HostResponseEnvelope = serde_json::from_value(value)
        .map_err(|error| format!("Pi host response envelope was invalid: {error}"))?;
    if envelope.jsonrpc != "2.0" {
        return Err("Pi host response envelope had invalid jsonrpc version".to_string());
    }
    Ok(Some(envelope.id))
}

fn spawn_stdout_reader(
    stdout: ChildStdout,
    pending: PendingResponses,
    event_sink: Option<PiSessionEventSink>,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    pending.fail_all("Pi host closed stdout".to_string());
                    break;
                }
                Ok(_) => {
                    if let Some(event) = session_event_notification(&line) {
                        if let Some(event_sink) = event_sink.as_ref() {
                            event_sink(event);
                        }
                        continue;
                    }
                    match response_id(&line) {
                        Ok(Some(id)) => {
                            let _ = pending.complete_response(id, line);
                        }
                        Ok(None) => pending.fail_all(
                            "Pi host protocol message was neither response nor notification"
                                .to_string(),
                        ),
                        Err(error) => pending.fail_all(error),
                    }
                }
                Err(error) => {
                    pending.fail_all(format!("Pi host read failed: {error}"));
                    break;
                }
            }
        }
    });
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

    select_usable_node_binary(node_binary_candidates(resource_dir))
        .unwrap_or_else(|| PathBuf::from("node"))
}

fn select_usable_node_binary(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file() && is_usable_node_binary(candidate))
}

fn is_usable_node_binary(candidate: &Path) -> bool {
    Command::new(candidate)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn node_binary_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join(bundled_node_relative_path()));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(generated_node_relative_path()));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(generated_node_relative_path()));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("..").join(generated_node_relative_path()));
    candidates
}

fn bundled_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/node.exe")
    } else {
        PathBuf::from("sidecars/node/bin/node")
    }
}

fn generated_node_relative_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("sidecars/node/dist/node.exe")
    } else {
        PathBuf::from("sidecars/node/dist/bin/node")
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
        assert!(candidates.contains(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(generated_node_relative_path())
        ));
    }

    #[cfg(unix)]
    #[test]
    fn select_usable_node_binary_skips_broken_candidates() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let broken = temp.path().join("broken-node");
        let working = temp.path().join("working-node");
        fs::write(&broken, "#!/bin/sh\nexit 1\n").unwrap();
        fs::write(&working, "#!/bin/sh\necho v0.0.0\n").unwrap();
        fs::set_permissions(&broken, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&working, fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            select_usable_node_binary(vec![broken, working.clone()]),
            Some(working)
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
    fn pending_responses_deliver_out_of_order_lines_by_id() {
        let pending = PendingResponses::default();
        let first = pending.register(1);
        let second = pending.register(2);

        assert!(pending.complete_response(2, "two\n".to_string()));
        assert!(pending.complete_response(1, "one\n".to_string()));
        assert!(!pending.complete_response(3, "orphan\n".to_string()));

        assert_eq!(
            first
                .recv_timeout(Duration::from_millis(50))
                .unwrap()
                .unwrap(),
            "one\n"
        );
        assert_eq!(
            second
                .recv_timeout(Duration::from_millis(50))
                .unwrap()
                .unwrap(),
            "two\n"
        );
    }

    #[test]
    fn host_matches_concurrent_out_of_order_responses_by_id() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("host.js");
        fs::write(
            &script,
            r#"
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = [];

function write(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function resultFor(request) {
  if (request.method === 'status') {
    return { phase: 'ready', detail: 'first response' };
  }
  if (request.method === 'info') {
    return { hostVersion: 'fake', piSdkLoaded: true, piPackages: [] };
  }
  throw new Error(`unexpected method ${request.method}`);
}

for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { pong: true } });
    continue;
  }
  if (request.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
    process.exit(0);
  }
  pending.push(request);
  if (pending.length === 2) {
    const [first, second] = pending.splice(0, 2);
    write({ jsonrpc: '2.0', id: second.id, result: resultFor(second) });
    write({ jsonrpc: '2.0', id: first.id, result: resultFor(first) });
  }
}
"#,
        )
        .unwrap();

        let host = Arc::new(
            PiHost::spawn_inner(PathBuf::from("node"), script, Duration::from_secs(5), None)
                .unwrap(),
        );
        let status_host = Arc::clone(&host);
        let info_host = Arc::clone(&host);

        let status = thread::spawn(move || status_host.status());
        let info = thread::spawn(move || info_host.info());

        let status = status.join().unwrap().unwrap();
        let info = info.join().unwrap().unwrap();

        assert_eq!(status.phase, PiPhase::Ready);
        assert_eq!(status.detail.as_deref(), Some("first response"));
        assert_eq!(info.host_version, "fake");

        host.shutdown();
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
