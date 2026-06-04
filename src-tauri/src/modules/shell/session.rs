use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;

use super::run_blocking_inner;
use crate::modules::fs::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

pub struct ShellSession {
    pub cwd: Mutex<String>,
    pub workspace: WorkspaceEnv,
    pub pristine: AtomicBool,
    #[allow(dead_code)]
    pub started_at_ms: u64,
    sentinel: String,
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

// Sentinel is randomized per session so untrusted command stdout can't spoof a
// cwd update by emitting the marker literal.
static SENTINEL_COUNTER: AtomicU64 = AtomicU64::new(0);

fn generate_sentinel() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = SENTINEL_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id() as u64;
    let mix = nanos ^ counter.rotate_left(17) ^ pid.rotate_left(31);
    format!("__TERAX_CWD_{:016x}_{:016x}__", mix, counter)
}

impl ShellSession {
    pub fn new(initial_cwd: String, workspace: WorkspaceEnv) -> Self {
        let started_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self {
            cwd: Mutex::new(initial_cwd),
            workspace,
            pristine: AtomicBool::new(true),
            started_at_ms,
            sentinel: generate_sentinel(),
        }
    }

    pub fn current_cwd(&self) -> String {
        self.cwd.lock().unwrap().clone()
    }

    pub fn run(
        &self,
        command: String,
        cwd_hint: Option<String>,
        workspace_hint: Option<WorkspaceEnv>,
        timeout: Duration,
    ) -> Result<SessionRunOutput, String> {
        let trimmed = command.trim().to_string();
        if trimmed.is_empty() {
            return Err("empty command".into());
        }
        if self.pristine.load(Ordering::Acquire) {
            if let Some(hint) = cwd_hint.filter(|s| !s.is_empty()) {
                let effective_workspace = workspace_hint.as_ref().unwrap_or(&self.workspace);
                let p = resolve_path(&hint, effective_workspace);
                if p.is_dir() {
                    *self.cwd.lock().unwrap() = hint;
                }
            }
        }
        let cwd = self.current_cwd();
        let effective_workspace = workspace_hint.unwrap_or_else(|| self.workspace.clone());
        let wrapped = wrap_with_sentinel(&trimmed, &effective_workspace, &self.sentinel);

        let (tx, rx) = mpsc::channel::<Result<super::CommandOutput, String>>();
        let cwd_for_thread = cwd.clone();
        thread::spawn(move || {
            let _ = tx.send(run_blocking_inner(
                wrapped,
                Some(cwd_for_thread),
                effective_workspace,
                timeout,
            ));
        });
        let raw = rx.recv().map_err(|e| e.to_string())??;
        self.pristine.store(false, Ordering::Release);

        let (stdout_clean, cwd_after) = strip_cwd_sentinel(&raw.stdout, &cwd, &self.sentinel);
        if let Some(ref new_cwd) = cwd_after {
            let p = resolve_path(new_cwd, &self.workspace);
            if p.is_dir() {
                *self.cwd.lock().unwrap() = new_cwd.clone();
            }
        }
        let resolved_cwd = to_canon(self.current_cwd());

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

fn wrap_posix_with_sentinel(command: &str, sentinel: &str) -> String {
    format!(
        "{command}\n__terax_rc=$?\nprintf '\\n%s%s\\n' '{sentinel}' \"$(pwd)\"\nexit $__terax_rc\n",
    )
}

fn wrap_with_sentinel(command: &str, workspace: &WorkspaceEnv, sentinel: &str) -> String {
    if workspace.is_wsl() {
        return wrap_posix_with_sentinel(command, sentinel);
    }
    #[cfg(unix)]
    {
        wrap_posix_with_sentinel(command, sentinel)
    }
    #[cfg(windows)]
    {
        format!(
        "{command}\n$__terax_rc = if ($null -ne $LASTEXITCODE) {{ $LASTEXITCODE }} elseif ($?) {{ 0 }} else {{ 1 }}\n\"`n{sentinel}$($PWD.Path)\"\nexit $__terax_rc\n",
    )
    }
}

fn strip_cwd_sentinel(stdout: &str, _fallback: &str, sentinel: &str) -> (String, Option<String>) {
    if let Some(idx) = stdout.rfind(sentinel) {
        let before = &stdout[..idx];
        let after = &stdout[idx + sentinel.len()..];
        let cwd_line = after.lines().next().unwrap_or("").trim();
        let cleaned = before.trim_end_matches('\n').to_string();
        return (cleaned, Some(cwd_line.to_string()));
    }
    (stdout.to_string(), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinels_are_unique_per_session() {
        let a = ShellSession::new("/tmp".into(), WorkspaceEnv::Local);
        let b = ShellSession::new("/tmp".into(), WorkspaceEnv::Local);
        assert_ne!(a.sentinel, b.sentinel);
        assert!(a.sentinel.starts_with("__TERAX_CWD_"));
        assert!(a.sentinel.ends_with("__"));
        assert!(a.sentinel.len() > 20);
    }

    #[test]
    fn strip_uses_session_sentinel_only() {
        let s = ShellSession::new("/tmp".into(), WorkspaceEnv::Local);
        let attacker = "__TERAX_CWD_0000000000000000_0000000000000000__/evil";
        let trailer = format!("\n{}/real\n", s.sentinel);
        let stdout = format!("{attacker}{trailer}");
        let (clean, cwd) = strip_cwd_sentinel(&stdout, "/fallback", &s.sentinel);
        assert_eq!(cwd.as_deref(), Some("/real"));
        assert!(
            clean.contains(attacker),
            "attacker payload survives in stdout"
        );
    }

    #[test]
    fn strip_returns_none_when_session_sentinel_absent() {
        let s = ShellSession::new("/tmp".into(), WorkspaceEnv::Local);
        let stdout = "some output\n__TERAX_CWD_aaaa_bbbb__/spoof\nmore\n";
        let (_, cwd) = strip_cwd_sentinel(stdout, "/fallback", &s.sentinel);
        assert!(cwd.is_none(), "foreign sentinel must not match");
    }

    #[test]
    fn wrap_embeds_session_sentinel() {
        let s = ShellSession::new("/tmp".into(), WorkspaceEnv::Local);
        let wrapped = wrap_with_sentinel("echo hi", &WorkspaceEnv::Local, &s.sentinel);
        assert!(wrapped.contains(&s.sentinel));
    }
}
