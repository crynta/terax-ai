use std::io::Read;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use serde::Serialize;
use shared_child::SharedChild;

use super::ringbuffer::BoundedRingBuffer;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const RING_CAP: usize = 4 * 1024 * 1024;
const THREAD_STACK: usize = 128 * 1024;

fn spawn_thread(name: &str, work: impl FnOnce() + Send + 'static) -> Result<(), String> {
    thread::Builder::new()
        .name(name.into())
        .stack_size(THREAD_STACK)
        .spawn(work)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn pump(mut pipe: impl Read, proc: &BackgroundProc) {
    let mut buf = [0u8; 8192];
    loop {
        match pipe.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => proc.buffer.lock().unwrap().push(&buf[..n]),
        }
    }
}

pub struct BackgroundProc {
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub child: Arc<SharedChild>,
    pub buffer: Mutex<BoundedRingBuffer>,
    pub exited: AtomicBool,
    pub exit_code: AtomicI32,
    pub exit_unknown: AtomicBool,
}

#[derive(Serialize)]
pub struct BackgroundLogResponse {
    pub bytes: String,
    pub next_offset: u64,
    pub dropped: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct BackgroundProcInfo {
    pub handle: u32,
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

impl BackgroundProc {
    pub fn read_logs(&self, since: u64) -> BackgroundLogResponse {
        let (bytes, next_offset, dropped) = self.buffer.lock().unwrap().read_from(since);
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundLogResponse {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited,
            exit_code,
        }
    }

    pub fn kill(&self) {
        let _ = self.child.kill();
    }

    pub fn info(&self, handle: u32) -> BackgroundProcInfo {
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundProcInfo {
            handle,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            started_at_ms: self.started_at_ms,
            exited,
            exit_code,
        }
    }
}

impl Drop for BackgroundProc {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn spawn(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<Arc<BackgroundProc>, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    if let Some(ref dir) = cwd {
        if !resolve_path(dir, &workspace).is_dir() {
            return Err(format!("cwd is not a directory: {dir}"));
        }
    }

    let mut cmd = super::build_oneshot_command(&trimmed, &workspace, cwd.as_deref())?;
    if let (WorkspaceEnv::Local, Some(ref dir)) = (&workspace, &cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    let shared = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let kill_on_fail = || {
        let _ = shared.kill();
    };
    let stdout_pipe = shared.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "no stdout pipe".to_string()
    })?;
    let stderr_pipe = shared.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "no stderr pipe".to_string()
    })?;
    let child = shared;

    let started_at_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let proc = Arc::new(BackgroundProc {
        command: trimmed,
        cwd,
        started_at_ms,
        child,
        buffer: Mutex::new(BoundedRingBuffer::new(RING_CAP)),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    let fail = |error: String| {
        proc.kill();
        error
    };
    for (name, pipe) in [
        (
            "terax-bg-out",
            Box::new(stdout_pipe) as Box<dyn Read + Send>,
        ),
        (
            "terax-bg-err",
            Box::new(stderr_pipe) as Box<dyn Read + Send>,
        ),
    ] {
        let proc_ref = proc.clone();
        spawn_thread(name, move || pump(pipe, &proc_ref)).map_err(fail)?;
    }
    {
        let proc_ref = proc.clone();
        let child_for_wait = proc.child.clone();
        spawn_thread("terax-bg-wait", move || {
            match child_for_wait.wait() {
                Ok(status) => match status.code() {
                    Some(code) => proc_ref.exit_code.store(code, Ordering::Release),
                    None => proc_ref.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => proc_ref.exit_unknown.store(true, Ordering::Release),
            }
            proc_ref.exited.store(true, Ordering::Release);
        })
        .map_err(fail)?;
    }

    Ok(proc)
}
