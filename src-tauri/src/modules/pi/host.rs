use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::thread;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use super::{PiPhase, PiRuntimeSnapshot};

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

pub struct PiHost {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl PiHost {
    pub fn spawn() -> Result<Self, String> {
        let host_path = resolve_host_path()?;
        let mut child = Command::new(node_binary())
            .arg(host_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("failed to start Pi host: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Pi host stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Pi host stdout unavailable".to_string())?;

        let mut host = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
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

    pub fn shutdown(mut self) {
        let result = self.call::<ShutdownResult>("shutdown");
        if !matches!(result, Ok(ShutdownResult { ok: true })) {
            let _ = self.child.kill();
        }
        self.wait_or_kill();
    }

    fn call<T: DeserializeOwned>(&mut self, method: &str) -> Result<T, String> {
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).unwrap_or(1);
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        let request = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        self.stdin
            .write_all(request.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("Pi host write failed: {e}"))?;

        let mut line = String::new();
        let read = self
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("Pi host read failed: {e}"))?;
        if read == 0 {
            return Err("Pi host closed stdout".to_string());
        }

        let response: HostResponse<T> = serde_json::from_str(line.trim_end())
            .map_err(|e| format!("Pi host response was not valid JSON: {e}"))?;
        if response.jsonrpc != "2.0" || response.id != id {
            return Err("Pi host response id mismatch".to_string());
        }
        if let Some(error) = response.error {
            return Err(format!("Pi host error {}: {}", error.code, error.message));
        }
        response
            .result
            .ok_or_else(|| "Pi host response had no result".to_string())
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

fn node_binary() -> String {
    env::var("TERAX_NODE_BINARY").unwrap_or_else(|_| "node".to_string())
}

fn resolve_host_path() -> Result<PathBuf, String> {
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

    for candidate in host_path_candidates() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err("could not find sidecars/pi-host/host.js".to_string())
}

fn host_path_candidates() -> Vec<PathBuf> {
    let relative = PathBuf::from("sidecars/pi-host/host.js");
    let mut candidates = Vec::new();

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
