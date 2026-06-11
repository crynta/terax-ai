pub mod ptt;
pub mod transcription;
pub mod tts;
pub mod wake_word;

use serde::Serialize;

#[derive(Default)]
pub struct VoiceState {
    pub tts: tts::TtsState,
    pub wake_word: wake_word::WakeWordDetector,
}

#[derive(Debug, Clone, Serialize)]
pub struct TtsStatus {
    pub speaking: bool,
    pub provider: String,
    pub queued: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub provider: String,
    pub confidence: Option<f32>,
}

#[tauri::command]
pub async fn tts_speak(
    app: tauri::AppHandle,
    text: String,
    provider: Option<String>,
) -> Result<(), String> {
    let provider = provider.unwrap_or_else(|| "cartesia".to_string());
    tts::speak(&app, &text, &provider).await
}

#[tauri::command]
pub fn tts_stop(app: tauri::AppHandle) -> Result<(), String> {
    tts::stop(&app)
}

#[tauri::command]
pub fn tts_status(app: tauri::AppHandle) -> Result<TtsStatus, String> {
    tts::status(&app)
}

#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    audio_data: Vec<u8>,
    mime_type: String,
    provider: Option<String>,
) -> Result<TranscriptionResult, String> {
    let provider = provider.unwrap_or_else(|| "deepgram".to_string());
    let result = transcription::transcribe_audio(&app, &audio_data, &mime_type, &provider).await?;
    Ok(TranscriptionResult {
        text: result.text,
        provider: result.provider,
        confidence: result.confidence,
    })
}
