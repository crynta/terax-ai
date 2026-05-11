use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
};
use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, Runtime, State, UriSchemeContext};

use crate::modules::fs::file::{preview_metadata_for_path, PreviewKind};
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_PREPARED_ASSETS: usize = 256;
const MAX_FULL_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Default)]
pub struct PreviewState {
    next_token: AtomicU64,
    assets: Mutex<HashMap<String, PreviewAsset>>,
}

#[derive(Clone)]
struct PreviewAsset {
    path: PathBuf,
    kind: PreviewKind,
    media_type: String,
    size: u64,
}

#[derive(Serialize)]
pub struct PreparedPreview {
    pub token: String,
    pub kind: PreviewKind,
    pub media_type: String,
    pub size: u64,
}

#[tauri::command]
pub fn preview_prepare_file(
    state: State<'_, PreviewState>,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<PreparedPreview, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let path = resolve_path(&path, &workspace);
    let metadata = preview_metadata_for_path(&path)?;
    let token = format!("{:x}", state.next_token.fetch_add(1, Ordering::Relaxed));

    let asset = PreviewAsset {
        path,
        kind: metadata.kind,
        media_type: metadata.media_type.to_string(),
        size: metadata.size,
    };

    let mut assets = state
        .assets
        .lock()
        .map_err(|_| "preview state lock poisoned".to_string())?;
    if assets.len() >= MAX_PREPARED_ASSETS {
        if let Some(first) = assets.keys().next().cloned() {
            assets.remove(&first);
        }
    }
    assets.insert(token.clone(), asset);

    Ok(PreparedPreview {
        token,
        kind: metadata.kind,
        media_type: metadata.media_type.to_string(),
        size: metadata.size,
    })
}

pub fn serve_preview_protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let token = request.uri().path().trim_start_matches('/').to_string();
    let state = ctx.app_handle().state::<PreviewState>();
    let asset = match state
        .assets
        .lock()
        .ok()
        .and_then(|m| m.get(&token).cloned())
    {
        Some(asset) => asset,
        None => return text_response(StatusCode::NOT_FOUND, "preview asset not found"),
    };

    match serve_asset(&asset, &request) {
        Ok(response) => response,
        Err(e) => text_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

fn serve_asset(
    asset: &PreviewAsset,
    request: &Request<Vec<u8>>,
) -> std::io::Result<Response<Vec<u8>>> {
    let size = asset.size;
    if size == 0 {
        return Ok(binary_response(
            StatusCode::OK,
            &asset.media_type,
            Vec::new(),
            None,
            0,
        ));
    }

    if let Some(range_header) = request.headers().get("range").and_then(|v| v.to_str().ok()) {
        if let Some((start, end)) = parse_single_range(range_header, size) {
            let body = read_range(&asset.path, start, end)?;
            return Ok(binary_response(
                StatusCode::PARTIAL_CONTENT,
                &asset.media_type,
                body,
                Some((start, end, size)),
                end + 1 - start,
            ));
        }
        return Ok(range_not_satisfiable(size));
    }

    if asset.kind != PreviewKind::Image && size > MAX_FULL_RESPONSE_BYTES {
        return Ok(text_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "preview requires a ranged request for this large file",
        ));
    }

    let body = std::fs::read(&asset.path)?;
    Ok(binary_response(
        StatusCode::OK,
        &asset.media_type,
        body,
        None,
        size,
    ))
}

fn read_range(path: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let len = end + 1 - start;
    let mut body = vec![0; len as usize];
    file.read_exact(&mut body)?;
    Ok(body)
}

fn binary_response(
    status: StatusCode,
    media_type: &str,
    body: Vec<u8>,
    content_range: Option<(u64, u64, u64)>,
    content_length: u64,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, media_type)
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_LENGTH, content_length)
        .header(CACHE_CONTROL, "no-store");
    if let Some((start, end, size)) = content_range {
        builder = builder.header(CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    builder.body(body).unwrap_or_else(|_| {
        text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build preview response",
        )
    })
}

fn range_not_satisfiable(size: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(CONTENT_RANGE, format!("bytes */{size}"))
        .body(Vec::new())
        .unwrap_or_else(|_| text_response(StatusCode::INTERNAL_SERVER_ERROR, "range error"))
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

fn parse_single_range(header: &str, size: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let spec = header.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start_raw, end_raw) = spec.split_once('-')?;

    if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = size.saturating_sub(suffix_len);
        return Some((start, size - 1));
    }

    let start = start_raw.parse::<u64>().ok()?;
    let end = if end_raw.is_empty() {
        size - 1
    } else {
        end_raw.parse::<u64>().ok()?.min(size - 1)
    };

    if start > end || start >= size {
        return None;
    }
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::parse_single_range;

    #[test]
    fn parses_open_ended_ranges() {
        assert_eq!(parse_single_range("bytes=10-", 100), Some((10, 99)));
    }

    #[test]
    fn parses_suffix_ranges() {
        assert_eq!(parse_single_range("bytes=-25", 100), Some((75, 99)));
        assert_eq!(parse_single_range("bytes=-250", 100), Some((0, 99)));
    }

    #[test]
    fn rejects_unsatisfiable_ranges() {
        assert_eq!(parse_single_range("bytes=100-120", 100), None);
        assert_eq!(parse_single_range("items=0-1", 100), None);
        assert_eq!(parse_single_range("bytes=-0", 100), None);
    }
}
