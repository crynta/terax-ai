mod install;
mod links;
mod local;
mod root;
mod resolve;
mod session;
mod transport;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

pub fn init(app: &AppHandle) {
    local::init(app);
}

pub struct LspState {
    sessions: RwLock<HashMap<u32, Arc<session::LspSession>>>,
    next_id: AtomicU32,
}

impl Default for LspState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[derive(Serialize)]
pub struct LspSpawnResult {
    pub id: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspBinaryProbe {
    pub command: String,
    pub found: bool,
    pub path: Option<String>,
    pub error: Option<String>,
    pub local: bool,
    pub linked: bool,
    pub wsl: bool,
    pub source: Option<String>,
}

fn probe_result(command: String, result: Result<resolve::LspTarget, String>) -> LspBinaryProbe {
    match result {
        Ok(target) => LspBinaryProbe {
            local: target.is_terax_local(),
            linked: target.is_linked(),
            wsl: target.is_wsl(),
            source: Some(target.source_label().to_string()),
            command,
            found: true,
            path: Some(target.display_path()),
            error: None,
        },
        Err(error) => LspBinaryProbe {
            command,
            found: false,
            path: None,
            error: Some(error),
            local: false,
            linked: false,
            wsl: false,
            source: None,
        },
    }
}

pub fn probe_binary(command: &str, _local_only: bool) -> LspBinaryProbe {
    probe_result(
        command.to_string(),
        resolve::resolve_lsp(command.trim()),
    )
}

#[tauri::command]
pub fn lsp_probe_binary(command: String, local_only: Option<bool>) -> LspBinaryProbe {
    probe_binary(&command, local_only.unwrap_or(false))
}

#[tauri::command]
pub async fn lsp_install(
    command: String,
    on_progress: Channel<String>,
) -> Result<LspBinaryProbe, String> {
    let progress = on_progress.clone();
    let cmd = command.clone();
    tauri::async_runtime::spawn_blocking(move || install::install_server(&cmd, &progress))
        .await
        .map_err(|e| e.to_string())??;
    Ok(probe_result(
        command.clone(),
        resolve::resolve_lsp(&command),
    ))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LspLinkInput {
    Path { path: String },
    Wsl { distro: String, command: String },
}

#[tauri::command]
pub fn lsp_link_binary(command: String, link: LspLinkInput) -> Result<LspBinaryProbe, String> {
    let stored = match link {
        LspLinkInput::Path { path } => links::LspBinaryLink::Path { path },
        LspLinkInput::Wsl { distro, command: cmd } => links::LspBinaryLink::Wsl {
            distro,
            command: cmd,
        },
    };
    links::set_link(&command, stored)?;
    Ok(probe_result(
        command.clone(),
        resolve::resolve_lsp(&command),
    ))
}

#[tauri::command]
pub fn lsp_unlink_binary(command: String) -> Result<LspBinaryProbe, String> {
    links::clear_link(&command)?;
    Ok(probe_result(
        command.clone(),
        resolve::resolve_lsp(&command),
    ))
}

#[tauri::command]
pub fn lsp_probe_wsl_binary(distro: String, command: String) -> Result<String, String> {
    links::probe_wsl_command(&distro, &command)
}

#[tauri::command]
pub fn lsp_resolve_root(
    file_path: String,
    command: String,
    workspace: Option<WorkspaceEnv>,
) -> String {
    let workspace = WorkspaceEnv::from_option(workspace);
    root::resolve_project_root(&file_path, &command, &workspace)
}

#[tauri::command]
pub async fn lsp_spawn(
    state: State<'_, LspState>,
    registry: State<'_, WorkspaceRegistry>,
    command: String,
    args: Vec<String>,
    cwd: String,
    workspace: Option<WorkspaceEnv>,
    on_message: Channel<String>,
    on_stderr: Channel<String>,
) -> Result<LspSpawnResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, Some(&cwd), &workspace)?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = tauri::async_runtime::spawn_blocking(move || {
        session::spawn(command, args, cwd, workspace, on_message, on_stderr)
    })
    .await
    .map_err(|e| e.to_string())??;
    state.sessions.write().unwrap().insert(id, session);
    log::info!("lsp spawned id={id}");
    Ok(LspSpawnResult { id })
}

#[tauri::command]
pub fn lsp_send(state: State<'_, LspState>, id: u32, message: String) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("lsp session {id} not found"))?;
    session.send(&message)
}

#[tauri::command]
pub fn lsp_close(state: State<'_, LspState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    if let Some(s) = session {
        s.kill();
        log::info!("lsp closed id={id}");
    }
    Ok(())
}
