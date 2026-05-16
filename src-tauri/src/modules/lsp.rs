use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::modules::ssh::{SshConn, SshState};
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const INIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct LspState {
    sessions: RwLock<HashMap<u32, Arc<LspSession>>>,
    next_id: AtomicU32,
}

struct LspSession {
    transport: LspTransport,
    next_request_id: AtomicU64,
    update_seq: AtomicU64,
    exited: AtomicBool,
    init: (Mutex<InitState>, Condvar),
    pending: Mutex<HashMap<u64, Arc<PendingRequest>>>,
    last_stderr: Mutex<String>,
    docs: Mutex<HashMap<String, i32>>,
    diagnostics: RwLock<HashMap<String, LspDiagnosticsResponse>>,
}

enum LspTransport {
    Local {
        child: Mutex<Child>,
        stdin: Mutex<ChildStdin>,
    },
    Ssh {
        cmd_tx: mpsc::UnboundedSender<SshLspCmd>,
    },
}

enum SshLspCmd {
    Message(Vec<u8>),
    Close,
}

struct PendingRequest {
    result: Mutex<Option<Result<Value, String>>>,
    ready: Condvar,
}

#[derive(Default)]
struct InitState {
    request_id: Option<u64>,
    ready: bool,
    failed: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub root_path: String,
    pub workspace: Option<WorkspaceEnv>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspTextDocumentRequest {
    pub handle: u32,
    pub path: String,
    pub language_id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspChangeRequest {
    pub handle: u32,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspHandleRequest {
    pub handle: u32,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSaveRequest {
    pub handle: u32,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspHoverRequest {
    pub handle: u32,
    pub path: String,
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDefinitionRequest {
    pub handle: u32,
    pub path: String,
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnosticsResponse {
    pub version: u64,
    pub diagnostics: Vec<LspDiagnostic>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnostic {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    pub severity: Option<u32>,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspHoverResponse {
    pub contents: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDefinitionResponse {
    pub uri: String,
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LspPublishDiagnostics {
    uri: String,
    diagnostics: Vec<LspPublishDiagnostic>,
}

#[derive(Debug, Deserialize)]
struct LspPublishDiagnostic {
    range: LspRange,
    severity: Option<u32>,
    message: String,
    source: Option<String>,
    code: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct LspRange {
    start: LspPosition,
    end: LspPosition,
}

#[derive(Debug, Deserialize)]
struct LspPosition {
    line: u32,
    character: u32,
}

#[derive(Debug, Deserialize)]
struct LspLocation {
    uri: String,
    range: LspRange,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LspLocationLink {
    target_uri: String,
    target_selection_range: LspRange,
}

impl LspSession {
    fn new(transport: LspTransport) -> Self {
        Self {
            transport,
            next_request_id: AtomicU64::new(1),
            update_seq: AtomicU64::new(0),
            exited: AtomicBool::new(false),
            init: (Mutex::new(InitState::default()), Condvar::new()),
            pending: Mutex::new(HashMap::new()),
            last_stderr: Mutex::new(String::new()),
            docs: Mutex::new(HashMap::new()),
            diagnostics: RwLock::new(HashMap::new()),
        }
    }

    fn next_seq(&self) -> u64 {
        self.update_seq.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_message(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
    }

    fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let pending = Arc::new(PendingRequest {
            result: Mutex::new(None),
            ready: Condvar::new(),
        });
        self.pending.lock().unwrap().insert(id, pending.clone());

        if let Err(error) = self.write_message(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }

        let result = pending.result.lock().unwrap();
        let (result, _) = pending
            .ready
            .wait_timeout_while(result, INIT_TIMEOUT, |slot| slot.is_none())
            .map_err(|e| e.to_string())?;
        self.pending.lock().unwrap().remove(&id);

        match result.as_ref() {
            Some(Ok(value)) => Ok(value.clone()),
            Some(Err(error)) => Err(error.clone()),
            None => Err(format!("LSP request timed out: {method}")),
        }
    }

    fn write_message(&self, message: Value) -> Result<(), String> {
        let body = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
        let mut packet = Vec::with_capacity(header.len() + body.len());
        packet.extend_from_slice(&header);
        packet.extend_from_slice(&body);
        match &self.transport {
            LspTransport::Local { stdin, .. } => {
                let mut stdin = stdin.lock().unwrap();
                stdin.write_all(&packet)
                    .and_then(|_| stdin.flush())
                    .map_err(|e| e.to_string())
            }
            LspTransport::Ssh { cmd_tx } => cmd_tx
                .send(SshLspCmd::Message(packet))
                .map_err(|_| "SSH LSP channel is closed".to_string()),
        }
    }

    fn mark_init_ready(&self) {
        let (lock, cv) = &self.init;
        let mut init = lock.lock().unwrap();
        init.ready = true;
        init.failed = None;
        cv.notify_all();
    }

    fn mark_init_failed(&self, message: String) {
        let stderr = self.last_stderr.lock().unwrap().trim().to_string();
        let message = if stderr.is_empty() || message.contains(&stderr) {
            message
        } else {
            format!("{message}: {stderr}")
        };
        let (lock, cv) = &self.init;
        let mut init = lock.lock().unwrap();
        if init.failed.is_none() {
            init.failed = Some(message);
        }
        cv.notify_all();
    }

    fn push_stderr_line(&self, line: &str) {
        let mut stderr = self.last_stderr.lock().unwrap();
        if !stderr.is_empty() {
          stderr.push('\n');
        }
        stderr.push_str(line.trim());
    }

    fn wait_for_init(&self) -> Result<(), String> {
        let (lock, cv) = &self.init;
        let init = lock.lock().unwrap();
        let (init, _) = cv
            .wait_timeout_while(init, INIT_TIMEOUT, |s| !s.ready && s.failed.is_none())
            .map_err(|e| e.to_string())?;
        if init.ready {
            return Ok(());
        }
        Err(init
            .failed
            .clone()
            .unwrap_or_else(|| "language server initialize timed out".into()))
    }

    fn kill(&self) {
        self.exited.store(true, Ordering::Release);
        match &self.transport {
            LspTransport::Local { child, .. } => {
                let _ = child.lock().unwrap().kill();
            }
            LspTransport::Ssh { cmd_tx } => {
                let _ = cmd_tx.send(SshLspCmd::Close);
            }
        }
    }
}

impl Drop for LspSession {
    fn drop(&mut self) {
        match &self.transport {
            LspTransport::Local { child, .. } => {
                let _ = child.lock().unwrap().kill();
            }
            LspTransport::Ssh { cmd_tx } => {
                let _ = cmd_tx.send(SshLspCmd::Close);
            }
        }
    }
}

#[tauri::command]
pub fn lsp_start(
    state: tauri::State<'_, LspState>,
    ssh_state: tauri::State<'_, SshState>,
    request: LspStartRequest,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(request.workspace);
    if matches!(workspace, WorkspaceEnv::Wsl { .. }) {
        return Err("LSP is currently supported only for Local and SSH workspaces".into());
    }

    let (session, root_uri) = match &workspace {
        WorkspaceEnv::Local => {
            let root_path = resolve_path(&request.root_path, &workspace);
            if !root_path.is_dir() {
                return Err(format!("LSP root is not a directory: {}", root_path.display()));
            }

            let resolved_command = resolve_lsp_command(&request.command);

            let mut child = Command::new(&resolved_command)
                .args(&request.args)
                .current_dir(&root_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| {
                    format!(
                        "failed to start `{}` (resolved to `{}`): {e}",
                        request.command,
                        resolved_command.display()
                    )
                })?;

            let stdin = child.stdin.take().ok_or("language server missing stdin")?;
            let stdout = child.stdout.take().ok_or("language server missing stdout")?;
            let stderr = child.stderr.take().ok_or("language server missing stderr")?;

            let session = Arc::new(LspSession::new(LspTransport::Local {
                child: Mutex::new(child),
                stdin: Mutex::new(stdin),
            }));
            spawn_stdout_reader(session.clone(), stdout);
            spawn_stderr_reader(session.clone(), stderr);
            (session, file_url(&root_path)?)
        }
        WorkspaceEnv::Ssh { profile_id } => {
            let conn = ssh_state.get_or_err(profile_id)?;
            let cmdline = build_remote_command(&request.command, &request.args, &request.root_path);
            let session = spawn_ssh_lsp_session(conn, &cmdline)?;
            (session, file_url(&request.root_path)?)
        }
        WorkspaceEnv::Wsl { .. } => unreachable!(),
    };

    let init_id = session.next_request_id.fetch_add(1, Ordering::Relaxed);

    {
        let (lock, _) = &session.init;
        let mut init = lock.lock().unwrap();
        init.request_id = Some(init_id);
    }

    let root_uri = normalize_uri_key(&root_uri);
    log::info!(
        "lsp start command={} args={:?} root_path={} root_uri={} workspace={:?}",
        request.command,
        request.args,
        request.root_path,
        root_uri,
        workspace
    );

    session.write_message(json!({
        "jsonrpc": "2.0",
        "id": init_id,
        "method": "initialize",
        "params": {
            "processId": std::process::id(),
            "clientInfo": { "name": "Terax", "version": env!("CARGO_PKG_VERSION") },
            "rootUri": root_uri,
            "rootPath": request.root_path,
            "workspaceFolders": [
                {
                    "uri": root_uri,
                    "name": "workspace"
                }
            ],
            "capabilities": {
                "textDocument": {
                    "publishDiagnostics": {
                        "relatedInformation": true,
                        "codeDescriptionSupport": true,
                        "dataSupport": true
                    },
                    "synchronization": {
                        "didSave": true,
                        "willSave": false,
                        "willSaveWaitUntil": false
                    }
                }
            }
        }
    }))?;

    session.wait_for_init()?;
    session.send_notification("initialized", json!({}))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.write().unwrap().insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn lsp_open(
    state: tauri::State<'_, LspState>,
    request: LspTextDocumentRequest,
) -> Result<(), String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    log::info!(
        "lsp open handle={} path={} uri={} language_id={}",
        request.handle,
        request.path,
        uri,
        request.language_id
    );
    session.docs.lock().unwrap().insert(uri.clone(), 1);
    session.send_notification(
        "textDocument/didOpen",
        json!({
            "textDocument": {
                "uri": uri,
                "languageId": request.language_id,
                "version": 1,
                "text": request.text,
            }
        }),
    )
}

#[tauri::command]
pub fn lsp_change(
    state: tauri::State<'_, LspState>,
    request: LspChangeRequest,
) -> Result<(), String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    let version = {
        let mut docs = session.docs.lock().unwrap();
        let entry = docs.entry(uri.clone()).or_insert(0);
        *entry += 1;
        *entry
    };
    session.send_notification(
        "textDocument/didChange",
        json!({
            "textDocument": {
                "uri": uri,
                "version": version,
            },
            "contentChanges": [{ "text": request.text }],
        }),
    )
}

#[tauri::command]
pub fn lsp_close(
    state: tauri::State<'_, LspState>,
    request: LspHandleRequest,
) -> Result<(), String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    session.docs.lock().unwrap().remove(&uri);
    session.send_notification(
        "textDocument/didClose",
        json!({
            "textDocument": { "uri": uri }
        }),
    )
}

#[tauri::command]
pub fn lsp_save(
    state: tauri::State<'_, LspState>,
    request: LspSaveRequest,
) -> Result<(), String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    session.send_notification(
        "textDocument/didSave",
        json!({
            "textDocument": { "uri": uri },
            "text": request.text,
        }),
    )
}

#[tauri::command]
pub fn lsp_read_diagnostics(
    state: tauri::State<'_, LspState>,
    request: LspHandleRequest,
) -> Result<LspDiagnosticsResponse, String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    let snapshot = session
        .diagnostics
        .read()
        .unwrap()
        .get(&uri)
        .cloned()
        .unwrap_or_default();
    Ok(snapshot)
}

#[tauri::command]
pub fn lsp_hover(
    state: tauri::State<'_, LspState>,
    request: LspHoverRequest,
) -> Result<Option<LspHoverResponse>, String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    let result = session.send_request(
        "textDocument/hover",
        json!({
            "textDocument": { "uri": uri },
            "position": {
                "line": request.line,
                "character": request.character,
            }
        }),
    )?;
    let parsed = parse_hover_result(result);
    Ok(parsed)
}

#[tauri::command]
pub fn lsp_definition(
    state: tauri::State<'_, LspState>,
    request: LspDefinitionRequest,
) -> Result<Option<LspDefinitionResponse>, String> {
    let session = get_session(&state, request.handle)?;
    let uri = normalize_uri_key(&file_url(&request.path)?);
    let result = session.send_request(
        "textDocument/definition",
        json!({
            "textDocument": { "uri": uri },
            "position": {
                "line": request.line,
                "character": request.character,
            }
        }),
    )?;
    Ok(parse_definition_result(result))
}

#[tauri::command]
pub fn lsp_stop(state: tauri::State<'_, LspState>, handle: u32) -> Result<(), String> {
    if let Some(session) = state.sessions.write().unwrap().remove(&handle) {
        session.kill();
    }
    Ok(())
}

fn get_session(state: &tauri::State<'_, LspState>, handle: u32) -> Result<Arc<LspSession>, String> {
    state
        .sessions
        .read()
        .unwrap()
        .get(&handle)
        .cloned()
        .ok_or_else(|| format!("no LSP session for handle {handle}"))
}

fn spawn_stdout_reader(session: Arc<LspSession>, stdout: impl Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_message(&mut reader) {
                Ok(Some(message)) => handle_server_message(&session, message),
                Ok(None) => {
                    session.mark_init_failed("language server exited before initialization".into());
                    break;
                }
                Err(e) => {
                    session.mark_init_failed(e);
                    break;
                }
            }
        }
        session.exited.store(true, Ordering::Release);
    });
}

fn spawn_stderr_reader(session: Arc<LspSession>, stderr: impl Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        loop {
            buf.clear();
            match reader.read_line(&mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let line = buf.trim();
                    if !line.is_empty() {
                        log::warn!("lsp stderr: {line}");
                        session.push_stderr_line(line);
                    }
                }
                Err(e) => {
                    session.mark_init_failed(e.to_string());
                    break;
                }
            }
        }
    });
}

fn spawn_ssh_lsp_session(
    conn: Arc<SshConn>,
    cmdline: &str,
) -> Result<Arc<LspSession>, String> {
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SshLspCmd>();
    let session = Arc::new(LspSession::new(LspTransport::Ssh { cmd_tx }));
    let session_ref = session.clone();
    let cmdline = cmdline.to_string();

    tauri::async_runtime::spawn(async move {
        let mut channel = match conn.handle.channel_open_session().await {
            Ok(channel) => channel,
            Err(error) => {
                session_ref.mark_init_failed(error.to_string());
                return;
            }
        };

        if let Err(error) = channel.exec(true, cmdline).await {
            session_ref.mark_init_failed(error.to_string());
            let _ = channel.close().await;
            return;
        }

        let mut recv_buf = Vec::<u8>::new();
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(SshLspCmd::Message(bytes)) => {
                            if let Err(error) = channel.data(bytes.as_ref()).await {
                                session_ref.mark_init_failed(error.to_string());
                                break;
                            }
                        }
                        Some(SshLspCmd::Close) | None => {
                            let _ = channel.eof().await;
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { ref data }) => {
                            recv_buf.extend_from_slice(data);
                            process_message_buffer(&session_ref, &mut recv_buf);
                        }
                        Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                            let text = String::from_utf8_lossy(data);
                            let text = text.trim();
                            if !text.is_empty() {
                                log::warn!("ssh lsp stderr: {text}");
                                session_ref.push_stderr_line(text);
                            }
                        }
                        Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                            session_ref.mark_init_failed(format!("remote language server exited with status {exit_status}"));
                            break;
                        }
                        Some(russh::ChannelMsg::Eof) | None => {
                            session_ref.mark_init_failed("remote language server exited before initialization".into());
                            break;
                        }
                        Some(_) => {}
                    }
                }
            }
        }
        session_ref.exited.store(true, Ordering::Release);
    });

    Ok(session)
}

fn handle_server_message(session: &LspSession, message: Value) {
    let Some(obj) = message.as_object() else {
        return;
    };

    if let Some(id) = obj.get("id").and_then(Value::as_u64) {
        if let Some(pending) = session.pending.lock().unwrap().remove(&id) {
            let mut slot = pending.result.lock().unwrap();
            *slot = Some(match obj.get("error") {
                Some(error) => Err(error.to_string()),
                None => Ok(obj.get("result").cloned().unwrap_or(Value::Null)),
            });
            pending.ready.notify_all();
            return;
        }
    }

    if obj.get("method").and_then(Value::as_str) == Some("textDocument/publishDiagnostics") {
        let Some(params) = obj.get("params") else {
            return;
        };
        if let Ok(params) = serde_json::from_value::<LspPublishDiagnostics>(params.clone()) {
            let uri = normalize_uri_key(&params.uri);
            let diagnostics: Vec<LspDiagnostic> = params
                .diagnostics
                .into_iter()
                .map(|diag| LspDiagnostic {
                    start_line: diag.range.start.line,
                    start_character: diag.range.start.character,
                    end_line: diag.range.end.line,
                    end_character: diag.range.end.character,
                    severity: diag.severity,
                    message: diag.message,
                    source: diag.source,
                    code: diag.code.map(code_to_string),
                })
                .collect();
            let count = diagnostics.len();
            let first_message = diagnostics
                .first()
                .map(|diag| diag.message.as_str())
                .unwrap_or("<none>");
            log::info!(
                "lsp diagnostics uri={} count={} first={}",
                uri,
                count,
                first_message
            );
            session.diagnostics.write().unwrap().insert(
                uri,
                LspDiagnosticsResponse {
                    version: session.next_seq(),
                    diagnostics,
                },
            );
        }
        return;
    }

    let Some(id) = obj.get("id").and_then(Value::as_u64) else {
        return;
    };
    let (lock, _) = &session.init;
    let init_id = lock.lock().unwrap().request_id;
    if init_id != Some(id) {
        return;
    }
    if let Some(error) = obj.get("error") {
        session.mark_init_failed(error.to_string());
    } else {
        session.mark_init_ready();
    }
}

fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            let len = rest.trim().parse::<usize>().map_err(|e| e.to_string())?;
            content_length = Some(len);
        }
    }

    let len = content_length.ok_or("missing Content-Length header")?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

fn process_message_buffer(session: &LspSession, buffer: &mut Vec<u8>) {
    loop {
        let Some(header_end) = find_header_end(buffer) else {
            return;
        };
        let header = match std::str::from_utf8(&buffer[..header_end]) {
            Ok(header) => header,
            Err(error) => {
                session.mark_init_failed(error.to_string());
                return;
            }
        };
        let Some(content_length) = parse_content_length(header) else {
            session.mark_init_failed("missing Content-Length header".into());
            return;
        };
        let message_end = header_end + 4 + content_length;
        if buffer.len() < message_end {
            return;
        }
        let body = buffer[header_end + 4..message_end].to_vec();
        buffer.drain(..message_end);
        match serde_json::from_slice::<Value>(&body) {
            Ok(message) => handle_server_message(session, message),
            Err(error) => {
                session.mark_init_failed(error.to_string());
                return;
            }
        }
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_content_length(header: &str) -> Option<usize> {
    header.lines().find_map(|line| {
        line.strip_prefix("Content-Length:")
            .and_then(|value| value.trim().parse::<usize>().ok())
    })
}

fn parse_definition_result(result: Value) -> Option<LspDefinitionResponse> {
    match result {
        Value::Null => None,
        Value::Array(items) => items.into_iter().find_map(parse_definition_item),
        other => parse_definition_item(other),
    }
}

fn parse_definition_item(value: Value) -> Option<LspDefinitionResponse> {
    if let Ok(location) = serde_json::from_value::<LspLocation>(value.clone()) {
        return Some(LspDefinitionResponse {
            uri: location.uri,
            line: location.range.start.line,
            character: location.range.start.character,
        });
    }

    let link = serde_json::from_value::<LspLocationLink>(value).ok()?;
    Some(LspDefinitionResponse {
        uri: link.target_uri,
        line: link.target_selection_range.start.line,
        character: link.target_selection_range.start.character,
    })
}

fn file_url(path: impl AsRef<Path>) -> Result<String, String> {
    let path = path.as_ref();
    let raw = path
        .to_str()
        .ok_or_else(|| format!("non-utf8 path unsupported for LSP: {}", path.display()))?;

    if !is_supported_absolute_path(path, raw) {
        return Err(format!("failed to convert path to file URL: {}", path.display()));
    }

    #[cfg(windows)]
    let normalized = {
        let replaced = raw.replace('\\', "/");
        if replaced.len() >= 2 && replaced.as_bytes()[1] == b':' {
            format!("/{replaced}")
        } else {
            replaced
        }
    };

    #[cfg(not(windows))]
    let normalized = raw.to_string();

    Ok(format!("file://{}", percent_encode_path(&normalized)))
}

fn is_supported_absolute_path(path: &Path, raw: &str) -> bool {
    if path.is_absolute() {
        return true;
    }

    #[cfg(windows)]
    {
        // SSH remote paths are POSIX-style absolute paths like /home/user/file.ts
        // even when the desktop app itself is running on Windows.
        raw.starts_with('/')
    }

    #[cfg(not(windows))]
    {
        let _ = raw;
        false
    }
}

fn normalize_uri_key(uri: &str) -> String {
    #[cfg(windows)]
    {
        let mut normalized = uri.replace("file:///", "file:///");
        if let Some(rest) = normalized.strip_prefix("file:///") {
            let bytes = rest.as_bytes();
            if bytes.len() >= 3 && bytes[1] == b':' && bytes[2] == b'/' {
                let drive = (bytes[0] as char).to_ascii_lowercase();
                normalized = format!("file:///{drive}%3A{}", &rest[2..]);
            } else if bytes.len() >= 5
                && bytes[1] == b'%'
                && (bytes[2] == b'3' || bytes[2] == b'3')
                && (bytes[3] == b'A' || bytes[3] == b'a')
                && bytes[4] == b'/'
            {
                let drive = (bytes[0] as char).to_ascii_lowercase();
                normalized = format!("file:///{drive}%3A{}", &rest[4..]);
            }
        }
        normalized
    }

    #[cfg(not(windows))]
    {
        uri.to_string()
    }
}

fn resolve_lsp_command(command: &str) -> PathBuf {
    let command_path = Path::new(command);
    if command_path.components().count() > 1 || command_path.is_absolute() {
        return command_path.to_path_buf();
    }

    #[cfg(windows)]
    {
        if let Some(path) = find_on_path(command, &[".cmd", ".bat", ".exe", ""]) {
            return path;
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(path) = find_on_path(command, &[""]) {
            return path;
        }
    }

    command_path.to_path_buf()
}

fn build_remote_command(command: &str, args: &[String], cwd: &str) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(shell_escape(command));
    parts.extend(args.iter().map(|arg| shell_escape(arg)));
    format!(
        "{} && cd {} && command -v {} >/dev/null 2>&1 || {{ echo '{}' not found on PATH in non-interactive shell >&2; exit 127; }} && exec {}",
        remote_shell_init_snippet(),
        shell_escape(cwd),
        shell_escape(command),
        command,
        parts.join(" ")
    )
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn remote_shell_init_snippet() -> &'static str {
    r#"case "${SHELL##*/}" in
  bash)
    [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1
    ;;
  zsh)
    [ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc" >/dev/null 2>&1
    ;;
esac
[ -f "$HOME/.profile" ] && . "$HOME/.profile" >/dev/null 2>&1
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
command -v nvm >/dev/null 2>&1 && nvm use default >/dev/null 2>&1 || true"#
}

fn find_on_path(command: &str, suffixes: &[&str]) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    for dir in env::split_paths(&paths) {
        for suffix in suffixes {
            let candidate = dir.join(format!("{command}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn percent_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'/'
            | b':' => out.push(char::from(b)),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn code_to_string(value: Value) -> String {
    match value {
        Value::String(s) => s,
        other => other.to_string(),
    }
}

fn parse_hover_result(result: Value) -> Option<LspHoverResponse> {
    if result.is_null() {
        return None;
    }
    let contents = result.get("contents")?;
    let text = hover_contents_to_string(contents)?.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(LspHoverResponse { contents: text })
    }
}

fn hover_contents_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .filter_map(hover_contents_to_string)
                .filter(|part| !part.trim().is_empty())
                .collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n\n"))
            }
        }
        Value::Object(map) => {
            if let Some(text) = map.get("value").and_then(Value::as_str) {
                return Some(text.to_string());
            }
            if let (Some(language), Some(text)) = (
                map.get("language").and_then(Value::as_str),
                map.get("value").and_then(Value::as_str),
            ) {
                return Some(format!("{language}\n{text}"));
            }
            None
        }
        _ => None,
    }
}