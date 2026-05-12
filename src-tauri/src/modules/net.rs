use std::collections::HashMap;
use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[tauri::command]
pub async fn http_ping(url: String) -> Result<u16, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(&url)
        .send()
        .await
        .map(|r| r.status().as_u16())
        .map_err(|e| e.to_string())
}

// AI HTTP proxy — bypasses webview CORS / Mixed-Content / PNA so local-network
// model servers (LM Studio, Ollama, vLLM) work in the production bundle.

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

fn build_request(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
) -> Result<reqwest::RequestBuilder, String> {
    let method = Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, url);
    if let Some(h) = headers {
        let mut map = HeaderMap::new();
        for (k, v) in h {
            let name = HeaderName::from_bytes(k.as_bytes()).map_err(|e| e.to_string())?;
            let value = HeaderValue::from_str(&v).map_err(|e| e.to_string())?;
            map.insert(name, value);
        }
        req = req.headers(map);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    Ok(req)
}

fn header_map_to_strings(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::with_capacity(headers.len());
    for (k, v) in headers {
        if let Ok(s) = v.to_str() {
            out.insert(k.as_str().to_ascii_lowercase(), s.to_string());
        }
    }
    out
}

#[tauri::command]
pub async fn ai_http_request(
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        // No total timeout — generative endpoints can take minutes for long outputs.
        // Connect timeout protects against unreachable hosts.
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let req = build_request(&client, &method, &url, headers, body)?;
    let resp = req.send().await.map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let headers = header_map_to_strings(resp.headers());
    let body = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Headers {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    End,
    Error {
        message: String,
    },
}

#[tauri::command]
pub async fn ai_http_stream(
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let req = build_request(&client, &method, &url, headers, body)?;
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error {
                message: e.to_string(),
            });
            return Err(e.to_string());
        }
    };

    let status = resp.status().as_u16();
    let headers = header_map_to_strings(resp.headers());
    let _ = on_event.send(AiStreamEvent::Headers { status, headers });

    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        match item {
            Ok(chunk) => {
                let bytes: Bytes = chunk;
                if on_event
                    .send(AiStreamEvent::Chunk {
                        bytes: bytes.to_vec(),
                    })
                    .is_err()
                {
                    // Channel dropped (frontend aborted) — stop streaming.
                    return Ok(());
                }
            }
            Err(e) => {
                let _ = on_event.send(AiStreamEvent::Error {
                    message: e.to_string(),
                });
                return Err(e.to_string());
            }
        }
    }

    let _ = on_event.send(AiStreamEvent::End);
    Ok(())
}
