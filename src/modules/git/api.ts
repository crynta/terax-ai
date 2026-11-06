import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import type {
  ApplyHunksRequest,
  ApplyOutcome,
  BranchCreated,
  CheckpointCreated,
  CheckpointInfo,
  GitBranchListResult,
  GitCommitFileChange,
  GitCommitResult,
  GitDiffContentResult,
  GitDiffResult,
  GitDiffScope,
  GitDiffSummary,
  GitDiscardEntry,
  GitFileDiff,
  GitLogEntry,
  GitPanelSnapshot,
  GitPushResult,
  GitRepoInfo,
  GitStatusSnapshot,
  GitWatchInfo,
  ProjectConfig,
  RestoreReport,
  TaskArchive,
  TaskCreated,
  TaskCreateRequest,
  TaskDiskUsage,
  TaskWorktree,
  UpstreamInfo,
  WorktreeAdded,
  WorktreeAddRequest,
  WorktreeEntry,
  WorktreePruneReport,
  WorktreeRemoveReport,
} from "./types";

export const git = {
  resolveRepo: (cwd: string) =>
    invoke<GitRepoInfo | null>("git_resolve_repo", {
      cwd,
      workspace: currentWorkspaceEnv(),
    }),
  panelSnapshot: (cwd: string) =>
    invoke<GitPanelSnapshot>("git_panel_snapshot", {
      cwd,
      workspace: currentWorkspaceEnv(),
    }),
  status: (repoRoot: string) =>
    invoke<GitStatusSnapshot>("git_status", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  diff: (repoRoot: string, path: string | null, staged: boolean) =>
    invoke<GitDiffResult>("git_diff", {
      repoRoot,
      path,
      staged,
      workspace: currentWorkspaceEnv(),
    }),
  diffContent: (
    repoRoot: string,
    path: string,
    staged: boolean,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_diff_content", {
      repoRoot,
      path,
      staged,
      originalPath: originalPath ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  stage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_stage", {
      repoRoot,
      paths,
      workspace: currentWorkspaceEnv(),
    }),
  unstage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_unstage", {
      repoRoot,
      paths,
      workspace: currentWorkspaceEnv(),
    }),
  discard: (repoRoot: string, entries: GitDiscardEntry[]) =>
    invoke<void>("git_discard", {
      repoRoot,
      entries,
      workspace: currentWorkspaceEnv(),
    }),
  commit: (repoRoot: string, message: string) =>
    invoke<GitCommitResult>("git_commit", {
      repoRoot,
      message,
      workspace: currentWorkspaceEnv(),
    }),
  fetch: (repoRoot: string) =>
    invoke<void>("git_fetch", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  pullFfOnly: (repoRoot: string) =>
    invoke<void>("git_pull_ff_only", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  push: (repoRoot: string, options?: { setUpstream?: boolean }) =>
    invoke<GitPushResult>("git_push", {
      repoRoot,
      setUpstream: options?.setUpstream ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  log: (repoRoot: string, options?: { limit?: number; beforeSha?: string }) =>
    invoke<GitLogEntry[]>("git_log", {
      repoRoot,
      limit: options?.limit ?? null,
      beforeSha: options?.beforeSha ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  showCommit: (repoRoot: string, sha: string) =>
    invoke<GitDiffResult>("git_show_commit", {
      repoRoot,
      sha,
      workspace: currentWorkspaceEnv(),
    }),
  commitFiles: (repoRoot: string, sha: string) =>
    invoke<GitCommitFileChange[]>("git_commit_files", {
      repoRoot,
      sha,
      workspace: currentWorkspaceEnv(),
    }),
  commitFileDiff: (
    repoRoot: string,
    sha: string,
    path: string,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_commit_file_diff", {
      repoRoot,
      sha,
      path,
      originalPath: originalPath ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  remoteUrl: (repoRoot: string, name?: string) =>
    invoke<string | null>("git_remote_url", {
      repoRoot,
      name: name ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  listBranches: (repoRoot: string) =>
    invoke<GitBranchListResult>("git_list_branches", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  checkoutBranch: (repoRoot: string, branch: string) =>
    invoke<void>("git_checkout_branch", {
      repoRoot,
      branch,
      workspace: currentWorkspaceEnv(),
    }),

  // ---- review: scopes, structured diffs, hunk operations
  /** Common ancestor of two revisions, or `null` when they share no history. */
  mergeBase: (repoRoot: string, a: string, b: string) =>
    invoke<string | null>("git_merge_base", {
      repoRoot,
      a,
      b,
      workspace: currentWorkspaceEnv(),
    }),
  diffSummary: (repoRoot: string, scope: GitDiffScope) =>
    invoke<GitDiffSummary>("git_diff_summary", {
      repoRoot,
      scope,
      workspace: currentWorkspaceEnv(),
    }),
  diffFile: (
    repoRoot: string,
    scope: GitDiffScope,
    path: string,
    options?: { oldPath?: string | null; includeContents?: boolean },
  ) =>
    invoke<GitFileDiff>("git_diff_file", {
      repoRoot,
      scope,
      path,
      oldPath: options?.oldPath ?? null,
      includeContents: options?.includeContents ?? true,
      workspace: currentWorkspaceEnv(),
    }),
  applyHunks: (repoRoot: string, request: ApplyHunksRequest) =>
    invoke<ApplyOutcome>("git_apply_hunks", {
      repoRoot,
      request: { ...request, oldPath: request.oldPath ?? null },
      workspace: currentWorkspaceEnv(),
    }),

  projectConfig: (repoRoot: string) =>
    invoke<ProjectConfig>("task_project_config", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  taskList: (repoRoot: string) =>
    invoke<TaskWorktree[]>("task_worktree_list", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  taskCreate: (repoRoot: string, request: TaskCreateRequest) =>
    invoke<TaskCreated>("task_worktree_create", {
      repoRoot,
      request: { ...request, base: request.base ?? null },
      workspace: currentWorkspaceEnv(),
    }),
  /** Snapshot and inspect first; run archiveScript in the task terminal before taskArchive. */
  taskPrepareArchive: (repoRoot: string, taskId: string) =>
    invoke<TaskArchive>("task_worktree_prepare_archive", {
      repoRoot,
      taskId,
      workspace: currentWorkspaceEnv(),
    }),
  /** Rechecks and snapshots again before removal; force requires the caller's confirmation. */
  taskArchive: (repoRoot: string, taskId: string, force = false) =>
    invoke<TaskArchive>("task_worktree_archive", {
      repoRoot,
      taskId,
      force,
      workspace: currentWorkspaceEnv(),
    }),
  taskRestore: (
    repoRoot: string,
    taskId: string,
    reference: string | null = null,
  ) =>
    invoke<TaskCreated>("task_worktree_restore", {
      repoRoot,
      taskId,
      reference,
      workspace: currentWorkspaceEnv(),
    }),
  taskDiskUsage: (repoRoot: string, taskId: string) =>
    invoke<TaskDiskUsage>("task_worktree_disk_usage", {
      repoRoot,
      taskId,
      workspace: currentWorkspaceEnv(),
    }),

  // ---- worktrees
  worktreeList: (repoRoot: string) =>
    invoke<WorktreeEntry[]>("git_worktree_list", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  worktreeAdd: (repoRoot: string, request: WorktreeAddRequest) =>
    invoke<WorktreeAdded>("git_worktree_add", {
      repoRoot,
      request: {
        ...request,
        path: request.path ?? null,
        taskSlug: request.taskSlug ?? null,
        base: request.base ?? null,
        include: request.include ?? [],
      },
      workspace: currentWorkspaceEnv(),
    }),
  /** Without `force`, dirty / unmerged / locked worktrees are reported, not removed. */
  worktreeRemove: (repoRoot: string, path: string, force = false) =>
    invoke<WorktreeRemoveReport>("git_worktree_remove", {
      repoRoot,
      path,
      force,
      workspace: currentWorkspaceEnv(),
    }),
  worktreePrune: (repoRoot: string) =>
    invoke<WorktreePruneReport>("git_worktree_prune", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),

  // ---- checkpoints (refs/terax/checkpoints/<task>/<turn>)
  checkpointCreate: (worktree: string, taskId: string, turn: number) =>
    invoke<CheckpointCreated>("git_checkpoint_create", {
      worktree,
      taskId,
      turn,
      workspace: currentWorkspaceEnv(),
    }),
  checkpointList: (worktree: string, taskId: string) =>
    invoke<CheckpointInfo[]>("git_checkpoint_list", {
      worktree,
      taskId,
      workspace: currentWorkspaceEnv(),
    }),
  /** Refuses with a report when files changed since the latest checkpoint, unless `force`. */
  checkpointRestore: (worktree: string, ref: string, force = false) =>
    invoke<RestoreReport>("git_checkpoint_restore", {
      worktree,
      reference: ref,
      force,
      workspace: currentWorkspaceEnv(),
    }),
  checkpointPrune: (worktree: string, taskId: string) =>
    invoke<number>("git_checkpoint_prune", {
      worktree,
      taskId,
      workspace: currentWorkspaceEnv(),
    }),

  // ---- branches and upstream
  branchCreate: (repoRoot: string, name: string, base?: string | null) =>
    invoke<BranchCreated>("git_branch_create", {
      repoRoot,
      name,
      base: base ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  branchRename: (repoRoot: string, oldName: string, newName: string) =>
    invoke<void>("git_branch_rename", {
      repoRoot,
      oldName,
      newName,
      workspace: currentWorkspaceEnv(),
    }),
  upstreamInfo: (repoRoot: string) =>
    invoke<UpstreamInfo>("git_upstream_info", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),

  // ---- change notifications (see ./changes.ts for the subscription helper)
  watch: (repoRoot: string) =>
    invoke<GitWatchInfo>("git_watch", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  /** `repo` is the key `watch` returned; it resolves nothing, so it also works once the worktree is gone. */
  unwatch: (repo: string) => invoke<void>("git_unwatch", { repo }),
};
