use tauri::State;

use super::manager::{self, ConnectParams, SshState};
use super::*;

#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, SshState>,
    params: ConnectParams,
) -> Result<SshHostInfo, String> {
    manager::ssh_connect(&state, params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_resolve_home(
    state: State<'_, SshState>,
    name: String,
    user: String,
) -> Result<String, String> {
    manager::ssh_resolve_home(&state, &name, &user)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, SshState>, name: String) -> Result<(), String> {
    manager::ssh_disconnect(&state, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_list_connections(state: State<'_, SshState>) -> Result<Vec<SshHostInfo>, String> {
    manager::ssh_list_connections(&state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_read_dir(
    state: State<'_, SshState>,
    name: String,
    path: String,
) -> Result<Vec<RemoteDirEntry>, String> {
    manager::ssh_read_dir(&state, &name, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_read_file(
    state: State<'_, SshState>,
    name: String,
    path: String,
) -> Result<RemoteReadResult, String> {
    manager::ssh_read_file(&state, &name, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_write_file(
    state: State<'_, SshState>,
    name: String,
    path: String,
    content: String,
) -> Result<(), String> {
    manager::ssh_write_file(&state, &name, &path, &content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_stat(
    state: State<'_, SshState>,
    name: String,
    path: String,
) -> Result<RemoteFileStat, String> {
    manager::ssh_stat(&state, &name, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_create_file(
    state: State<'_, SshState>,
    name: String,
    path: String,
) -> Result<(), String> {
    manager::ssh_create_file(&state, &name, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_create_dir(
    state: State<'_, SshState>,
    name: String,
    path: String,
) -> Result<(), String> {
    manager::ssh_create_dir(&state, &name, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_rename(
    state: State<'_, SshState>,
    name: String,
    from: String,
    to: String,
) -> Result<(), String> {
    manager::ssh_rename(&state, &name, &from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_delete(
    state: State<'_, SshState>,
    name: String,
    path: String,
) -> Result<(), String> {
    manager::ssh_delete(&state, &name, &path)
        .await
        .map_err(|e| e.to_string())
}
