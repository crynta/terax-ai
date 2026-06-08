use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use shared_child::SharedChild;
use tauri::ipc::Channel;

use super::resolve::{resolve_lsp, LspTarget};
use super::transport::{encode_message, FrameReader};
use crate::modules::workspace::{host_path_to_wsl_cd, resolve_path, validate_wsl_distro_name, WorkspaceEnv};

pub struct LspSession {
    child: Arc<SharedChild>,
    stdin: Mutex<std::process::ChildStdin>,
    alive: Arc<AtomicBool>,
}

impl LspSession {
    pub fn send(&self, json: &str) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("lsp session closed".into());
        }
        let framed = encode_message(json.as_bytes());
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        stdin
            .write_all(&framed)
            .map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        self.alive.store(false, Ordering::Release);
        let _ = self.child.kill();
    }
}

impl Drop for LspSession {
    fn drop(&mut self) {
        self.kill();
    }
}

fn is_allowed_command(command: &str) -> bool {
    super::resolve::is_allowed_command(command)
}

fn spawn_reader(
    stdout: impl Read + Send + 'static,
    alive: Arc<AtomicBool>,
    on_message: Channel<String>,
) {
    thread::spawn(move || {
        let mut pipe = stdout;
        let mut buf = [0u8; 8192];
        let mut reader = FrameReader::default();
        loop {
            match pipe.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for frame in reader.push(&buf[..n]) {
                        if on_message.send(frame).is_err() {
                            alive.store(false, Ordering::Release);
                            return;
                        }
                    }
                }
            }
        }
        alive.store(false, Ordering::Release);
    });
}

fn spawn_stderr_reader(
    stderr: impl Read + Send + 'static,
    on_stderr: Channel<String>,
) {
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pipe = stderr;
        loop {
            match pipe.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Ok(text) = std::str::from_utf8(&buf[..n]) {
                        for line in text.lines() {
                            if line.is_empty() {
                                continue;
                            }
                            log::debug!("lsp stderr: {line}");
                            if on_stderr.send(line.to_string()).is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }
    });
}

fn finish_spawn(
    child: Arc<SharedChild>,
    on_message: Channel<String>,
    on_stderr: Channel<String>,
) -> Result<Arc<LspSession>, String> {
    let stdin = child.take_stdin().ok_or("lsp stdin unavailable")?;
    let stdout = child.take_stdout().ok_or("lsp stdout unavailable")?;
    let stderr = child.take_stderr();
    if let Some(stderr_pipe) = stderr {
        spawn_stderr_reader(stderr_pipe, on_stderr);
    }
    let alive = Arc::new(AtomicBool::new(true));
    spawn_reader(stdout, Arc::clone(&alive), on_message);
    Ok(Arc::new(LspSession {
        child,
        stdin: Mutex::new(stdin),
        alive,
    }))
}

#[cfg(windows)]
fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn wsl_exec_script(command: &str, args: &[String]) -> String {
    let mut parts = vec![sh_single_quote(command)];
    parts.extend(args.iter().map(|a| sh_single_quote(a)));
    format!("exec {}", parts.join(" "))
}

#[cfg(windows)]
fn wsl_command_is_absolute(command: &str) -> bool {
    command.starts_with('/') || command.starts_with("~/") || command.starts_with("./")
}

#[cfg(windows)]
fn spawn_wsl(
    distro: &str,
    command: &str,
    args: &[String],
    cwd_host: &Path,
    on_message: Channel<String>,
    on_stderr: Channel<String>,
) -> Result<Arc<LspSession>, String> {
    validate_wsl_distro_name(distro)?;
    let wsl_cwd = host_path_to_wsl_cd(distro, cwd_host)?;
    log::info!(
        "lsp spawning WSL {distro}: {command} (cwd={wsl_cwd})"
    );
    let mut cmd = Command::new("wsl.exe");
    cmd.arg("-d").arg(distro).arg("--cd").arg(&wsl_cwd);

    if wsl_command_is_absolute(command) {
        cmd.arg("--exec").arg(command).args(args);
    } else {
        // Bare names like `rust-analyzer` live on PATH in login shells (~/.cargo/bin),
        // not in the minimal environment used by `wsl --exec`.
        let script = wsl_exec_script(command, args);
        cmd.arg("sh").arg("-lc").arg(script);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    finish_spawn(child, on_message, on_stderr)
}

fn spawn_host(
    executable: &Path,
    args: &[String],
    cwd: &Path,
    on_message: Channel<String>,
    on_stderr: Channel<String>,
) -> Result<Arc<LspSession>, String> {
    log::info!("lsp resolved executable: {}", executable.display());
    let mut cmd = crate::modules::proc::command_for_executable(executable);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    super::local::apply_lsp_environment(&mut cmd);
    crate::modules::proc::hide_console(&mut cmd);
    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    finish_spawn(child, on_message, on_stderr)
}

pub fn spawn(
    command: String,
    args: Vec<String>,
    cwd: String,
    workspace: WorkspaceEnv,
    on_message: Channel<String>,
    on_stderr: Channel<String>,
) -> Result<Arc<LspSession>, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("empty lsp command".into());
    }
    if !is_allowed_command(trimmed) {
        return Err(format!("lsp command not allowed: {trimmed}"));
    }

    let target = resolve_lsp(trimmed)?;
    let resolved_cwd = resolve_path(&cwd, &workspace);
    if !resolved_cwd.is_dir() {
        return Err(format!("cwd is not a directory: {cwd}"));
    }

    match target {
        LspTarget::Wsl { distro, command: wsl_cmd } => {
            #[cfg(windows)]
            {
                return spawn_wsl(
                    &distro,
                    &wsl_cmd,
                    &args,
                    &resolved_cwd,
                    on_message,
                    on_stderr,
                );
            }
            #[cfg(not(windows))]
            {
                let _ = (distro, wsl_cmd, args, resolved_cwd, on_message, on_stderr);
                return Err("WSL language servers are only supported on Windows".into());
            }
        }
        LspTarget::Host { path, .. } => {
            spawn_host(&path, &args, &resolved_cwd, on_message, on_stderr)
        }
    }
}
