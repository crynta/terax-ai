use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use terax_control_protocol::{
    ControlDescriptor, ControlRequest, ControlResponse, FrontendRequest, FrontendResponse,
    OpenParams, MAX_MESSAGE_BYTES, METHODS, METHOD_CAPABILITIES, METHOD_HOOK, METHOD_IDENTIFY,
    METHOD_OPEN, METHOD_PING, PROTOCOL_VERSION, SERVER_RESPONSE_ID,
};

use crate::modules::agent_events::{self, AgentHost, HookState, TauriAgentHost};
use crate::modules::{fs, workspace};

const CONTROL_EVENT: &str = "terax:control-request";
const FRONTEND_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(7);
const MAX_PENDING_REQUESTS: usize = 32;
const MAX_CONNECTIONS: usize = 32;
const LISTENER_STACK_BYTES: usize = 256 * 1024;
const REQUEST_STACK_BYTES: usize = 512 * 1024;
const STALE_LAUNCHER_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone)]
struct RuntimeInfo {
    address: String,
    token: String,
    descriptor_path: PathBuf,
    cli_path: Option<PathBuf>,
    launcher_dir: Option<PathBuf>,
}

const RECENT_HOOK_IDS: usize = 4096;

struct PaneCredential {
    token: String,
    pty_id: u32,
    seen: HashSet<String>,
    order: VecDeque<String>,
}

struct ControlCore {
    runtime: OnceLock<RuntimeInfo>,
    frontend_ready: AtomicBool,
    shutting_down: AtomicBool,
    active_connections: AtomicUsize,
    pending: Mutex<HashMap<String, SyncSender<FrontendResponse>>>,
    hooks: HookState,
    panes: Mutex<HashMap<u32, PaneCredential>>,
    starting: Mutex<HashSet<String>>,
    started: Condvar,
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
            hooks: HookState::default(),
            panes: Mutex::new(HashMap::new()),
            starting: Mutex::new(HashSet::new()),
            started: Condvar::new(),
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

pub struct PendingShell {
    state: ControlState,
    token: String,
}

impl Drop for PendingShell {
    fn drop(&mut self) {
        self.state
            .0
            .starting
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.token);
        self.state.0.started.notify_all();
    }
}

impl ControlState {
    pub fn shell_env(&self, pane_id: u32) -> Option<ShellControlEnv> {
        if self.0.shutting_down.load(Ordering::Acquire) {
            return None;
        }
        let runtime = self.0.runtime.get()?;
        if self.0.shutting_down.load(Ordering::Acquire) {
            return None;
        }
        Some(ShellControlEnv {
            address: runtime.address.clone(),
            token: generate_token().ok()?,
            pane_id,
            cli_path: runtime.cli_path.as_ref().map(fs::to_canon),
            cli_bin_dir: runtime.launcher_dir.clone(),
        })
    }

    pub fn pending_shell(&self, env: &ShellControlEnv) -> PendingShell {
        self.0
            .starting
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(env.token.clone());
        PendingShell {
            state: self.clone(),
            token: env.token.clone(),
        }
    }

    pub fn activate_shell(&self, env: &ShellControlEnv, pty_id: u32, host: &dyn AgentHost) {
        let mut panes = self.0.panes.lock().unwrap_or_else(|e| e.into_inner());
        if self.0.shutting_down.load(Ordering::Acquire) {
            return;
        }
        // Pending spawns have no registered credential yet. Prune closed and
        // superseded generations when another terminal becomes live.
        panes.retain(|pane, credential| {
            host.pane(*pane)
                .is_some_and(|p| p.pty_id == credential.pty_id)
        });
        if host.pane(env.pane_id).is_some_and(|p| p.pty_id == pty_id) {
            panes.insert(
                env.pane_id,
                PaneCredential {
                    token: env.token.clone(),
                    pty_id,
                    seen: HashSet::new(),
                    order: VecDeque::new(),
                },
            );
        }
    }

    pub fn hooks(&self) -> &HookState {
        &self.0.hooks
    }

    pub fn shutdown(&self) {
        self.0.shutting_down.store(true, Ordering::Release);
        self.0.frontend_ready.store(false, Ordering::Release);
        self.0.hooks.broker.reset_all();
        self.0
            .panes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.0
            .starting
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.0.started.notify_all();
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
    sweep_stale_launcher_dirs(&descriptor_path);
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
            let response = ControlResponse::failure(
                SERVER_RESPONSE_ID,
                "server_busy",
                "too many concurrent control requests",
            );
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
    serve_connection(&mut stream, state, &TauriAgentHost(app), |request| {
        route_request(request, app, state)
    });
}

/// Reads one request and answers it. Hooks are served here, off the UI path,
/// because they may hold the connection while a decision is pending.
fn serve_connection(
    stream: &mut TcpStream,
    state: &ControlState,
    host: &dyn AgentHost,
    route: impl FnOnce(ControlRequest) -> ControlResponse,
) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let request = match read_request(&mut BufReader::new(&mut *stream)) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_response(
                stream,
                &ControlResponse::failure(error.response_id, error.code, error.message),
            );
            return;
        }
    };
    let response = if request.method == METHOD_HOOK {
        match authenticate(&request, state, host) {
            Ok(Some(pty_id)) => {
                agent_events::handle_bound(stream, &request, state.hooks(), host, pty_id)
            }
            Ok(None) => unreachable!("hook authentication requires a pane credential"),
            Err(response) => response,
        }
    } else {
        route(request)
    };
    let _ = write_response(stream, &response);
}

struct ReadRequestError {
    response_id: String,
    code: &'static str,
    message: String,
}

fn read_request(reader: &mut impl BufRead) -> Result<ControlRequest, ReadRequestError> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_MESSAGE_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|error| ReadRequestError {
            response_id: SERVER_RESPONSE_ID.to_string(),
            code: "io_error",
            message: format!("read request: {error}"),
        })?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(ReadRequestError {
            response_id: SERVER_RESPONSE_ID.to_string(),
            code: "message_too_large",
            message: format!("request exceeds {MAX_MESSAGE_BYTES} bytes"),
        });
    }
    if bytes.last() != Some(&b'\n') {
        return Err(ReadRequestError {
            response_id: SERVER_RESPONSE_ID.to_string(),
            code: "invalid_request",
            message: "request must end with a newline".to_string(),
        });
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| ReadRequestError {
        response_id: SERVER_RESPONSE_ID.to_string(),
        code: "invalid_json",
        message: format!("invalid request JSON: {error}"),
    })?;
    let response_id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| valid_request_id(id))
        .unwrap_or(SERVER_RESPONSE_ID)
        .to_string();
    serde_json::from_value(value).map_err(|error| ReadRequestError {
        response_id,
        code: "invalid_json",
        message: format!("invalid request JSON: {error}"),
    })
}

fn authenticate(
    request: &ControlRequest,
    state: &ControlState,
    host: &dyn AgentHost,
) -> Result<Option<u32>, ControlResponse> {
    if !valid_request_id(&request.id) {
        return Err(ControlResponse::failure(
            SERVER_RESPONSE_ID,
            "invalid_request",
            "request id must be 1-128 safe ASCII characters",
        ));
    }
    if request.protocol != PROTOCOL_VERSION {
        return Err(ControlResponse::failure(
            request.id.clone(),
            "unsupported_protocol",
            format!(
                "protocol {} is unsupported; expected {PROTOCOL_VERSION}",
                request.protocol
            ),
        ));
    }
    let Some(runtime) = state.0.runtime.get() else {
        return Err(ControlResponse::failure(
            request.id.clone(),
            "server_unavailable",
            "control server is not initialized",
        ));
    };
    let unauthorized = || {
        ControlResponse::failure(
            request.id.clone(),
            "unauthorized",
            "invalid or expired control credential",
        )
    };
    if state.0.shutting_down.load(Ordering::Acquire) {
        return Err(unauthorized());
    }
    if constant_time_eq(request.token.as_bytes(), runtime.token.as_bytes()) {
        return if request.method == METHOD_HOOK {
            Err(unauthorized())
        } else {
            Ok(None)
        };
    }
    // Shell startup files may call the CLI before spawn returns. Wait for
    // publication (or failed-spawn cleanup), without admitting a pending token.
    let starting = state.0.starting.lock().unwrap_or_else(|e| e.into_inner());
    let (starting, timeout) = state
        .0
        .started
        .wait_timeout_while(starting, FRONTEND_TIMEOUT, |tokens| {
            tokens.contains(&request.token)
        })
        .unwrap_or_else(|e| e.into_inner());
    if timeout.timed_out() && starting.contains(&request.token) {
        return Err(ControlResponse::failure(
            request.id.clone(),
            "server_unavailable",
            "terminal is still starting",
        ));
    }
    drop(starting);
    if state.0.shutting_down.load(Ordering::Acquire) {
        return Err(unauthorized());
    }
    let pane = request.caller.pane_id.ok_or_else(unauthorized)?;
    let mut panes = state.0.panes.lock().unwrap_or_else(|e| e.into_inner());
    let credential = panes.get_mut(&pane).ok_or_else(unauthorized)?;
    if !constant_time_eq(request.token.as_bytes(), credential.token.as_bytes())
        || !METHODS.contains(&request.method.as_str())
    {
        return Err(unauthorized());
    }
    if host
        .pane(pane)
        .is_none_or(|p| p.pty_id != credential.pty_id)
    {
        panes.remove(&pane);
        return Err(unauthorized());
    }
    if request.method == METHOD_HOOK {
        if !credential.seen.insert(request.id.clone()) {
            return Err(ControlResponse::failure(
                request.id.clone(),
                "duplicate_request",
                "hook request was already handled",
            ));
        }
        credential.order.push_back(request.id.clone());
        if credential.order.len() > RECENT_HOOK_IDS {
            if let Some(oldest) = credential.order.pop_front() {
                credential.seen.remove(&oldest);
            }
        }
    }
    Ok(Some(credential.pty_id))
}

fn route_request(
    mut request: ControlRequest,
    app: &tauri::AppHandle,
    state: &ControlState,
) -> ControlResponse {
    if let Err(response) = authenticate(&request, state, &TauriAgentHost(app)) {
        return response;
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
        _ => ControlResponse::failure(request.id, "unknown_method", "unknown control method"),
    }
}

fn validate_open_params(
    params: OpenParams,
    app: &tauri::AppHandle,
) -> Result<OpenParams, (&'static str, String)> {
    let (mut params, canonical) = normalize_open_target(params)?;
    let registry = app
        .try_state::<workspace::WorkspaceRegistry>()
        .ok_or_else(|| {
            (
                "internal_error",
                "workspace registry is unavailable".to_string(),
            )
        })?;
    require_authorized_open_target(&registry, &canonical)?;
    params.path = fs::to_canon(canonical);
    Ok(params)
}

fn require_authorized_open_target(
    registry: &workspace::WorkspaceRegistry,
    canonical: &Path,
) -> Result<(), (&'static str, String)> {
    if !registry.is_authorized(canonical) {
        return Err((
            "path_not_accessible",
            format!(
                "path is outside the authorized workspace: {}",
                canonical.display()
            ),
        ));
    }
    Ok(())
}

fn normalize_open_target(
    params: OpenParams,
) -> Result<(OpenParams, PathBuf), (&'static str, String)> {
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
    Ok((params, canonical))
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
    let mut bytes = serde_json::to_vec(response).map_err(std::io::Error::other)?;
    bytes.push(b'\n');
    stream.write_all(&bytes)
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

fn sweep_stale_launcher_dirs(descriptor: &Path) {
    let Some(control_dir) = descriptor.parent() else {
        return;
    };
    let run_root = control_dir.join("run");
    let Ok(entries) = std::fs::read_dir(&run_root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok());
        if launcher_dir_is_stale(&name, modified, now, process_is_alive) {
            if let Err(error) = std::fs::remove_dir_all(entry.path()) {
                log::warn!(
                    "could not remove stale CLI launcher {}: {error}",
                    entry.path().display()
                );
            }
        }
    }
}

fn launcher_dir_is_stale(
    name: &str,
    modified: Option<SystemTime>,
    now: SystemTime,
    is_alive: impl Fn(u32) -> bool,
) -> bool {
    match name.parse::<u32>() {
        Ok(pid) => !is_alive(pid),
        Err(_) => modified
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_LAUNCHER_MAX_AGE),
    }
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    if pid <= 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    if pid == 0 {
        return false;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            CloseHandle(handle);
            true
        } else {
            GetLastError() == ERROR_ACCESS_DENIED
        }
    }
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
    use std::io::Cursor;

    fn open_params(path: String) -> OpenParams {
        OpenParams {
            path,
            line: None,
            column: None,
            focus: true,
        }
    }

    fn read_error(bytes: Vec<u8>) -> ReadRequestError {
        match read_request(&mut Cursor::new(bytes)) {
            Ok(_) => panic!("request was unexpectedly accepted"),
            Err(error) => error,
        }
    }

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
    fn request_reader_enforces_framing_and_size_boundaries() {
        let mut exact = vec![b' '; MAX_MESSAGE_BYTES];
        exact[MAX_MESSAGE_BYTES - 1] = b'\n';
        let error = read_error(exact);
        assert_eq!(error.code, "invalid_json");

        let mut oversized = vec![b' '; MAX_MESSAGE_BYTES];
        oversized.push(b'\n');
        let error = read_error(oversized);
        assert_eq!(error.code, "message_too_large");

        let error = read_error(b"{}".to_vec());
        assert_eq!(error.code, "invalid_request");
    }

    #[test]
    fn request_reader_preserves_a_safe_id_for_shape_errors() {
        let bytes = br#"{"id":"shape-test","protocol":"bad"}
"#;
        let error = read_error(bytes.to_vec());
        assert_eq!(error.code, "invalid_json");
        assert_eq!(error.response_id, "shape-test");
    }

    #[test]
    fn open_target_validation_rejects_invalid_bounds_and_directories() {
        let error = normalize_open_target(open_params(String::new())).expect_err("reject empty");
        assert_eq!(error.0, "invalid_params");

        let error = normalize_open_target(open_params("x".repeat(16 * 1024 + 1)))
            .expect_err("reject oversized path");
        assert_eq!(error.0, "invalid_params");

        let mut params = open_params("unused".into());
        params.line = Some(0);
        let error = normalize_open_target(params).expect_err("reject zero line");
        assert_eq!(error.0, "invalid_params");

        let temp = tempfile::tempdir().expect("temp directory");
        let error = normalize_open_target(open_params(temp.path().to_string_lossy().into_owned()))
            .expect_err("reject directory");
        assert_eq!(error.0, "not_a_file");
    }

    #[test]
    fn open_authorization_is_read_only() {
        let authorized = tempfile::tempdir().expect("authorized directory");
        let outside = tempfile::tempdir().expect("outside directory");
        let outside_file = outside.path().join("outside.rs");
        std::fs::write(&outside_file, b"fn main() {}\n").expect("write outside file");
        let outside_file = std::fs::canonicalize(outside_file).expect("canonical outside file");
        let registry = workspace::WorkspaceRegistry::default();
        registry
            .authorize(authorized.path())
            .expect("authorize workspace");

        let error = require_authorized_open_target(&registry, &outside_file)
            .expect_err("reject outside file");

        assert_eq!(error.0, "path_not_accessible");
        assert!(!registry.is_authorized(&outside_file));
    }

    #[test]
    fn shutdown_stops_advertising_shell_credentials() {
        let state = ControlState::default();
        assert!(state
            .0
            .runtime
            .set(RuntimeInfo {
                address: "127.0.0.1:4312".into(),
                token: "a".repeat(64),
                descriptor_path: PathBuf::from("unused-control.json"),
                cli_path: None,
                launcher_dir: None,
            })
            .is_ok());
        assert!(state.shell_env(7).is_some());
        state.shutdown();
        assert!(state.shell_env(7).is_none());
    }

    #[test]
    fn launcher_cleanup_preserves_live_pids_and_expires_other_stale_entries() {
        let now = SystemTime::UNIX_EPOCH + STALE_LAUNCHER_MAX_AGE * 2;
        assert!(!launcher_dir_is_stale(
            "42",
            Some(SystemTime::UNIX_EPOCH),
            now,
            |pid| pid == 42
        ));
        assert!(launcher_dir_is_stale("43", Some(now), now, |_| false));
        assert!(launcher_dir_is_stale(
            "invalid",
            Some(SystemTime::UNIX_EPOCH),
            now,
            |_| true
        ));
        assert!(!launcher_dir_is_stale("invalid", Some(now), now, |_| true));
    }

    #[test]
    fn stale_pid_launcher_directories_are_removed() {
        let temp = tempfile::tempdir().expect("temp directory");
        let descriptor = temp.path().join("control.json");
        let stale = temp.path().join("run").join(u32::MAX.to_string());
        std::fs::create_dir_all(stale.join("bin")).expect("create stale launcher");

        sweep_stale_launcher_dirs(&descriptor);

        assert!(!stale.exists());
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

    mod hook_end_to_end {
        use super::*;
        use crate::modules::agent_events::test_host::FakeHost;
        use serde_json::json;
        use std::ffi::OsString;
        use std::sync::Arc;
        use terax_cli::hook::{run, HookEnvironment};
        use terax_control_protocol::hook::{HookDecision, HookKind};

        const TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

        struct Server {
            state: ControlState,
            host: Arc<FakeHost>,
            address: String,
            token: String,
        }

        fn serve() -> Server {
            let state = ControlState::default();
            assert!(state
                .0
                .runtime
                .set(RuntimeInfo {
                    address: "127.0.0.1:0".into(),
                    token: TOKEN.into(),
                    descriptor_path: PathBuf::from("unused-control.json"),
                    cli_path: None,
                    launcher_dir: None,
                })
                .is_ok());
            let host = FakeHost::new(true);
            let env = state.shell_env(3).unwrap();
            state.activate_shell(&env, 9, host.as_ref());
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
            let address = listener.local_addr().expect("address").to_string();
            let (accept_state, accept_host) = (state.clone(), host.clone());
            thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { break };
                    let (state, host) = (accept_state.clone(), accept_host.clone());
                    thread::spawn(move || {
                        serve_connection(&mut stream, &state, host.as_ref(), |request| {
                            ControlResponse::failure(request.id, "unknown_method", "unknown")
                        });
                    });
                }
            });
            Server {
                state,
                host,
                address,
                token: env.token,
            }
        }

        fn environment(server: &Server, token: &str) -> HookEnvironment {
            HookEnvironment {
                pane_id: 3,
                address: server.address.clone(),
                token: token.into(),
                decision_secs: 30,
                wait_enabled: true,
                debug: false,
            }
        }

        fn invoke(
            environment: &HookEnvironment,
            agent: &str,
            event: &str,
            payload: Value,
        ) -> String {
            let args: Vec<OsString> = vec![agent.into(), event.into()];
            let mut out = Vec::new();
            run(
                &args,
                Some(environment),
                Box::new(Cursor::new(payload.to_string().into_bytes())),
                &mut out,
            );
            String::from_utf8(out).expect("utf-8 output")
        }

        #[test]
        fn desktop_credentials_cannot_impersonate_a_pane_hook() {
            let server = serve();
            let request = ControlRequest {
                protocol: PROTOCOL_VERSION,
                id: "desktop-hook".into(),
                token: TOKEN.into(),
                method: METHOD_HOOK.into(),
                params: json!({}),
                caller: terax_control_protocol::CallerContext { pane_id: Some(3) },
            };
            assert!(authenticate(&request, &server.state, server.host.as_ref()).is_err());
        }

        #[test]
        fn pane_credentials_bind_generation_caller_methods_and_recent_request_ids() {
            let server = serve();
            let mut request = ControlRequest {
                protocol: PROTOCOL_VERSION,
                id: "hook-1".into(),
                token: server.token.clone(),
                method: METHOD_HOOK.into(),
                params: json!({}),
                caller: terax_control_protocol::CallerContext { pane_id: Some(3) },
            };
            request.caller.pane_id = Some(4);
            assert!(authenticate(&request, &server.state, server.host.as_ref()).is_err());
            request.caller.pane_id = Some(3);
            request.method = "future_privileged_method".into();
            assert!(authenticate(&request, &server.state, server.host.as_ref()).is_err());
            request.method = METHOD_HOOK.into();
            assert_eq!(
                authenticate(&request, &server.state, server.host.as_ref()).unwrap(),
                Some(9)
            );
            assert_eq!(
                authenticate(&request, &server.state, server.host.as_ref())
                    .unwrap_err()
                    .error
                    .unwrap()
                    .code,
                "duplicate_request"
            );
            request.id = "hook-2".into();
            server.host.live.lock().unwrap().as_mut().unwrap().pty_id = 10;
            assert!(authenticate(&request, &server.state, server.host.as_ref()).is_err());
            let fresh = server.state.shell_env(3).unwrap();
            assert_ne!(fresh.token, server.token);
            server
                .state
                .activate_shell(&fresh, 10, server.host.as_ref());
            request.token = fresh.token;
            assert_eq!(
                authenticate(&request, &server.state, server.host.as_ref()).unwrap(),
                Some(10)
            );
            request.id = "hook-3".into();
            *server.host.live.lock().unwrap() = None;
            assert!(authenticate(&request, &server.state, server.host.as_ref()).is_err());
            request.token = TOKEN.into();
            request.method = METHOD_PING.into();
            assert_eq!(
                authenticate(&request, &server.state, server.host.as_ref()).unwrap(),
                None
            );
        }

        #[test]
        fn a_live_pane_retains_cli_access_and_replay_storage_is_bounded() {
            let server = serve();
            let mut request = ControlRequest {
                protocol: PROTOCOL_VERSION,
                id: "cli".into(),
                token: server.token.clone(),
                method: METHOD_OPEN.into(),
                params: json!({}),
                caller: terax_control_protocol::CallerContext { pane_id: Some(3) },
            };
            for method in [
                METHOD_OPEN,
                METHOD_IDENTIFY,
                METHOD_PING,
                METHOD_CAPABILITIES,
            ] {
                request.method = method.into();
                assert!(authenticate(&request, &server.state, server.host.as_ref()).is_ok());
            }
            request.method = METHOD_HOOK.into();
            for id in 0..RECENT_HOOK_IDS + 2 {
                request.id = format!("hook-{id}");
                assert!(authenticate(&request, &server.state, server.host.as_ref()).is_ok());
            }
            let panes = server.state.0.panes.lock().unwrap();
            let credential = panes.get(&3).unwrap();
            assert_eq!(credential.seen.len(), RECENT_HOOK_IDS);
            assert_eq!(credential.order.len(), RECENT_HOOK_IDS);
        }

        #[test]
        fn startup_cli_waits_for_publication_and_failed_spawns_never_authenticate() {
            for succeeds in [true, false] {
                let server = serve();
                let env = server.state.shell_env(3).unwrap();
                let pending = server.state.pending_shell(&env);
                let request = ControlRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "startup".into(),
                    token: env.token.clone(),
                    method: METHOD_PING.into(),
                    params: json!({}),
                    caller: terax_control_protocol::CallerContext { pane_id: Some(3) },
                };
                let (began_tx, began_rx) = mpsc::channel();
                let (done_tx, done_rx) = mpsc::channel();
                let (state, host) = (server.state.clone(), server.host.clone());
                let worker = thread::spawn(move || {
                    began_tx.send(()).unwrap();
                    done_tx
                        .send(authenticate(&request, &state, host.as_ref()))
                        .unwrap();
                });
                began_rx.recv().unwrap();
                assert!(done_rx.recv_timeout(Duration::from_millis(100)).is_err());
                if succeeds {
                    server.state.activate_shell(&env, 9, server.host.as_ref());
                }
                drop(pending);
                assert_eq!(done_rx.recv().unwrap().is_ok(), succeeds);
                worker.join().unwrap();
                assert!(server.state.0.starting.lock().unwrap().is_empty());
            }
        }

        #[test]
        fn a_generation_change_after_authentication_cannot_emit_or_register_a_decision() {
            let server = serve();
            server.state.hooks().broker.set_window_ready("main", true);
            let request = ControlRequest {
                protocol: PROTOCOL_VERSION,
                id: "generation-race".into(),
                token: server.token.clone(),
                method: METHOD_HOOK.into(),
                params: json!({"agent":"claude", "event":"PermissionRequest", "payload":{}, "wait_secs":1}),
                caller: terax_control_protocol::CallerContext { pane_id: Some(3) },
            };
            let pty = authenticate(&request, &server.state, server.host.as_ref())
                .unwrap()
                .unwrap();
            assert_eq!(pty, 9);
            server.host.live.lock().unwrap().as_mut().unwrap().pty_id = 10;
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let _client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
            let (stream, _) = listener.accept().unwrap();
            let response = agent_events::handle_bound(
                &stream,
                &request,
                server.state.hooks(),
                server.host.as_ref(),
                pty,
            );
            assert_eq!(response.error.unwrap().code, "unauthorized");
            assert!(server.host.events.lock().unwrap().is_empty());
            assert!(server.host.signals.lock().unwrap().is_empty());
            assert_eq!(server.state.hooks().broker.pending_count(), 0);
        }

        #[test]
        fn a_cli_hook_becomes_a_structured_event() {
            let server = serve();
            let output = invoke(
                &environment(&server, &server.token),
                "codex",
                "Stop",
                json!({
                    "session_id": "sess-1",
                    "transcript_path": null,
                    "cwd": "/repo",
                    "last_assistant_message": "All done",
                    "tool_response": "x".repeat(300_000),
                }),
            );
            assert_eq!(output, "{}\n");

            let events = server.host.events.lock().unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!((events[0].pane_id, events[0].pty_id), (3, 9));
            assert_eq!(events[0].facts.kind, HookKind::Stop);
            assert_eq!(events[0].facts.session_id.as_deref(), Some("sess-1"));
            assert_eq!(events[0].facts.cwd.as_deref(), Some("/repo"));
            assert_eq!(events[0].facts.message.as_deref(), Some("All done"));
            assert_eq!(
                *server.host.signals.lock().unwrap(),
                vec!["started:codex", "finished:"]
            );
        }

        #[test]
        fn a_wrong_token_is_rejected_without_an_event() {
            let server = serve();
            let output = invoke(
                &environment(&server, &"b".repeat(64)),
                "claude",
                "Stop",
                json!({ "session_id": "s" }),
            );
            assert_eq!(output, "{}\n");
            assert!(server.host.events.lock().unwrap().is_empty());
        }

        #[test]
        fn a_pane_without_a_terminal_is_rejected() {
            let server = serve();
            let mut environment = environment(&server, &server.token);
            environment.pane_id = 99;
            invoke(&environment, "claude", "Stop", json!({}));
            assert!(server.host.events.lock().unwrap().is_empty());
        }

        #[test]
        fn a_permission_round_trip_returns_the_agent_decision_json() {
            let server = serve();
            server.state.hooks().broker.set_window_ready("main", true);
            let (state, host) = (server.state.clone(), server.host.clone());
            let ui = thread::spawn(move || {
                let id =
                    loop {
                        let id =
                            host.events.lock().unwrap().iter().find_map(|event| {
                                event.facts.permission.as_ref()?.request_id.clone()
                            });
                        if let Some(id) = id {
                            break id;
                        }
                        thread::sleep(Duration::from_millis(5));
                    };
                let decision = HookDecision::Allow { remember: Some(0) };
                assert!(state.hooks().broker.resolve(&id, decision));
            });
            let output = invoke(
                &environment(&server, &server.token),
                "claude",
                "PermissionRequest",
                json!({
                    "session_id": "s",
                    "tool_name": "Bash",
                    "tool_input": { "command": "npm test" },
                    "permission_suggestions": [
                        { "type": "addRules", "behavior": "allow", "destination": "session",
                          "rules": [{ "toolName": "Bash", "ruleContent": "npm test" }] }
                    ],
                }),
            );
            ui.join().unwrap();
            let value: Value = serde_json::from_str(output.trim()).expect("decision json");
            let decision = &value["hookSpecificOutput"]["decision"];
            assert_eq!(
                value["hookSpecificOutput"]["hookEventName"],
                "PermissionRequest"
            );
            assert_eq!(decision["behavior"], "allow");
            assert_eq!(decision["updatedPermissions"][0]["destination"], "session");
            assert_eq!(
                server.host.kinds(),
                vec![HookKind::PermissionRequest, HookKind::PermissionResolved]
            );
        }

        #[test]
        fn a_permission_with_no_ui_falls_back_to_the_agent_prompt() {
            let server = serve();
            let started = std::time::Instant::now();
            let output = invoke(
                &environment(&server, &server.token),
                "claude",
                "PermissionRequest",
                json!({ "tool_name": "Bash" }),
            );
            assert_eq!(output, "{}\n");
            assert!(started.elapsed() < Duration::from_secs(5));
        }
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
