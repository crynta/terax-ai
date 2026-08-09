use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use terax_control_protocol::{
    ControlDescriptor, ControlRequest, ControlResponse, FrontendRequest, FrontendResponse,
    OpenParams, MAX_MESSAGE_BYTES, METHODS, METHOD_CAPABILITIES, METHOD_IDENTIFY, METHOD_OPEN,
    METHOD_PING, PROTOCOL_VERSION,
};

use crate::modules::{fs, workspace};

const CONTROL_EVENT: &str = "terax:control-request";
const FRONTEND_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(7);
const MAX_PENDING_REQUESTS: usize = 32;
const MAX_CONNECTIONS: usize = 32;
const LISTENER_STACK_BYTES: usize = 256 * 1024;
const REQUEST_STACK_BYTES: usize = 512 * 1024;

#[derive(Clone)]
struct RuntimeInfo {
    address: String,
    token: String,
    descriptor_path: PathBuf,
    cli_path: Option<PathBuf>,
    launcher_dir: Option<PathBuf>,
}

struct ControlCore {
    runtime: OnceLock<RuntimeInfo>,
    frontend_ready: AtomicBool,
    shutting_down: AtomicBool,
    active_connections: AtomicUsize,
    pending: Mutex<HashMap<String, SyncSender<FrontendResponse>>>,
}

#[derive(Clone)]
pub struct ControlState(Arc<ControlCore>);

impl Default for ControlState {
    fn default() -> Self {
        Self(Arc::new(ControlCore {
            runtime: OnceLock::new(),
            frontend_ready: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
            active_connections: AtomicUsize::new(0),
            pending: Mutex::new(HashMap::new()),
        }))
    }
}

#[derive(Clone)]
pub struct ShellControlEnv {
    pub address: String,
    pub token: String,
    pub pane_id: u32,
    pub cli_path: Option<String>,
    pub cli_bin_dir: Option<PathBuf>,
}

impl ControlState {
    pub fn shell_env(&self, pane_id: u32) -> Option<ShellControlEnv> {
        let runtime = self.0.runtime.get()?;
        Some(ShellControlEnv {
            address: runtime.address.clone(),
            token: runtime.token.clone(),
            pane_id,
            cli_path: runtime.cli_path.as_ref().map(fs::to_canon),
            cli_bin_dir: runtime.launcher_dir.clone(),
        })
    }

    pub fn shutdown(&self) {
        self.0.shutting_down.store(true, Ordering::Release);
        self.0.frontend_ready.store(false, Ordering::Release);
        if let Some(runtime) = self.0.runtime.get() {
            remove_own_descriptor(&runtime.descriptor_path, &runtime.token);
            if let Some(dir) = &runtime.launcher_dir {
                remove_launcher_dir(dir);
            }
        }
    }

    fn release_connection(&self) {
        self.0.active_connections.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn start(app: tauri::AppHandle, state: ControlState) -> Result<(), String> {
    if state.0.runtime.get().is_some() {
        return Err("control server already initialized".to_string());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("bind local control socket: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("read local control address: {error}"))?
        .to_string();
    let token = generate_token()?;
    let descriptor_path = descriptor_path()?;
    let cli_path = find_bundled_cli();
    let launcher_dir = cli_path.as_deref().and_then(|cli_path| {
        match prepare_cli_launcher(&descriptor_path, cli_path) {
            Ok(dir) => Some(dir),
            Err(error) => {
                log::warn!("could not prepare terax CLI launcher: {error}");
                None
            }
        }
    });

    let descriptor = ControlDescriptor {
        protocol: PROTOCOL_VERSION,
        address: address.clone(),
        token: token.clone(),
        pid: std::process::id(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    if let Err(error) = write_descriptor(&descriptor_path, &descriptor) {
        if let Some(dir) = &launcher_dir {
            remove_launcher_dir(dir);
        }
        return Err(error);
    }

    if let Err(runtime) = state.0.runtime.set(RuntimeInfo {
        address,
        token,
        descriptor_path,
        cli_path: cli_path.clone(),
        launcher_dir,
    }) {
        remove_own_descriptor(&runtime.descriptor_path, &runtime.token);
        if let Some(dir) = &runtime.launcher_dir {
            remove_launcher_dir(dir);
        }
        return Err("control server already initialized".to_string());
    }

    if cli_path.is_none() {
        log::warn!("bundled terax-cli executable not found; shell alias disabled");
    }

    let listener_state = state.clone();
    if let Err(error) = thread::Builder::new()
        .name("terax-control-listener".into())
        .stack_size(LISTENER_STACK_BYTES)
        .spawn(move || accept_loop(listener, app, listener_state))
    {
        state.shutdown();
        return Err(format!("spawn control listener: {error}"));
    }
    Ok(())
}

fn accept_loop(listener: TcpListener, app: tauri::AppHandle, state: ControlState) {
    for incoming in listener.incoming() {
        if state.0.shutting_down.load(Ordering::Acquire) {
            break;
        }
        let stream = match incoming {
            Ok(stream) => stream,
            Err(error) => {
                if !state.0.shutting_down.load(Ordering::Acquire) {
                    log::warn!("control socket accept failed: {error}");
                }
                continue;
            }
        };

        if state.0.active_connections.fetch_add(1, Ordering::AcqRel) >= MAX_CONNECTIONS {
            state.release_connection();
            let mut stream = stream;
            let response =
                ControlResponse::failure("", "server_busy", "too many concurrent control requests");
            let _ = write_response(&mut stream, &response);
            continue;
        }

        let app = app.clone();
        let request_state = state.clone();
        if let Err(error) = thread::Builder::new()
            .name("terax-control-request".into())
            .stack_size(REQUEST_STACK_BYTES)
            .spawn(move || {
                let _guard = ConnectionGuard(request_state.clone());
                handle_connection(stream, &app, &request_state);
            })
        {
            state.release_connection();
            log::warn!("could not spawn control request thread: {error}");
        }
    }
}

struct ConnectionGuard(ControlState);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.release_connection();
    }
}

fn handle_connection(mut stream: TcpStream, app: &tauri::AppHandle, state: &ControlState) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err((code, message)) => {
            let _ = write_response(&mut stream, &ControlResponse::failure("", code, message));
            return;
        }
    };
    let response = route_request(request, app, state);
    let _ = write_response(&mut stream, &response);
}

fn read_request(stream: &mut TcpStream) -> Result<ControlRequest, (&'static str, String)> {
    let mut reader = BufReader::new(stream);
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_MESSAGE_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|error| ("io_error", format!("read request: {error}")))?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err((
            "message_too_large",
            format!("request exceeds {MAX_MESSAGE_BYTES} bytes"),
        ));
    }
    if bytes.last() != Some(&b'\n') {
        return Err((
            "invalid_request",
            "request must end with a newline".to_string(),
        ));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| ("invalid_json", format!("invalid request JSON: {error}")))
}

fn route_request(
    mut request: ControlRequest,
    app: &tauri::AppHandle,
    state: &ControlState,
) -> ControlResponse {
    if !valid_request_id(&request.id) {
        return ControlResponse::failure(
            request.id,
            "invalid_request",
            "request id must be 1-128 safe ASCII characters",
        );
    }
    if request.protocol != PROTOCOL_VERSION {
        return ControlResponse::failure(
            request.id,
            "unsupported_protocol",
            format!(
                "protocol {} is unsupported; expected {PROTOCOL_VERSION}",
                request.protocol
            ),
        );
    }
    let Some(runtime) = state.0.runtime.get() else {
        return ControlResponse::failure(
            request.id,
            "server_unavailable",
            "control server is not initialized",
        );
    };
    if !constant_time_eq(request.token.as_bytes(), runtime.token.as_bytes()) {
        return ControlResponse::failure(request.id, "unauthorized", "invalid control token");
    }

    match request.method.as_str() {
        METHOD_PING => ControlResponse::success(
            request.id,
            json!({
                "pong": true,
                "app_version": env!("CARGO_PKG_VERSION"),
                "protocol": PROTOCOL_VERSION,
            }),
        ),
        METHOD_CAPABILITIES => ControlResponse::success(
            request.id,
            json!({
                "app_version": env!("CARGO_PKG_VERSION"),
                "protocol": PROTOCOL_VERSION,
                "methods": METHODS,
            }),
        ),
        METHOD_IDENTIFY => forward_to_frontend(request, app, state),
        METHOD_OPEN => {
            let params: OpenParams = match serde_json::from_value(request.params.clone()) {
                Ok(params) => params,
                Err(error) => {
                    return ControlResponse::failure(
                        request.id,
                        "invalid_params",
                        format!("invalid open parameters: {error}"),
                    );
                }
            };
            match validate_open_params(params, app) {
                Ok(params) => match serde_json::to_value(params) {
                    Ok(params) => {
                        request.params = params;
                        forward_to_frontend(request, app, state)
                    }
                    Err(error) => ControlResponse::failure(
                        request.id,
                        "internal_error",
                        format!("serialize open parameters: {error}"),
                    ),
                },
                Err((code, message)) => ControlResponse::failure(request.id, code, message),
            }
        }
        _ => ControlResponse::failure(
            request.id,
            "unknown_method",
            format!("unknown method '{}'", request.method),
        ),
    }
}

fn validate_open_params(
    mut params: OpenParams,
    app: &tauri::AppHandle,
) -> Result<OpenParams, (&'static str, String)> {
    if params.path.is_empty() || params.path.len() > 16 * 1024 {
        return Err((
            "invalid_params",
            "path must contain 1-16384 bytes".to_string(),
        ));
    }
    if params.line == Some(0) || params.column == Some(0) {
        return Err((
            "invalid_params",
            "line and column are one-based and must be greater than zero".to_string(),
        ));
    }
    let canonical = std::fs::canonicalize(&params.path)
        .map_err(|error| ("path_not_found", format!("cannot open path: {error}")))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| ("path_not_found", format!("cannot stat path: {error}")))?;
    if !metadata.is_file() {
        return Err((
            "not_a_file",
            format!("path is not a regular file: {}", canonical.display()),
        ));
    }
    let parent = canonical.parent().ok_or_else(|| {
        (
            "path_not_accessible",
            "file has no parent directory".to_string(),
        )
    })?;
    let registry = app
        .try_state::<workspace::WorkspaceRegistry>()
        .ok_or_else(|| {
            (
                "internal_error",
                "workspace registry is unavailable".to_string(),
            )
        })?;
    registry
        .authorize(parent)
        .map_err(|error| ("path_not_accessible", error.to_string()))?;
    params.path = fs::to_canon(canonical);
    Ok(params)
}

fn forward_to_frontend(
    request: ControlRequest,
    app: &tauri::AppHandle,
    state: &ControlState,
) -> ControlResponse {
    if !state.0.frontend_ready.load(Ordering::Acquire) {
        return ControlResponse::failure(
            request.id,
            "frontend_not_ready",
            "Terax is still restoring its workspace; try again shortly",
        );
    }

    let id = request.id.clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    {
        let mut pending = state.0.pending.lock().expect("control pending poisoned");
        if pending.len() >= MAX_PENDING_REQUESTS {
            return ControlResponse::failure(
                id,
                "server_busy",
                "too many pending frontend requests",
            );
        }
        if pending.contains_key(&id) {
            return ControlResponse::failure(id, "duplicate_id", "request id is already pending");
        }
        pending.insert(id.clone(), sender);
    }

    let frontend_request = FrontendRequest {
        id: id.clone(),
        method: request.method,
        params: request.params,
        caller: request.caller,
    };
    if let Err(error) = app.emit_to("main", CONTROL_EVENT, frontend_request) {
        state
            .0
            .pending
            .lock()
            .expect("control pending poisoned")
            .remove(&id);
        return ControlResponse::failure(
            id,
            "frontend_unavailable",
            format!("could not reach Terax UI: {error}"),
        );
    }

    match receiver.recv_timeout(FRONTEND_TIMEOUT) {
        Ok(response) if response.ok => {
            ControlResponse::success(id, response.result.unwrap_or(Value::Null))
        }
        Ok(response) => {
            let error = response.error.unwrap_or_else(|| {
                terax_control_protocol::ControlError::new(
                    "frontend_error",
                    "frontend request failed",
                )
            });
            ControlResponse::failure(id, error.code, error.message)
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            state
                .0
                .pending
                .lock()
                .expect("control pending poisoned")
                .remove(&id);
            ControlResponse::failure(id, "frontend_timeout", "Terax UI did not respond in time")
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => ControlResponse::failure(
            id,
            "frontend_unavailable",
            "Terax UI response channel closed",
        ),
    }
}

#[tauri::command]
pub fn control_frontend_ready(state: tauri::State<'_, ControlState>, ready: bool) {
    state.0.frontend_ready.store(ready, Ordering::Release);
}

#[tauri::command]
pub fn control_respond(
    state: tauri::State<'_, ControlState>,
    request_id: String,
    response: FrontendResponse,
) -> bool {
    let sender = state
        .0
        .pending
        .lock()
        .expect("control pending poisoned")
        .remove(&request_id);
    sender.is_some_and(|sender| sender.send(response).is_ok())
}

fn write_response(stream: &mut TcpStream, response: &ControlResponse) -> std::io::Result<()> {
    serde_json::to_writer(&mut *stream, response)?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:".contains(&byte))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

fn generate_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("generate control token: {error}"))?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(token, "{byte:02x}");
    }
    Ok(token)
}

fn descriptor_path() -> Result<PathBuf, String> {
    let cache =
        dirs::cache_dir().ok_or_else(|| "could not resolve user cache directory".to_string())?;
    let dir = cache.join("terax");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("create control directory {}: {error}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("secure control directory {}: {error}", dir.display()))?;
    }
    Ok(dir.join("control.json"))
}

fn write_descriptor(path: &Path, descriptor: &ControlDescriptor) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "control descriptor path has no parent".to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("create control descriptor: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("secure control descriptor: {error}"))?;
    }
    serde_json::to_writer(&mut temp, descriptor)
        .map_err(|error| format!("serialize control descriptor: {error}"))?;
    temp.write_all(b"\n")
        .map_err(|error| format!("write control descriptor: {error}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|error| format!("sync control descriptor: {error}"))?;
    temp.persist(path)
        .map_err(|error| format!("publish control descriptor: {}", error.error))?;
    Ok(())
}

fn remove_own_descriptor(path: &Path, token: &str) {
    let owned = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ControlDescriptor>(&bytes).ok())
        .is_some_and(|descriptor| constant_time_eq(descriptor.token.as_bytes(), token.as_bytes()));
    if owned {
        let _ = std::fs::remove_file(path);
    }
}

fn find_bundled_cli() -> Option<PathBuf> {
    let filename = if cfg!(windows) {
        "terax-cli.exe"
    } else {
        "terax-cli"
    };
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.join(filename)))
        .filter(|path| is_cli_candidate(path))
    {
        return Some(path);
    }

    if cfg!(debug_assertions) {
        let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let target = option_env!("TAURI_ENV_TARGET_TRIPLE")?;
        let candidate = binaries.join(format!(
            "terax-cli-{target}{}",
            std::env::consts::EXE_SUFFIX
        ));
        return is_cli_candidate(&candidate).then_some(candidate);
    }
    None
}

fn is_cli_candidate(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

fn prepare_cli_launcher(descriptor: &Path, cli_path: &Path) -> Result<PathBuf, String> {
    let control_dir = descriptor
        .parent()
        .ok_or_else(|| "control descriptor path has no parent".to_string())?;
    let run_dir = control_dir.join("run").join(std::process::id().to_string());
    let bin_dir = run_dir.join("bin");
    std::fs::create_dir_all(&bin_dir)
        .map_err(|error| format!("create CLI launcher directory: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&run_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("secure CLI run directory: {error}"))?;
        std::fs::set_permissions(&bin_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("secure CLI bin directory: {error}"))?;
    }

    let launcher = bin_dir.join(if cfg!(windows) { "terax.exe" } else { "terax" });
    if std::fs::symlink_metadata(&launcher).is_ok() {
        std::fs::remove_file(&launcher)
            .map_err(|error| format!("replace stale CLI launcher: {error}"))?;
    }
    if std::fs::hard_link(cli_path, &launcher).is_err() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(cli_path, &launcher)
            .map_err(|error| format!("link CLI launcher: {error}"))?;
        #[cfg(windows)]
        {
            std::fs::copy(cli_path, &launcher)
                .map_err(|error| format!("copy CLI launcher: {error}"))?;
        }
    }
    Ok(bin_dir)
}

fn remove_launcher_dir(bin_dir: &Path) {
    let launcher = bin_dir.join(if cfg!(windows) { "terax.exe" } else { "terax" });
    let _ = std::fs::remove_file(launcher);
    let _ = std::fs::remove_dir(bin_dir);
    if let Some(run_dir) = bin_dir.parent() {
        let _ = std::fs::remove_dir(run_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_are_bounded_and_log_safe() {
        assert!(valid_request_id("1234-55_test.ok"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("has a space"));
        assert!(!valid_request_id("line\nbreak"));
        assert!(!valid_request_id(&"x".repeat(129)));
    }

    #[test]
    fn token_comparison_checks_every_byte() {
        assert!(constant_time_eq(b"abcdef", b"abcdef"));
        assert!(!constant_time_eq(b"abcdef", b"abcdeg"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn launcher_exposes_the_public_command() {
        let temp = tempfile::tempdir().expect("temp directory");
        let cli = temp.path().join(if cfg!(windows) {
            "terax-cli.exe"
        } else {
            "terax-cli"
        });
        std::fs::write(&cli, b"cli").expect("write fake CLI");
        let descriptor = temp.path().join("control.json");

        let bin_dir = prepare_cli_launcher(&descriptor, &cli).expect("prepare launcher");
        let launcher = bin_dir.join(if cfg!(windows) { "terax.exe" } else { "terax" });
        assert_eq!(std::fs::read(&launcher).expect("read launcher"), b"cli");

        remove_launcher_dir(&bin_dir);
        assert!(!launcher.exists());
    }

    #[test]
    fn descriptor_cleanup_preserves_a_newer_instance() {
        let temp = tempfile::tempdir().expect("temp directory");
        let path = temp.path().join("control.json");
        let descriptor = ControlDescriptor {
            protocol: PROTOCOL_VERSION,
            address: "127.0.0.1:4312".into(),
            token: "b".repeat(64),
            pid: 22,
            app_version: "test".into(),
        };
        write_descriptor(&path, &descriptor).expect("write descriptor");

        remove_own_descriptor(&path, &"a".repeat(64));
        assert!(path.exists());

        remove_own_descriptor(&path, &descriptor.token);
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_is_private_to_the_current_user() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("temp directory");
        let path = temp.path().join("control.json");
        let descriptor = ControlDescriptor {
            protocol: PROTOCOL_VERSION,
            address: "127.0.0.1:4312".into(),
            token: "a".repeat(64),
            pid: 11,
            app_version: "test".into(),
        };
        write_descriptor(&path, &descriptor).expect("write descriptor");

        let mode = std::fs::metadata(path)
            .expect("descriptor metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}
