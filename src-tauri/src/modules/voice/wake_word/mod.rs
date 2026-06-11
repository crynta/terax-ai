use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct WakeWordState {
    pub listening: bool,
    pub keyword: String,
}

#[derive(Default)]
pub struct WakeWordDetector {
    pub active: Arc<Mutex<bool>>,
    pub keyword: Arc<Mutex<String>>,
    stop_flag: Arc<Mutex<bool>>,
}

impl WakeWordDetector {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(false)),
            keyword: Arc::new(Mutex::new("hey terax".to_string())),
            stop_flag: Arc::new(Mutex::new(false)),
        }
    }
}

fn should_stop(stop_flag: &Arc<Mutex<bool>>, active: &Arc<Mutex<bool>>) -> bool {
    stop_flag.lock().map(|g| *g).unwrap_or(true) || !active.lock().map(|g| *g).unwrap_or(false)
}

#[tauri::command]
pub fn wake_word_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, WakeWordDetector>,
    keyword: Option<String>,
) -> Result<(), String> {
    {
        let active = state.active.lock().map_err(|e| e.to_string())?;
        if *active {
            return Err("wake word detector is already running".to_string());
        }
    }

    let kw = keyword.unwrap_or_else(|| "hey terax".to_string());
    {
        let mut keyword_guard = state.keyword.lock().map_err(|e| e.to_string())?;
        *keyword_guard = kw.clone();
    }
    {
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        *active = true;
    }
    {
        let mut flag = state.stop_flag.lock().map_err(|e| e.to_string())?;
        *flag = false;
    }

    let stop_flag = state.stop_flag.clone();
    let active = state.active.clone();
    let keyword_lower = kw.to_lowercase();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build();
        let Ok(rt) = rt else { return };

        rt.block_on(async move {
            let mut backoff_secs: u64 = 1;

            loop {
                if should_stop(&stop_flag, &active) {
                    break;
                }

                let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
                let api_key = match crate::modules::secrets::get_secret_value(
                    &app,
                    &secrets_state,
                    "terax",
                    "deepgram-api-key",
                ) {
                    Ok(Some(k)) => k,
                    _ => {
                        tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                        backoff_secs = (backoff_secs * 2).min(60);
                        continue;
                    }
                };

                let url = "wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&endpointing=500&vad_events=true&encoding=linear16&sample_rate=16000&channels=1";

                let mut request = match tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(url) {
                    Ok(r) => r,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                        backoff_secs = (backoff_secs * 2).min(60);
                        continue;
                    }
                };

                let auth_val = format!("Token {api_key}");
                if let Ok(val) = tokio_tungstenite::tungstenite::http::HeaderValue::from_bytes(auth_val.as_bytes()) {
                    request.headers_mut().insert("Authorization", val);
                } else {
                    tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                    backoff_secs = (backoff_secs * 2).min(60);
                    continue;
                }

                let (mut ws, _) = match tokio_tungstenite::connect_async(request).await {
                    Ok(c) => c,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                        backoff_secs = (backoff_secs * 2).min(60);
                        continue;
                    }
                };

                backoff_secs = 1;

                let (audio_tx, mut audio_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
                let (mic_stop_tx, mic_stop_rx) = std::sync::mpsc::channel::<()>();
                let stop_flag_cap = stop_flag.clone();
                let active_cap = active.clone();

                std::thread::spawn(move || {
                    let _ = capture_mic_audio(audio_tx, stop_flag_cap, active_cap, mic_stop_rx);
                });

                let keyword = keyword_lower.clone();
                let app_handle = app.clone();
                let stop_flag_ws = stop_flag.clone();
                let active_ws = active.clone();
                let mut consecutive_timeouts: u32 = 0;

                loop {
                    tokio::select! {
                        audio_chunk = audio_rx.recv() => {
                            match audio_chunk {
                                Some(chunk) => {
                                    use tokio_tungstenite::tungstenite::Message;
                                    if ws.send(Message::Binary(chunk.into())).await.is_err() {
                                        break;
                                    }
                                }
                                None => break,
                            }
                        }
                        msg_result = tokio::time::timeout(std::time::Duration::from_secs(30), ws.next()) => {
                            match msg_result {
                                Ok(Some(Ok(msg))) => {
                                    consecutive_timeouts = 0;
                                    use tokio_tungstenite::tungstenite::Message;
                                    if let Message::Text(text) = msg {
                                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                                            if let Some(is_final) = parsed.get("is_final").and_then(|v| v.as_bool()) {
                                                if is_final {
                                                    if let Some(transcript) = parsed["channel"]["alternatives"][0]["transcript"].as_str() {
                                                        if transcript.to_lowercase().contains(&keyword) {
                                                            let _ = app_handle.emit("wake-word-detected", ());
                                                            let _ = ws.close(None).await;
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Ok(Some(Err(_))) | Ok(None) => break,
                                Err(_) => {
                                    consecutive_timeouts += 1;
                                    if consecutive_timeouts >= 3 {
                                        break;
                                    }
                                    use tokio_tungstenite::tungstenite::Message;
                                    let _ = ws.send(Message::Text(
                                        serde_json::json!({"type": "KeepAlive"}).to_string().into(),
                                    )).await;
                                }
                            }
                        }
                    }

                    if should_stop(&stop_flag_ws, &active_ws) {
                        let _ = ws.close(None).await;
                        break;
                    }
                }

                drop(mic_stop_tx);

                if should_stop(&stop_flag, &active) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });
    });

    Ok(())
}

fn capture_mic_audio(
    tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    stop_flag: Arc<Mutex<bool>>,
    active: Arc<Mutex<bool>>,
    mic_stop: std::sync::mpsc::Receiver<()>,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let device = match HostTrait::default_input_device(&host) {
        Some(d) => d,
        None => return Err("no microphone input device found".to_string()),
    };

    let supported_config = device
        .supported_input_configs()
        .map_err(|e| format!("failed to query device configs: {e}"))?
        .find(|c| {
            c.channels() >= 1 && c.min_sample_rate().0 <= 16000 && c.max_sample_rate().0 >= 16000
        })
        .or_else(|| device.supported_input_configs().ok()?.next());

    let config = match supported_config {
        Some(sc) => {
            let mut cfg = sc.with_sample_rate(cpal::SampleRate(16000)).config();
            if cfg.channels > 1 {
                cfg.channels = 1;
            }
            cfg
        }
        None => cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(16000),
            buffer_size: cpal::BufferSize::Default,
        },
    };

    let tx_err = tx;
    let stop_flag_closure = stop_flag.clone();
    let active_closure = active.clone();
    let stream = DeviceTrait::build_input_stream(
        &device,
        &config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            if should_stop(&stop_flag_closure, &active_closure) {
                return;
            }
            let pcm_i16: Vec<u8> = data
                .iter()
                .flat_map(|s| {
                    let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
                    v.to_le_bytes()
                })
                .collect();
            let _ = tx_err.send(pcm_i16);
        },
        |err| {
            log::warn!("mic capture error: {err}");
        },
        None,
    )
    .map_err(|e| format!("mic stream build failed: {e}"))?;

    use cpal::traits::StreamTrait;
    StreamTrait::play(&stream).map_err(|e| format!("mic stream start failed: {e}"))?;

    while !should_stop(&stop_flag, &active) {
        if mic_stop.try_recv().is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    drop(stream);
    Ok(())
}

#[tauri::command]
pub fn wake_word_detected(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("wake-word-detected", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wake_word_stop(state: tauri::State<'_, WakeWordDetector>) -> Result<(), String> {
    {
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        *active = false;
    }
    {
        let mut flag = state.stop_flag.lock().map_err(|e| e.to_string())?;
        *flag = true;
    }
    Ok(())
}

#[tauri::command]
pub fn wake_word_status(
    state: tauri::State<'_, WakeWordDetector>,
) -> Result<WakeWordState, String> {
    let active = state.active.lock().map_err(|e| e.to_string())?.to_owned();
    let keyword = state.keyword.lock().map_err(|e| e.to_string())?.to_owned();
    Ok(WakeWordState {
        listening: active,
        keyword,
    })
}
