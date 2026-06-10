use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{CancellationToken, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;
use tokio::time::timeout;
use tracing::instrument;

const MAX_CONCURRENT_CONNECTIONS: usize = 64;
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookRoute {
    pub id: String,
    pub path: String,
    pub method: String,
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct WebhookRouteMasked {
    id: String,
    path: String,
    method: String,
    has_auth_token: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub route_id: String,
    pub path: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub body_json: Option<serde_json::Value>,
    pub received_at: String,
}

struct ActiveServer {
    cancel: CancellationToken,
    semaphore: Arc<Semaphore>,
    task_handle: tokio::task::JoinHandle<()>,
}

pub struct WebhookState {
    routes: tokio::sync::RwLock<HashMap<String, WebhookRoute>>,
    server_addr: tokio::sync::RwLock<Option<std::net::SocketAddr>>,
    active: tokio::sync::RwLock<Option<ActiveServer>>,
}

impl Default for WebhookState {
    fn default() -> Self {
        Self {
            routes: tokio::sync::RwLock::new(HashMap::new()),
            server_addr: tokio::sync::RwLock::new(None),
            active: tokio::sync::RwLock::new(None),
        }
    }
}

#[tauri::command]
#[instrument(skip(state), fields(path = %path, method = %method))]
pub async fn webhook_register(
    state: State<'_, WebhookState>,
    path: String,
    method: String,
    auth_token: Option<String>,
) -> Result<WebhookRoute, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let route = WebhookRoute {
        id: id.clone(),
        path,
        method: method.to_uppercase(),
        auth_token,
    };
    state.routes.write().await.insert(id, route.clone());
    Ok(route)
}

#[tauri::command]
#[instrument(skip(state), fields(route_id = %route_id))]
pub async fn webhook_unregister(
    state: State<'_, WebhookState>,
    route_id: String,
) -> Result<(), String> {
    state.routes.write().await.remove(&route_id);
    Ok(())
}

#[tauri::command]
#[instrument(skip(app, state), fields(port = port))]
pub async fn webhook_start_server(
    app: AppHandle,
    state: State<'_, WebhookState>,
    port: u16,
) -> Result<String, String> {
    {
        let active = state.active.read().await;
        if let Some(server) = active.as_ref() {
            server.cancel.cancel();
        }
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let routes = Arc::new(state.routes.read().await.clone());
    let cancel = CancellationToken::new();
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind webhook server: {e}"))?;

    let actual_addr = listener.local_addr().map_err(|e| e.to_string())?;
    *state.server_addr.write().await = Some(actual_addr);

    let app_handle = app.clone();
    let child_cancel = cancel.clone();
    let child_semaphore = Arc::clone(&semaphore);

    let task_handle = tokio::spawn(async move {
        let _rx = rx;
        let mut tasks: JoinSet<()> = JoinSet::new();

        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _peer)) => {
                            let permit = match child_semaphore.clone().try_acquire_owned() {
                                Ok(permit) => permit,
                                Err(_) => {
                                    log::warn!("webhook connection rejected: at capacity ({MAX_CONCURRENT_CONNECTIONS})");
                                    continue;
                                }
                            };
                            let routes = Arc::clone(&routes);
                            let app = app_handle.clone();
                            tasks.spawn(async move {
                                let _permit: OwnedSemaphorePermit = permit;
                                handle_webhook_connection(stream, &routes, &app).await;
                            });
                        }
                        Err(e) => {
                            log::error!("webhook accept error: {e}");
                        }
                    }
                }
                Some(result) = tasks.join_next(), if !tasks.is_empty() => {
                    if let Err(e) = result {
                        log::debug!("webhook connection task failed: {e}");
                    }
                }
                _ = child_cancel.cancelled() => {
                    log::info!("webhook server shutting down");
                    break;
                }
            }
        }
        tasks.abort_all();
    });

    *state.active.write().await = Some(ActiveServer {
        cancel,
        semaphore,
        task_handle,
    });

    let url = format!("http://{}", actual_addr);
    log::info!("webhook server started: {url}");
    Ok(url)
}

#[tauri::command]
#[instrument(skip(state))]
pub async fn webhook_stop_server(state: State<'_, WebhookState>) -> Result<(), String> {
    let mut active_guard = state.active.write().await;
    if let Some(server) = active_guard.take() {
        server.cancel.cancel();
        let _ = timeout(SHUTDOWN_TIMEOUT, server.task_handle).await;
    }
    *state.server_addr.write().await = None;
    log::info!("webhook server stopped");
    Ok(())
}

#[tauri::command]
#[instrument(skip(state))]
pub async fn webhook_list_routes(
    state: State<'_, WebhookState>,
) -> Result<Vec<WebhookRouteMasked>, String> {
    Ok(state
        .routes
        .read()
        .await
        .values()
        .map(|r| WebhookRouteMasked {
            id: r.id.clone(),
            path: r.path.clone(),
            method: r.method.clone(),
            has_auth_token: r.auth_token.is_some(),
        })
        .collect())
}

async fn handle_webhook_connection(
    stream: tokio::net::TcpStream,
    routes: &HashMap<String, WebhookRoute>,
    app: &AppHandle,
) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut reader, mut writer) = stream.into_split();

    let mut header_buf = Vec::with_capacity(8192);
    let mut tmp = [0u8; 4096];

    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(10), reader.read(&mut tmp)).await
        {
            Ok(Ok(0)) => return,
            Ok(Ok(n)) => {
                header_buf.extend_from_slice(&tmp[..n]);
                if header_buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if header_buf.len() > 65536 {
                    let _ = writer
                        .write_all(b"HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n")
                        .await;
                    return;
                }
            }
            Ok(Err(_)) => return,
            Err(_) => {
                let _ = writer
                    .write_all(b"HTTP/1.1 408 Request Timeout\r\n\r\n")
                    .await;
                return;
            }
        }
    }

    let header_end = header_buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(header_buf.len());

    let header_bytes = &header_buf[..header_end];
    let body_preamble = &header_buf[header_end + 4..];

    let header_str = String::from_utf8_lossy(header_bytes);
    let lines: Vec<&str> = header_str.lines().collect();

    if lines.is_empty() {
        let _ = writer.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        return;
    }

    let first_line: Vec<&str> = lines[0].split_whitespace().collect();
    if first_line.len() < 2 {
        let _ = writer.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        return;
    }
    let method = first_line[0];
    let raw_path = first_line[1];
    let path = raw_path.split('?').next().unwrap_or(raw_path);

    let mut headers = HashMap::new();
    for line in lines.iter().skip(1) {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    const MAX_BODY_SIZE: usize = 10 * 1024 * 1024;
    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
        .min(MAX_BODY_SIZE);

    let mut body_bytes = body_preamble.to_vec();
    if body_bytes.len() < content_length {
        let remaining = content_length - body_bytes.len();
        let mut rest = vec![0u8; remaining];
        let mut read_total = 0;
        while read_total < remaining {
            match tokio::time::timeout(
                std::time::Duration::from_secs(30),
                reader.read(&mut rest[read_total..]),
            )
            .await
            {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => read_total += n,
                _ => break,
            }
        }
        body_bytes.extend_from_slice(&rest[..read_total]);
    }

    let body = String::from_utf8_lossy(&body_bytes).to_string();
    let body_json = serde_json::from_slice(&body_bytes).ok();

    let matching_route = routes
        .values()
        .find(|r| r.path == path && r.method == method);

    match matching_route {
        Some(route) => {
            if let Some(ref token) = route.auth_token {
                let auth_header = headers.get("authorization");
                let api_key = headers.get("x-api-key");
                let valid = auth_header.is_some_and(|h| {
                    h.strip_prefix("Bearer ")
                        .is_some_and(|t| constant_time_eq(t, token))
                }) || api_key.is_some_and(|k| constant_time_eq(k, token));

                if !valid {
                    let _ = writer
                        .write_all(b"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
                        .await;
                    return;
                }
            }

            let payload = WebhookPayload {
                route_id: route.id.clone(),
                path: path.to_string(),
                method: method.to_string(),
                headers,
                body,
                body_json,
                received_at: chrono::Utc::now().to_rfc3339(),
            };

            let _ = app.emit("workflow:webhook", &payload);
            let _ = writer
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}")
                .await;
        }
        None => {
            let _ = writer
                .write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
                .await;
        }
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let len_eq = a_bytes.len() == b_bytes.len();
    let mut result = 0u8;
    for (x, y) in a_bytes.iter().zip(b_bytes.iter()) {
        result |= x ^ y;
    }
    if a_bytes.len() > b_bytes.len() {
        result |= 0xff;
    }
    len_eq && result == 0
}
