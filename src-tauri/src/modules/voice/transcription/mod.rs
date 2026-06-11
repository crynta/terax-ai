use std::sync::OnceLock;
use serde::{Deserialize, Serialize};
use tauri::Manager;

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionOutput {
    pub text: String,
    pub provider: String,
    pub confidence: Option<f32>,
}

/// Upper bound on a single transcription request, to avoid sending an
/// unbounded blob to the provider or buffering it in memory.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

pub async fn transcribe_audio(
    app: &tauri::AppHandle,
    audio_data: &[u8],
    mime_type: &str,
    provider: &str,
) -> Result<TranscriptionOutput, String> {
    if audio_data.len() > MAX_AUDIO_BYTES {
        return Err(format!(
            "audio exceeds the {MAX_AUDIO_BYTES} byte transcription limit"
        ));
    }
    match provider {
        "deepgram" => transcribe_deepgram(app, audio_data, mime_type).await,
        "local" => transcribe_local(app, audio_data).await,
        _ => Err(format!("unknown transcription provider: {provider}")),
    }
}

async fn transcribe_deepgram(
    app: &tauri::AppHandle,
    audio_data: &[u8],
    mime_type: &str,
) -> Result<TranscriptionOutput, String> {
    let secrets_state = app.state::<crate::modules::secrets::SecretsState>();
    let api_key = crate::modules::secrets::get_secret_value(
        app,
        &secrets_state,
        "terax",
        "deepgram-api-key",
    )?
    .ok_or("Deepgram API key not configured")?;

    let client = http_client();
    let resp = client
        .post("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true")
        .header("Authorization", format!("Token {api_key}"))
        .header("Content-Type", mime_type)
        .body(audio_data.to_vec())
        .send()
        .await
        .map_err(|e| format!("Deepgram request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Deepgram error {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Deepgram response parse error: {e}"))?;

    let text = body["results"]["channels"][0]["alternatives"][0]["transcript"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let confidence = body["results"]["channels"][0]["alternatives"][0]["confidence"]
        .as_f64()
        .map(|v| v as f32);

    Ok(TranscriptionOutput {
        text,
        provider: "deepgram".to_string(),
        confidence,
    })
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
async fn transcribe_local(
    app: &tauri::AppHandle,
    audio_data: &[u8],
) -> Result<TranscriptionOutput, String> {
    use tauri::Manager;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?;
    let helper = resource_dir.join("sidecars").join("speech-recognizer").join("SpeechRecognizer");
    if !helper.exists() {
        return Err("Local STT helper not found. Build with: cd sidecars/speech-recognizer && swift build -c release".to_string());
    }

    let audio_data = audio_data.to_vec();
    let output = tokio::task::spawn_blocking(move || {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new(&helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn helper: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&audio_data).map_err(|e| format!("write to helper stdin: {e}"))?;
            drop(stdin);
        }

        let result = child.wait_with_output()
            .map_err(|e| format!("helper wait: {e}"))?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!("helper failed: {stderr}"));
        }

        Ok(String::from_utf8_lossy(&result.stdout).trim().to_string())
    }).await.map_err(|e| format!("task join: {e}"))??;

    Ok(TranscriptionOutput {
        text: output,
        provider: "sfspeech".to_string(),
        confidence: None,
    })
}

#[cfg(not(all(target_os = "macos", feature = "openclicky")))]
async fn transcribe_local(
    _app: &tauri::AppHandle,
    _audio_data: &[u8],
) -> Result<TranscriptionOutput, String> {
    Err("Local speech recognition is only available on macOS".to_string())
}
