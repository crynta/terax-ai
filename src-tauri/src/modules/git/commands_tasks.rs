use tauri::{AppHandle, Manager};

use super::project_config::{self, ProjectConfig};
use super::task_worktree::{
    self, DiskUsage, TaskArchive, TaskCreateRequest, TaskCreated, TaskRecord,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    operation: impl FnOnce(&WorkspaceRegistry, &std::path::Path) -> super::errors::Result<T>
        + Send
        + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        let home =
            dirs::home_dir().ok_or_else(|| "could not resolve home directory".to_string())?;
        operation(&registry, &home).map_err(String::from)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_project_config(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<ProjectConfig, String> {
    blocking(app, move |r, _| {
        project_config::read(r, &repo_root, &WorkspaceEnv::from_option(workspace))
    })
    .await
}

#[tauri::command]
pub async fn task_worktree_list(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<TaskRecord>, String> {
    blocking(app, move |r, home| {
        task_worktree::list(r, &repo_root, &WorkspaceEnv::from_option(workspace), home)
    })
    .await
}

#[tauri::command]
pub async fn task_worktree_create(
    repo_root: String,
    request: TaskCreateRequest,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<TaskCreated, String> {
    blocking(app, move |r, home| {
        task_worktree::create(
            r,
            &repo_root,
            &request,
            &WorkspaceEnv::from_option(workspace),
            home,
        )
    })
    .await
}

#[tauri::command]
pub async fn task_worktree_prepare_archive(
    repo_root: String,
    task_id: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<TaskArchive, String> {
    blocking(app, move |r, home| {
        task_worktree::prepare_archive(
            r,
            &repo_root,
            &task_id,
            &WorkspaceEnv::from_option(workspace),
            home,
        )
    })
    .await
}

#[tauri::command]
pub async fn task_worktree_archive(
    repo_root: String,
    task_id: String,
    force: Option<bool>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<TaskArchive, String> {
    blocking(app, move |r, home| {
        task_worktree::archive(
            r,
            &repo_root,
            &task_id,
            force.unwrap_or(false),
            &WorkspaceEnv::from_option(workspace),
            home,
        )
    })
    .await
}

#[tauri::command]
pub async fn task_worktree_restore(
    repo_root: String,
    task_id: String,
    reference: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<TaskCreated, String> {
    blocking(app, move |r, home| {
        task_worktree::restore(
            r,
            &repo_root,
            &task_id,
            reference.as_deref(),
            &WorkspaceEnv::from_option(workspace),
            home,
        )
    })
    .await
}

#[tauri::command]
pub async fn task_worktree_disk_usage(
    repo_root: String,
    task_id: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<DiskUsage, String> {
    blocking(app, move |r, home| {
        task_worktree::disk_usage(
            r,
            &repo_root,
            &task_id,
            &WorkspaceEnv::from_option(workspace),
            home,
        )
    })
    .await
}
