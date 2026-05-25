use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct PlantUmlResult {
    pub svg: Option<String>,
    pub error: Option<String>,
}

const DEFAULT_SERVER: &str = "https://www.plantuml.com/plantuml/svg/";
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[tauri::command]
pub async fn plantuml_fetch_svg(
    encoded: String,
    server_url: Option<String>,
) -> Result<String, String> {
    let base = server_url
        .as_deref()
        .unwrap_or(DEFAULT_SERVER)
        .trim_end_matches('/');
    let url = format!("{base}/{encoded}");

    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("scheme not allowed: {s}")),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?;
    if host.is_empty() {
        return Err("empty host".into());
    }

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(format!(
            "response too large: {} bytes (limit {})",
            bytes.len(),
            MAX_OUTPUT_BYTES
        ));
    }

    String::from_utf8(bytes.to_vec()).map_err(|e| format!("invalid utf8 in response: {e}"))
}

#[tauri::command]
pub async fn plantuml_render_local(
    diagram_text: String,
    jar_path: String,
    java_path: Option<String>,
) -> Result<PlantUmlResult, String> {
    let jar = Path::new(&jar_path);
    if !jar.exists() {
        return Err(format!("jar not found: {jar_path}"));
    }
    if jar.extension().and_then(|e| e.to_str()) != Some("jar") {
        return Err("jar_path must end with .jar".into());
    }

    let java = java_path.unwrap_or_else(|| "java".into());

    tokio::task::spawn_blocking(move || {
        let mut child = Command::new(&java)
            .arg("-jar")
            .arg(&jar_path)
            .arg("-tsvg")
            .arg("-pipe")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn java: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(diagram_text.as_bytes())
                .map_err(|e| format!("stdin write failed: {e}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("process error: {e}"))?;

        let stdout_len = output.stdout.len();
        let stderr_len = output.stderr.len();

        if stdout_len > MAX_OUTPUT_BYTES || stderr_len > MAX_OUTPUT_BYTES {
            return Err(format!(
                "output too large: stdout={stdout_len}, stderr={stderr_len}"
            ));
        }

        let svg = if output.stdout.is_empty() {
            None
        } else {
            Some(String::from_utf8_lossy(&output.stdout).into_owned())
        };

        let error = if output.stderr.is_empty() {
            None
        } else {
            Some(String::from_utf8_lossy(&output.stderr).into_owned())
        };

        Ok(PlantUmlResult { svg, error })
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}
