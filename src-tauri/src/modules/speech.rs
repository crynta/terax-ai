mod install;
mod process;
mod protocol;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, State};

pub use install::{NativeSpeechInstallEvent, NativeSpeechStatus};
use process::{ActiveSpeechProcess, NativeSpeechManager};
use protocol::{validate_language_tag, validate_sample_rate, SpeechProfile, MAX_SAMPLE_BYTES};

const PROFILE_HEADER: &str = "terax-stt-profile";
const SAMPLE_RATE_HEADER: &str = "terax-stt-sample-rate";
const LANGUAGE_HEADER: &str = "terax-stt-language";
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct NativeSpeechState {
    gate: tokio::sync::Mutex<()>,
    manager: Arc<Mutex<NativeSpeechManager>>,
    active: ActiveSpeechProcess,
    generation: Arc<AtomicU64>,
}

impl NativeSpeechState {
    pub fn new() -> Self {
        let active = ActiveSpeechProcess::default();
        Self {
            gate: tokio::sync::Mutex::new(()),
            manager: Arc::new(Mutex::new(NativeSpeechManager::new(active.clone()))),
            active,
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    fn stop(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut manager) = self.manager.lock() {
            manager.stop();
        }
    }

    pub fn kill_all(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
        self.active.kill();
        if let Ok(mut manager) = self.manager.try_lock() {
            manager.stop();
        }
    }

    fn schedule_idle_stop(&self) {
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let current = self.generation.clone();
        let manager = self.manager.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(IDLE_TIMEOUT).await;
            if current.load(Ordering::Relaxed) == generation {
                if let Ok(mut manager) = manager.try_lock() {
                    if current.load(Ordering::Relaxed) == generation {
                        manager.stop();
                    }
                }
            }
        });
    }
}

impl Default for NativeSpeechState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub fn stt_native_status(app: AppHandle) -> Result<NativeSpeechStatus, String> {
    install::status(&app)
}

#[tauri::command]
pub async fn stt_native_install(
    app: AppHandle,
    state: State<'_, NativeSpeechState>,
    profile: String,
    on_event: Channel<NativeSpeechInstallEvent>,
) -> Result<NativeSpeechStatus, String> {
    let profile = SpeechProfile::parse(&profile)?;
    let _gate = state.gate.lock().await;
    state.stop();
    install::install(&app, profile, &on_event).await
}

#[tauri::command]
pub async fn stt_native_transcribe(
    app: AppHandle,
    state: State<'_, NativeSpeechState>,
    request: Request<'_>,
) -> Result<String, String> {
    let profile = SpeechProfile::parse(&request_header(&request, PROFILE_HEADER)?)?;
    let sample_rate = request_header(&request, SAMPLE_RATE_HEADER)?
        .parse::<u32>()
        .map_err(|_| "native transcription sample rate is invalid".to_string())?;
    validate_sample_rate(sample_rate)?;
    let language = request
        .headers()
        .get(LANGUAGE_HEADER)
        .map(|value| {
            value
                .to_str()
                .map(str::to_string)
                .map_err(|_| "native transcription language tag is invalid".to_string())
        })
        .transpose()?
        .unwrap_or_else(|| "auto".into());
    validate_language_tag(&language)?;
    let samples = request_bytes(&request)?;
    let current_status = install::status(&app)?;
    let model_installed = match profile {
        SpeechProfile::Nemotron => current_status.nemotron_installed,
        SpeechProfile::Parakeet => current_status.parakeet_installed,
    };
    if !current_status.runtime_installed || !model_installed {
        return Err(format!(
            "{} native speech is not installed. Install it in Settings before recording.",
            profile.id()
        ));
    }
    let paths = install::process_paths(&app)?;

    let _gate = state.gate.lock().await;
    state.generation.fetch_add(1, Ordering::Relaxed);
    let manager = state.manager.clone();
    let language_for_process = language.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut manager = manager
            .lock()
            .map_err(|_| "native speech manager lock failed".to_string())?;
        manager.transcribe(
            process::ProcessConfig {
                binary: paths.binary,
                runtime_dir: paths.runtime_dir,
                core_model_dir: paths.core_model_dir,
                swift_model_root: paths.swift_model_root,
            },
            profile,
            sample_rate,
            &language_for_process,
            &samples,
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_ok() {
        state.schedule_idle_stop();
    }
    result
}

fn request_header(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing {name} header"))?
        .to_str()
        .map(str::to_string)
        .map_err(|_| format!("invalid {name} header"))
}

fn request_bytes(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(data) => {
            if data.len() > MAX_SAMPLE_BYTES {
                return Err("native transcription request is too large".into());
            }
            protocol::validate_pcm_bytes(data)?;
            Ok(data.clone())
        }
        _ => Err("native transcription audio must use raw IPC bytes".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_language_boundary() {
        for valid in ["auto", "en-US", "de_DE"] {
            assert!(validate_language_tag(valid).is_ok());
        }
        for invalid in ["", "en US", "../../en", "en\nUS"] {
            assert!(validate_language_tag(invalid).is_err());
        }
    }
}
