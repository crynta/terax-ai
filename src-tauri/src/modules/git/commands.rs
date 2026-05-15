use crate::modules::git::operations;
use crate::modules::git::types::{
    GitCommitResult, GitDiffContentResult, GitDiffResult, GitPushResult, GitRepoInfo,
    GitStatusSnapshot,
};

#[tauri::command]
pub async fn git_resolve_repo(cwd: String) -> Result<Option<GitRepoInfo>, String> {
    operations::resolve_repo(&cwd)
}

#[tauri::command]
pub async fn git_status(repo_root: String) -> Result<GitStatusSnapshot, String> {
    operations::status(&repo_root)
}

#[tauri::command]
pub async fn git_diff(
    repo_root: String,
    path: Option<String>,
    staged: bool,
) -> Result<GitDiffResult, String> {
    operations::diff(&repo_root, path.as_deref(), staged)
}

#[tauri::command]
pub async fn git_diff_content(
    repo_root: String,
    path: String,
    staged: bool,
) -> Result<GitDiffContentResult, String> {
    operations::diff_content(&repo_root, &path, staged)
}

#[tauri::command]
pub async fn git_stage(repo_root: String, paths: Vec<String>) -> Result<(), String> {
    operations::stage(&repo_root, &paths)
}

#[tauri::command]
pub async fn git_unstage(repo_root: String, paths: Vec<String>) -> Result<(), String> {
    operations::unstage(&repo_root, &paths)
}

#[tauri::command]
pub async fn git_discard(repo_root: String, paths: Vec<String>) -> Result<(), String> {
    operations::discard(&repo_root, &paths)
}

#[tauri::command]
pub async fn git_commit(repo_root: String, message: String) -> Result<GitCommitResult, String> {
    operations::commit(&repo_root, &message)
}

#[tauri::command]
pub async fn git_push(repo_root: String) -> Result<GitPushResult, String> {
    operations::push(&repo_root)
}
