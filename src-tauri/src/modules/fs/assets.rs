use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::http::{Request, Response};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Clone)]
struct Grant {
    owner: String,
    root: PathBuf,
    directory: bool,
    workspace: WorkspaceEnv,
}

#[derive(Default)]
pub struct AssetGrants(Mutex<HashMap<String, Grant>>);

impl AssetGrants {
    pub fn revoke_owner(&self, owner: &str) {
        self.0
            .lock()
            .unwrap()
            .retain(|_, grant| grant.owner != owner);
    }

    fn grant(&self, owner: String, path: &str, workspace: WorkspaceEnv) -> Result<String, String> {
        let root =
            std::fs::canonicalize(resolve_path(path, &workspace)).map_err(|e| e.to_string())?;
        let directory = root.is_dir();
        if !directory && media_type(&root).is_none() {
            return Err("only media files can be granted".into());
        }
        let mut grants = self.0.lock().unwrap();
        if grants.len() >= 1024 {
            return Err("too many active media grants".into());
        }
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let token = bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        grants.insert(
            token.clone(),
            Grant {
                owner,
                root,
                directory,
                workspace,
            },
        );
        Ok(token)
    }
}

#[tauri::command]
pub async fn asset_grant(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<String, String> {
    let owner = webview.label().to_owned();
    super::blocking(move || {
        app.state::<AssetGrants>()
            .grant(owner, &path, WorkspaceEnv::from_option(workspace))
    })
    .await
}

#[tauri::command]
pub fn asset_revoke(state: tauri::State<AssetGrants>, webview: tauri::Webview, token: String) {
    let mut grants = state.0.lock().unwrap();
    if grants
        .get(&token)
        .is_some_and(|grant| grant.owner == webview.label())
    {
        grants.remove(&token);
    }
}

pub fn serve<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let owner = context.webview_label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let response = respond(&app.state::<AssetGrants>(), &owner, &request)
            .unwrap_or_else(|_| response(403, "text/plain", Vec::new()));
        responder.respond(response);
    });
}

fn response(status: u16, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("X-Content-Type-Options", "nosniff")
        .header(
            "Content-Security-Policy",
            "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        )
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .body(body)
        .expect("static asset response")
}

fn respond(
    grants: &AssetGrants,
    owner: &str,
    request: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, String> {
    if request.method() != "GET" && request.method() != "HEAD" {
        return Err("unsupported method".into());
    }
    let token = request
        .uri()
        .query()
        .and_then(|query| query.strip_prefix("token="))
        .ok_or("missing grant")?;
    let grant = grants
        .0
        .lock()
        .unwrap()
        .get(token)
        .filter(|grant| grant.owner == owner)
        .cloned()
        .ok_or("invalid grant")?;
    let path = percent_encoding::percent_decode_str(
        request
            .uri()
            .path()
            .strip_prefix('/')
            .ok_or("invalid path")?,
    )
    .decode_utf8()
    .map_err(|e| e.to_string())?;
    let path =
        std::fs::canonicalize(resolve_path(&path, &grant.workspace)).map_err(|e| e.to_string())?;
    if !within(&path, &grant) {
        return Err("outside media grant".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    let actual = opened_path(&file)?;
    if !within(&actual, &grant) {
        return Err("opened asset escaped its grant".into());
    }
    let mime = media_type(&actual).ok_or("script-capable documents are not media")?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("asset is not a regular file".into());
    }
    let size = meta.len();
    let range = request
        .headers()
        .get("Range")
        .map(|value| {
            let ranges =
                http_range::HttpRange::parse(value.to_str().map_err(|e| e.to_string())?, size)
                    .map_err(|_| "invalid media range".to_string())?;
            if ranges.len() != 1 {
                return Err("one media range is required".into());
            }
            Ok::<_, String>((ranges[0].start, ranges[0].length.min(1024 * 1024)))
        })
        .transpose()?;
    let (start, length) = range.unwrap_or((0, size));
    if range.is_none() && length > 64 * 1024 * 1024 {
        return Ok(response(413, "text/plain", Vec::new()));
    }
    let mut body = Vec::new();
    if request.method() != "HEAD" {
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        file.take(length)
            .read_to_end(&mut body)
            .map_err(|e| e.to_string())?;
    }
    let mut result = response(if range.is_some() { 206 } else { 200 }, mime, body);
    result
        .headers_mut()
        .insert("Accept-Ranges", "bytes".parse().unwrap());
    result
        .headers_mut()
        .insert("Content-Length", length.to_string().parse().unwrap());
    if range.is_some() {
        result.headers_mut().insert(
            "Content-Range",
            format!("bytes {start}-{}/{size}", start + length - 1)
                .parse()
                .unwrap(),
        );
    }
    Ok(result)
}

fn within(path: &Path, grant: &Grant) -> bool {
    let path = super::to_canon(path);
    let root = super::to_canon(&grant.root);
    path == root || (grant.directory && Path::new(&path).starts_with(root))
}

fn media_type(path: &Path) -> Option<&'static str> {
    Some(
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "svg" => "image/svg+xml",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            "ogg" => "video/ogg",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "flac" => "audio/flac",
            "aac" => "audio/aac",
            "m4a" => "audio/mp4",
            "pdf" => "application/pdf",
            _ => return None,
        },
    )
}

fn opened_path(file: &File) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        use std::os::unix::ffi::OsStrExt;
        let mut buffer = [0u8; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) } == -1 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let end = buffer
            .iter()
            .position(|&byte| byte == 0)
            .ok_or("invalid path")?;
        Ok(PathBuf::from(std::ffi::OsStr::from_bytes(&buffer[..end])))
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        super::local_file::canonicalize(file).map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(path: &Path, token: &str) -> Request<Vec<u8>> {
        let encoded = percent_encoding::utf8_percent_encode(
            &super::super::to_canon(path),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        Request::builder()
            .uri(format!("https://asset.localhost/{encoded}?token={token}"))
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn asset_documents_and_ungranted_files_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let image = dir.path().join("safe.png");
        let html = dir.path().join("demo.html");
        let secret = outside.path().join("private.png");
        for path in [&image, &html, &secret] {
            std::fs::write(path, "SYNTHETIC_FIXTURE").unwrap();
        }
        let grants = AssetGrants::default();
        let token = grants
            .grant(
                "main".into(),
                &super::super::to_canon(dir.path()),
                WorkspaceEnv::Local,
            )
            .unwrap();
        assert!(respond(&grants, "main", &request(&html, &token)).is_err());
        assert!(respond(&grants, "main", &request(&secret, &token)).is_err());
        assert!(respond(&grants, "main", &request(&image, "unknown")).is_err());
        assert!(respond(&grants, "other", &request(&image, &token)).is_err());
        let result = respond(&grants, "main", &request(&image, &token)).unwrap();
        assert_eq!(result.body(), b"SYNTHETIC_FIXTURE");
        assert_eq!(result.headers()["Content-Type"], "image/png");
        assert!(result.headers()["Content-Security-Policy"]
            .to_str()
            .unwrap()
            .contains("sandbox"));
        grants.revoke_owner("main");
        assert!(respond(&grants, "main", &request(&image, &token)).is_err());
    }

    #[test]
    fn media_ranges_and_script_disabled_svg_remain_available() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("graphic.svg");
        std::fs::write(&path, "<svg><script>test()</script></svg>").unwrap();
        let grants = AssetGrants::default();
        let token = grants
            .grant(
                "main".into(),
                &super::super::to_canon(&path),
                WorkspaceEnv::Local,
            )
            .unwrap();
        let mut request = request(&path, &token);
        request
            .headers_mut()
            .insert("Range", "bytes=0-4".parse().unwrap());
        let response = respond(&grants, "main", &request).unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"<svg>");
        assert_eq!(
            response.headers()["Content-Security-Policy"],
            "sandbox; default-src 'none'; style-src 'unsafe-inline'"
        );
    }
}
