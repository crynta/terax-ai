use std::sync::OnceLock;
use serde::{Deserialize, Serialize};

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model3DResult {
    pub model_url: String,
    pub thumbnail_url: String,
}

#[derive(Deserialize)]
struct TripoTask {
    code: i32,
    data: Option<TripoTaskData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TripoTaskData {
    task_id: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct TripoStatus {
    code: i32,
    data: Option<TripoStatusData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TripoStatusData {
    status: String,
    model: Option<TripoModel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TripoModel {
    url: String,
    rendered_image: Option<TripoImage>,
}

#[derive(Deserialize)]
struct TripoImage {
    url: String,
}

#[tauri::command]
pub async fn generate_3d_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::modules::secrets::SecretsState>,
    prompt: String,
) -> Result<Model3DResult, String> {
    if prompt.trim().is_empty() {
        return Err("prompt cannot be empty".to_string());
    }

    let api_key = crate::modules::secrets::get_secret_value(&app, &state, "terax", "tripo-api-key")?
        .ok_or("Tripo API key not configured. Set it in Settings > Keys.")?;

    let client = http_client();

    let create_body = serde_json::json!({
        "mode": "preview",
        "prompt": prompt,
    });

    let resp = client
        .post("https://api.tripo3d.ai/v2/openapi/task")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&create_body)
        .send()
        .await
        .map_err(|e| format!("Tripo request failed: {e}"))?;

    let status_code = resp.status();
    if !status_code.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Tripo API error {status_code}: {body}"));
    }

    let task: TripoTask = resp
        .json()
        .await
        .map_err(|e| format!("Tripo response parse error: {e}"))?;

    if task.code != 0 {
        return Err(format!("Tripo API error code: {}", task.code));
    }

    let task_id = task
        .data
        .ok_or("Tripo returned no task data")?
        .task_id;

    let max_polls: u32 = 120;
    let poll_interval = std::time::Duration::from_secs(2);
    let max_retries: u32 = 3;

    for _ in 0..max_polls {
        tokio::time::sleep(poll_interval).await;

        let mut retries = 0;
        let status_resp = loop {
            match client
                .get(format!(
                    "https://api.tripo3d.ai/v2/openapi/task/{task_id}"
                ))
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await
            {
                Ok(r) => break r,
                Err(e) => {
                    retries += 1;
                    if retries >= max_retries {
                        return Err(format!("Tripo status check failed after {max_retries} retries: {e}"));
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        };

        let poll_status = status_resp.status();
        if !poll_status.is_success() {
            continue;
        }

        let status: TripoStatus = status_resp
            .json()
            .await
            .map_err(|e| format!("Tripo status parse error: {e}"))?;

        let data = match status.data {
            Some(d) => d,
            None => continue,
        };

        match data.status.as_str() {
            "success" => {
                let model = data.model.ok_or("Tripo returned no model")?;
                return Ok(Model3DResult {
                    model_url: model.url,
                    thumbnail_url: model
                        .rendered_image
                        .map(|img| img.url)
                        .unwrap_or_default(),
                });
            }
            "failed" => {
                return Err("Tripo 3D generation failed".to_string());
            }
            _ => continue,
        }
    }

    Err("Tripo generation timed out".to_string())
}
