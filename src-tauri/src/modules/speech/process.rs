use std::collections::VecDeque;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use shared_child::SharedChild;

use super::protocol::{
    read_response, write_ping_request, write_shutdown_request, write_transcribe_request,
    BridgeResponse, SpeechProfile,
};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const TRANSCRIPTION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const STDERR_LIMIT: usize = 128 * 1024;

pub struct ProcessConfig {
    pub binary: PathBuf,
    pub runtime_dir: PathBuf,
    pub core_model_dir: PathBuf,
    pub swift_model_root: PathBuf,
}

pub struct NativeSpeechManager {
    process: Option<BridgeProcess>,
    active: ActiveSpeechProcess,
}

impl NativeSpeechManager {
    pub fn new(active: ActiveSpeechProcess) -> Self {
        Self {
            process: None,
            active,
        }
    }

    pub fn stop(&mut self) {
        self.process = None;
    }

    pub fn transcribe(
        &mut self,
        config: ProcessConfig,
        profile: SpeechProfile,
        sample_rate: u32,
        language: &str,
        samples: &[u8],
    ) -> Result<String, String> {
        let should_spawn = self
            .process
            .as_ref()
            .is_none_or(|process| process.binary != config.binary);
        if should_spawn {
            self.stop();
            self.process = Some(BridgeProcess::spawn(config, profile, self.active.clone())?);
        }
        let result = self
            .process
            .as_mut()
            .expect("bridge process must exist")
            .transcribe(profile, sample_rate, language, samples);
        if result.is_err() {
            self.stop();
        }
        result
    }
}

impl Default for NativeSpeechManager {
    fn default() -> Self {
        Self::new(ActiveSpeechProcess::default())
    }
}

#[derive(Clone, Default)]
pub struct ActiveSpeechProcess {
    child: Arc<Mutex<Option<Arc<SharedChild>>>>,
}

impl ActiveSpeechProcess {
    fn register(&self, child: Arc<SharedChild>) {
        if let Ok(mut active) = self.child.lock() {
            *active = Some(child);
        }
    }

    fn clear(&self, pid: u32) {
        if let Ok(mut active) = self.child.lock() {
            if active.as_ref().is_some_and(|child| child.id() == pid) {
                *active = None;
            }
        }
    }

    pub fn kill(&self) {
        let child = self
            .child
            .lock()
            .ok()
            .and_then(|active| active.as_ref().cloned());
        if let Some(child) = child {
            kill_child(&child);
        }
    }
}

struct BridgeProcess {
    binary: PathBuf,
    profile: SpeechProfile,
    child: Arc<SharedChild>,
    active: ActiveSpeechProcess,
    stdin: ChildStdin,
    responses: Receiver<Result<BridgeResponse, String>>,
    stderr: Arc<Mutex<VecDeque<u8>>>,
    stdout_reader: Option<JoinHandle<()>>,
    stderr_reader: Option<JoinHandle<()>>,
    #[cfg(windows)]
    _job: crate::modules::proc::job::ProcessJob,
}

impl BridgeProcess {
    fn spawn(
        config: ProcessConfig,
        profile: SpeechProfile,
        active: ActiveSpeechProcess,
    ) -> Result<Self, String> {
        let mut command = Command::new(&config.binary);
        command
            .current_dir(&config.runtime_dir)
            .env("TERAX_SPEECH_MODEL_DIR", &config.core_model_dir)
            .env("TERAX_SPEECH_SWIFT_MODEL_DIR", &config.swift_model_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_runtime_path(&mut command, &config.runtime_dir)?;
        crate::modules::proc::hide_console(&mut command);
        #[cfg(unix)]
        unsafe {
            use std::os::unix::process::CommandExt;
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }

        let child = Arc::new(
            SharedChild::spawn(&mut command)
                .map_err(|error| format!("could not start native speech runtime: {error}"))?,
        );
        #[cfg(windows)]
        let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
            Ok(job) => job,
            Err(error) => {
                terminate_child(&child);
                return Err(format!(
                    "could not secure native speech runtime process tree: {error}"
                ));
            }
        };
        active.register(child.clone());
        let Some(stdin) = child.take_stdin() else {
            terminate_child(&child);
            active.clear(child.id());
            return Err("native speech stdin is unavailable".into());
        };
        let Some(mut stdout) = child.take_stdout() else {
            terminate_child(&child);
            active.clear(child.id());
            return Err("native speech stdout is unavailable".into());
        };
        let Some(mut stderr_pipe) = child.take_stderr() else {
            terminate_child(&child);
            active.clear(child.id());
            return Err("native speech stderr is unavailable".into());
        };

        let (response_tx, responses) = mpsc::channel();
        let stdout_reader = match std::thread::Builder::new()
            .name("terax-speech-response".into())
            .spawn(move || loop {
                let response = read_response(&mut stdout);
                let failed = response.is_err();
                if response_tx.send(response).is_err() || failed {
                    break;
                }
            }) {
            Ok(reader) => reader,
            Err(error) => {
                terminate_child(&child);
                active.clear(child.id());
                return Err(error.to_string());
            }
        };

        let stderr = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_LIMIT)));
        let stderr_output = stderr.clone();
        let stderr_reader = match std::thread::Builder::new()
            .name("terax-speech-stderr".into())
            .spawn(move || {
                let mut chunk = [0u8; 4096];
                while let Ok(read) = stderr_pipe.read(&mut chunk) {
                    if read == 0 {
                        break;
                    }
                    if let Ok(mut output) = stderr_output.lock() {
                        for byte in &chunk[..read] {
                            if output.len() == STDERR_LIMIT {
                                output.pop_front();
                            }
                            output.push_back(*byte);
                        }
                    }
                }
            }) {
            Ok(reader) => reader,
            Err(error) => {
                terminate_child(&child);
                active.clear(child.id());
                let _ = stdout_reader.join();
                return Err(error.to_string());
            }
        };

        let mut process = Self {
            binary: config.binary,
            profile,
            child,
            active,
            stdin,
            responses,
            stderr,
            stdout_reader: Some(stdout_reader),
            stderr_reader: Some(stderr_reader),
            #[cfg(windows)]
            _job: job,
        };
        write_ping_request(&mut process.stdin, profile)?;
        let response = process.receive(
            STARTUP_TIMEOUT,
            "native speech runtime did not respond within 10 seconds",
        )?;
        if response.profile != profile || !response.success || response.body != "ready" {
            return Err(process.error_with_stderr("native speech runtime did not become ready"));
        }
        Ok(process)
    }

    fn transcribe(
        &mut self,
        profile: SpeechProfile,
        sample_rate: u32,
        language: &str,
        samples: &[u8],
    ) -> Result<String, String> {
        write_transcribe_request(&mut self.stdin, profile, sample_rate, language, samples)?;
        let response = self.receive(
            TRANSCRIPTION_TIMEOUT,
            "native speech transcription timed out after 15 minutes",
        )?;
        if response.profile != profile {
            return Err("native speech runtime returned the wrong profile".into());
        }
        self.profile = profile;
        if response.success {
            Ok(response.body)
        } else {
            Err(self.error_with_stderr(&response.body))
        }
    }

    fn receive(&self, timeout: Duration, timeout_message: &str) -> Result<BridgeResponse, String> {
        self.responses
            .recv_timeout(timeout)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => self.error_with_stderr(timeout_message),
                mpsc::RecvTimeoutError::Disconnected => {
                    self.error_with_stderr("native speech runtime stopped unexpectedly")
                }
            })?
    }

    fn error_with_stderr(&self, message: &str) -> String {
        let detail = self
            .stderr
            .lock()
            .ok()
            .and_then(|bytes| last_stderr_line(&bytes));
        match detail {
            Some(detail) if !message.contains(&detail) => format!("{message}: {detail}"),
            _ => message.to_string(),
        }
    }
}

impl Drop for BridgeProcess {
    fn drop(&mut self) {
        let pid = self.child.id();
        let _ = write_shutdown_request(&mut self.stdin, self.profile);
        let mut exited = false;
        for _ in 0..20 {
            match self.child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        if !exited {
            terminate_child(&self.child);
        }
        if let Some(reader) = self.stdout_reader.take() {
            let _ = reader.join();
        }
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
        self.active.clear(pid);
    }
}

fn kill_child(child: &SharedChild) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
    let _ = child.kill();
}

fn terminate_child(child: &SharedChild) {
    kill_child(child);
    let _ = child.wait();
}

fn last_stderr_line(bytes: &VecDeque<u8>) -> Option<String> {
    let bytes = bytes.iter().copied().collect::<Vec<_>>();
    let text = String::from_utf8_lossy(&bytes);
    text.lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(target_os = "linux")]
fn configure_runtime_path(command: &mut Command, runtime_dir: &Path) -> Result<(), String> {
    command.env("LD_LIBRARY_PATH", runtime_dir);
    Ok(())
}

#[cfg(windows)]
fn configure_runtime_path(command: &mut Command, runtime_dir: &Path) -> Result<(), String> {
    let mut paths = vec![runtime_dir.to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    let path = std::env::join_paths(paths).map_err(|error| error.to_string())?;
    command.env("PATH", path);
    Ok(())
}

#[cfg(not(any(target_os = "linux", windows)))]
fn configure_runtime_path(_command: &mut Command, _runtime_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stderr_detail_uses_the_last_nonempty_line() {
        let bytes = b"loading\nlast failure\n".iter().copied().collect();
        assert_eq!(last_stderr_line(&bytes).as_deref(), Some("last failure"));
    }

    #[cfg(unix)]
    #[test]
    fn active_process_kill_terminates_the_registered_child() {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("sleep 30");
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
        let child = Arc::new(SharedChild::spawn(&mut command).unwrap());
        let active = ActiveSpeechProcess::default();
        active.register(child.clone());

        active.kill();

        assert!(!child.wait().unwrap().success());
    }
}
