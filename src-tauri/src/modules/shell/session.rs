use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;

use super::run_blocking_inner;

/// A persistent agent shell session. Each `run` call executes through the
/// user's login shell with the session's tracked cwd. Cwd persists across
/// calls; environment overrides via `export` do not (this is an agent shell,
/// not an interactive REPL — interactive tools must NOT be invoked here, use
/// the background process API for long-running work).
pub struct ShellSession {
    pub cwd: Mutex<PathBuf>,
    /// While pristine (no `run` yet), caller-provided cwd hints reseed `cwd`.
    pub pristine: AtomicBool,
    #[allow(dead_code)]
    pub started_at_ms: u64,
}

#[derive(Serialize)]
pub struct SessionRunOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
    pub cwd_after: String,
}

/// Sentinel emitted on stdout immediately before the command exits, so we can
/// recover the post-command cwd. Picks an unlikely literal — collisions with
/// real command output would corrupt cwd tracking.
const CWD_SENTINEL: &str = "__TERAX_CWD__";

impl ShellSession {
    pub fn new(initial_cwd: PathBuf) -> Self {
        let started_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self {
            cwd: Mutex::new(initial_cwd),
            pristine: AtomicBool::new(true),
            started_at_ms,
        }
    }

    pub fn current_cwd(&self) -> PathBuf {
        self.cwd.lock().unwrap().clone()
    }

    pub fn run(
        &self,
        command: String,
        cwd_hint: Option<String>,
        timeout: Duration,
    ) -> Result<SessionRunOutput, String> {
        let trimmed = command.trim().to_string();
        if trimmed.is_empty() {
            return Err("empty command".into());
        }
        if self.pristine.load(Ordering::Acquire) {
            if let Some(hint) = cwd_hint.filter(|s| !s.is_empty()) {
                let p = PathBuf::from(&hint);
                if p.is_dir() {
                    *self.cwd.lock().unwrap() = p;
                }
            }
        }
        let cwd = self.current_cwd();
        let wrapped = wrap_with_sentinel(&trimmed);

        let (tx, rx) = mpsc::channel::<Result<super::CommandOutput, String>>();
        let cwd_for_thread = cwd.clone();
        thread::spawn(move || {
            let _ = tx.send(run_blocking_inner(wrapped, Some(cwd_for_thread), timeout));
        });
        let raw = rx.recv().map_err(|e| e.to_string())??;
        self.pristine.store(false, Ordering::Release);

        let (stdout_clean, cwd_after) = strip_cwd_sentinel(&raw.stdout, &cwd);
        if let Some(ref new_cwd) = cwd_after {
            let p = PathBuf::from(new_cwd);
            if p.is_dir() {
                *self.cwd.lock().unwrap() = p;
            }
        }
        let resolved_cwd = crate::modules::fs::to_canon(self.current_cwd());

        Ok(SessionRunOutput {
            stdout: stdout_clean,
            stderr: raw.stderr,
            exit_code: raw.exit_code,
            timed_out: raw.timed_out,
            truncated: raw.truncated,
            cwd_after: resolved_cwd,
        })
    }
}

#[cfg(unix)]
fn wrap_with_sentinel(command: &str) -> String {
    format!(
        "{command}\n__terax_rc=$?\nprintf '\\n%s%s\\n' '{CWD_SENTINEL}' \"$(pwd)\"\nexit $__terax_rc\n",
    )
}

#[cfg(windows)]
fn wrap_with_sentinel(command: &str) -> String {
    format!(
        "{command}\n$__terax_rc = if ($null -ne $LASTEXITCODE) {{ $LASTEXITCODE }} elseif ($?) {{ 0 }} else {{ 1 }}\n\"`n{CWD_SENTINEL}$($PWD.Path)\"\nexit $__terax_rc\n",
    )
}

fn strip_cwd_sentinel(stdout: &str, _fallback: &PathBuf) -> (String, Option<String>) {
    if let Some(idx) = stdout.rfind(CWD_SENTINEL) {
        let before = &stdout[..idx];
        let after = &stdout[idx + CWD_SENTINEL.len()..];
        let cwd_line = after.lines().next().unwrap_or("").trim();
        let cleaned = before.trim_end_matches('\n').to_string();
        return (cleaned, Some(cwd_line.to_string()));
    }
    (stdout.to_string(), None)
}
