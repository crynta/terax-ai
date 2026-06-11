pub mod queue;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Manager;

use super::VoiceState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TtsProvider {
    Cartesia,
    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    AvSpeech,
}

impl TtsProvider {
    pub fn from_name(name: &str) -> Result<Self, String> {
        match name {
            "cartesia" => Ok(Self::Cartesia),
            #[cfg(all(target_os = "macos", feature = "openclicky"))]
            "avspeech" => Ok(Self::AvSpeech),
            _ => Err(format!("unknown TTS provider: {name}")),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Cartesia => "cartesia",
            #[cfg(all(target_os = "macos", feature = "openclicky"))]
            Self::AvSpeech => "avspeech",
        }
    }
}

#[derive(Default)]
pub struct TtsState {
    pub speaking: Arc<Mutex<bool>>,
    pub cancel: Arc<Mutex<bool>>,
    pub queue: queue::TtsQueue,
    pub last_provider: Arc<Mutex<String>>,
}

pub async fn speak(
    app: &tauri::AppHandle,
    text: &str,
    provider: &str,
) -> Result<(), String> {
    let state = app.state::<VoiceState>();

    {
        let mut speaking = state.tts.speaking.lock().map_err(|e| e.to_string())?;
        if *speaking {
            drop(speaking);
            return state
                .tts
                .queue
                .enqueue(text.to_string(), provider.to_string());
        }
        *speaking = true;
    }

    {
        let mut cancel = state.tts.cancel.lock().map_err(|e| e.to_string())?;
        *cancel = false;
    }
    {
        let mut lp = state.tts.last_provider.lock().map_err(|e| e.to_string())?;
        *lp = provider.to_string();
    }

    let prov = TtsProvider::from_name(provider)?;

    let result = match prov {
        TtsProvider::Cartesia => cartesia::speak(app, text, &state.tts).await,
        #[cfg(all(target_os = "macos", feature = "openclicky"))]
        TtsProvider::AvSpeech => avspeech::speak(text, &state.tts),
    };

    {
        let mut speaking = state.tts.speaking.lock().map_err(|e| e.to_string())?;
        *speaking = false;
    }

    drain_queue(app);

    result
}

fn drain_queue(app: &tauri::AppHandle) {
    let state = app.state::<VoiceState>();
    if let Some(queue::TtsQueueMsg::Speak { text, provider }) = state.tts.queue.try_next() {
        let app = app.clone();
        // Use Tauri's managed runtime, not tokio::spawn: TTS commands run without
        // an ambient tokio reactor, so a bare spawn panics (see fix 3d4fcff).
        tauri::async_runtime::spawn(async move {
            let _ = speak(&app, &text, &provider).await;
        });
    }
}

pub fn stop(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    {
        let mut cancel = state.tts.cancel.lock().map_err(|e| e.to_string())?;
        *cancel = true;
    }
    {
        let mut speaking = state.tts.speaking.lock().map_err(|e| e.to_string())?;
        *speaking = false;
    }
    while state.tts.queue.try_next().is_some() {}
    Ok(())
}

pub fn status(app: &tauri::AppHandle) -> Result<super::TtsStatus, String> {
    let state = app.state::<VoiceState>();
    let speaking = state
        .tts
        .speaking
        .lock()
        .map_err(|e| e.to_string())?
        .to_owned();
    let provider = state
        .tts
        .last_provider
        .lock()
        .map_err(|e| e.to_string())?
        .to_owned();
    Ok(super::TtsStatus {
        speaking,
        provider: if provider.is_empty() {
            "cartesia".to_string()
        } else {
            provider
        },
        queued: state.tts.queue.len(),
    })
}

mod cartesia {
    use tauri::Manager;

    use crate::modules::voice::tts::TtsState;

    const MAX_TTS_CHARS: usize = 4096;
    const REQUEST_TIMEOUT_SECS: u64 = 30;

    pub async fn speak(
        app: &tauri::AppHandle,
        text: &str,
        state: &TtsState,
    ) -> Result<(), String> {
        if text.chars().count() > MAX_TTS_CHARS {
            return Err(format!(
                "TTS text exceeds the {MAX_TTS_CHARS} character limit"
            ));
        }

        let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
        let api_key = crate::modules::secrets::get_secret_value(
            app,
            &secrets_state,
            "terax",
            "cartesia-api-key",
        )?
        .ok_or("Cartesia API key not set. Add it in Settings > Keys.")?;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("Cartesia client init failed: {e}"))?;
        let body = serde_json::json!({
            "model_id": "sonic-2",
            "transcript": text,
            "voice": {"mode": "id", "id": "694f9387-aab1-4b08-9ca0-e2b7b28a77e0"},
            "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 24000},
        });

        let response = client
            .post("https://api.cartesia.ai/tts/bytes")
            .header("Cartesia-Version", "2024-06-10")
            .header("X-API-Key", &api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Cartesia request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Cartesia API error {status}: {body}"));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Cartesia download failed: {e}"))?;

        let cancelled = state
            .cancel
            .lock()
            .map_err(|e| e.to_string())?
            .to_owned();
        if cancelled {
            return Ok(());
        }

        let bytes = bytes.to_vec();
        let cancel = state.cancel.clone();
        tokio::task::spawn_blocking(move || play_pcm_wav(&bytes, &cancel))
            .await
            .map_err(|e| format!("audio playback task: {e}"))??;
        Ok(())
    }

    #[cfg(feature = "openclicky")]
    fn play_pcm_wav(data: &[u8], cancel: &std::sync::Arc<std::sync::Mutex<bool>>) -> Result<(), String> {
        let (_stream, stream_handle) = rodio::OutputStream::try_default()
            .map_err(|e| format!("audio output failed: {e}"))?;
        let sink = rodio::Sink::try_new(&stream_handle)
            .map_err(|e| format!("audio sink failed: {e}"))?;

        let cursor = std::io::Cursor::new(data.to_vec());
        let decoder = rodio::Decoder::new(std::io::BufReader::new(cursor))
            .map_err(|e| format!("audio decode failed: {e}"))?;
        sink.append(decoder);

        while !sink.empty() {
            let cancelled = cancel.lock().map(|g| *g).unwrap_or(false);
            if cancelled {
                sink.stop();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        Ok(())
    }

    #[cfg(not(feature = "openclicky"))]
    fn play_pcm_wav(_data: &[u8], _cancel: &std::sync::Arc<std::sync::Mutex<bool>>) -> Result<(), String> {
        Err("audio playback requires the openclicky feature".to_string())
    }
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
mod avspeech {
    use crate::modules::voice::tts::TtsState;

    pub fn speak(text: &str, state: &TtsState) -> Result<(), String> {
        let _mtm = objc2::MainThreadMarker::new()
            .ok_or("AVSpeech must be called on the main thread")?;

        // SAFETY: msg_send alloc/init on the NSAutoreleasePool class, which is
        // resolved at runtime; the selectors and return type match AppKit's ABI.
        let pool: &objc2::runtime::AnyObject = unsafe {
            let cls = objc2::runtime::AnyClass::get(c"NSAutoreleasePool")
                .ok_or("NSAutoreleasePool not found")?;
            let alloc: &objc2::runtime::AnyObject = objc2::msg_send![cls, alloc];
            objc2::msg_send![alloc, init]
        };

        // SAFETY: msg_send alloc/init on the AVSpeechSynthesizer class; selectors
        // and return type match the AVFoundation ABI.
        let synth: &objc2::runtime::AnyObject = unsafe {
            let cls = objc2::runtime::AnyClass::get(c"AVSpeechSynthesizer")
                .ok_or("AVSpeechSynthesizer class not found")?;
            let alloc: &objc2::runtime::AnyObject = objc2::msg_send![cls, alloc];
            objc2::msg_send![alloc, init]
        };

        // SAFETY: msg_send alloc/initWithString on AVSpeechUtterance with a valid
        // NSString argument; selectors and types match the AVFoundation ABI.
        let utterance: &objc2::runtime::AnyObject = unsafe {
            let cls = objc2::runtime::AnyClass::get(c"AVSpeechUtterance")
                .ok_or("AVSpeechUtterance class not found")?;
            let ns_text = objc2_foundation::NSString::from_str(text);
            let alloc: &objc2::runtime::AnyObject = objc2::msg_send![cls, alloc];
            objc2::msg_send![alloc, initWithString: &*ns_text]
        };

        // SAFETY: synth is a valid AVSpeechSynthesizer; speakUtterance takes the
        // utterance object and returns void.
        unsafe {
            let () = objc2::msg_send![synth, speakUtterance: utterance];
        }

        let start = std::time::Instant::now();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(50));

            let cancelled = state.cancel.lock().map_err(|e| e.to_string())?.to_owned();
            if cancelled {
                // SAFETY: synth is a valid synthesizer; stopSpeakingAtBoundary
                // takes an NSInteger boundary and returns void.
                unsafe {
                    let () = objc2::msg_send![synth, stopSpeakingAtBoundary: 0];
                }
                // SAFETY: pool is a valid NSAutoreleasePool; drain returns void.
                unsafe {
                    let () = objc2::msg_send![pool, drain];
                }
                return Ok(());
            }

            // SAFETY: synth is a valid synthesizer; isSpeaking returns a BOOL.
            let speaking: bool = unsafe { objc2::msg_send![synth, isSpeaking] };
            if !speaking {
                break;
            }

            if start.elapsed().as_secs() > 120 {
                // SAFETY: synth is a valid synthesizer; stopSpeakingAtBoundary
                // takes an NSInteger boundary and returns void.
                unsafe {
                    let () = objc2::msg_send![synth, stopSpeakingAtBoundary: 0];
                }
                break;
            }
        }

        // SAFETY: pool is a valid NSAutoreleasePool; drain returns void.
        unsafe {
            let () = objc2::msg_send![pool, drain];
        }

        Ok(())
    }
}
