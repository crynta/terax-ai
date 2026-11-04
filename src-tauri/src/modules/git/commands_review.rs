//! Tauri commands for the review view, tasks and worktrees. Thin on purpose:
//! decode, hop to the blocking pool, call the operation, encode.

use tauri::{AppHandle, Manager};

use crate::modules::git::branch::{self, BranchCreated, UpstreamInfo};
use crate::modules::git::checkpoint::{self, CheckpointCreated, CheckpointInfo, RestoreReport};
use crate::modules::git::review::{
    self, ApplyHunksRequest, ApplyOutcome, GitDiffScope, GitDiffSummary, GitFileDiff,
};
use crate::modules::git::watch::{GitWatchInfo, GitWatchState};
use crate::modules::git::worktree::{
    self, PruneReport, WorktreeAddRequest, WorktreeAdded, WorktreeEntry, WorktreeRemoveReport,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

async fn blocking<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&WorkspaceRegistry) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        f(&registry)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_merge_base(
    repo_root: String,
    a: String,
    b: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        review::merge_base(r, &repo_root, &a, &b, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_diff_summary(
    repo_root: String,
    scope: GitDiffScope,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitDiffSummary, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        review::diff_summary(r, &repo_root, &scope, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_diff_file(
    repo_root: String,
    scope: GitDiffScope,
    path: String,
    old_path: Option<String>,
    include_contents: Option<bool>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitFileDiff, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        review::diff_file(
            r,
            &repo_root,
            &scope,
            &path,
            old_path.as_deref(),
            include_contents.unwrap_or(true),
            &workspace,
        )
        .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_apply_hunks(
    repo_root: String,
    request: ApplyHunksRequest,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<ApplyOutcome, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        review::apply_hunks(r, &repo_root, &request, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_list(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<WorktreeEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        worktree::list(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_add(
    repo_root: String,
    request: WorktreeAddRequest,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<WorktreeAdded, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let base = dirs::home_dir()
        .map(|home| home.join(".terax").join("worktrees"))
        .ok_or_else(|| "could not resolve the home directory".to_string())?;
    blocking(app, move |r| {
        worktree::add(r, &repo_root, &request, &base, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_remove(
    repo_root: String,
    path: String,
    force: Option<bool>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<WorktreeRemoveReport, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        worktree::remove(r, &repo_root, &path, force.unwrap_or(false), &workspace)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_prune(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<PruneReport, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        worktree::prune(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkpoint_create(
    worktree: String,
    task_id: String,
    turn: u32,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<CheckpointCreated, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        checkpoint::create(r, &worktree, &task_id, turn, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkpoint_list(
    worktree: String,
    task_id: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<Vec<CheckpointInfo>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        checkpoint::list(r, &worktree, &task_id, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkpoint_restore(
    worktree: String,
    reference: String,
    force: Option<bool>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<RestoreReport, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        checkpoint::restore(r, &worktree, &reference, force.unwrap_or(false), &workspace)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_checkpoint_prune(
    worktree: String,
    task_id: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        checkpoint::prune(r, &worktree, &task_id, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_branch_create(
    repo_root: String,
    name: String,
    base: Option<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<BranchCreated, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        branch::create(r, &repo_root, &name, base.as_deref(), &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_branch_rename(
    repo_root: String,
    old_name: String,
    new_name: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        branch::rename(r, &repo_root, &old_name, &new_name, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_upstream_info(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<UpstreamInfo, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        branch::upstream_info(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_watch(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitWatchInfo, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let handle = app.clone();
    blocking(app, move |r| {
        handle
            .state::<GitWatchState>()
            .subscribe(&handle, r, &repo_root, &workspace)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_unwatch(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let handle = app.clone();
    blocking(app, move |r| {
        handle
            .state::<GitWatchState>()
            .unsubscribe(&handle, r, &repo_root, &workspace)
            .map_err(Into::into)
    })
    .await
}
