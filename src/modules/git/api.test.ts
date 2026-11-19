import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

import { git } from "./api";
import { sinceCheckpointScope } from "./scope";

const workspace = { kind: "local" };

describe("git api argument shapes", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("keeps the legacy push call and adds the set-upstream option", async () => {
    await git.push("/r");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_push", {
      repoRoot: "/r",
      setUpstream: null,
      workspace,
    });
    await git.push("/r", { setUpstream: true });
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_push", {
      repoRoot: "/r",
      setUpstream: true,
      workspace,
    });
  });

  it("sends the scope as a tagged object", async () => {
    const scope = sinceCheckpointScope("refs/terax/checkpoints/t/1");
    await git.diffSummary("/r", scope);
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_diff_summary", {
      repoRoot: "/r",
      scope,
      workspace,
    });
  });

  it("defaults diffFile to including contents and no old path", async () => {
    await git.diffFile("/r", { kind: "unstaged" }, "a.txt");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_diff_file", {
      repoRoot: "/r",
      scope: { kind: "unstaged" },
      path: "a.txt",
      oldPath: null,
      includeContents: true,
      workspace,
    });
    await git.diffFile("/r", { kind: "staged" }, "b.txt", {
      oldPath: "a.txt",
      includeContents: false,
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_diff_file", {
      repoRoot: "/r",
      scope: { kind: "staged" },
      path: "b.txt",
      oldPath: "a.txt",
      includeContents: false,
      workspace,
    });
  });

  it("normalizes optional fields of an apply request", async () => {
    await git.applyHunks("/r", {
      scope: { kind: "unstaged" },
      path: "a.txt",
      mode: "stage",
      selection: { kind: "hunks", items: [{ id: "h1", lines: [2] }] },
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_apply_hunks", {
      repoRoot: "/r",
      request: {
        scope: { kind: "unstaged" },
        path: "a.txt",
        oldPath: null,
        mode: "stage",
        selection: { kind: "hunks", items: [{ id: "h1", lines: [2] }] },
      },
      workspace,
    });
  });

  it("fills worktree defaults and keeps removal non-forced unless asked", async () => {
    await git.worktreeAdd("/r", {
      branch: { mode: "newBranch", name: "task/x" },
      taskSlug: "x",
      include: [".env"],
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_worktree_add", {
      repoRoot: "/r",
      request: {
        branch: { mode: "newBranch", name: "task/x" },
        path: null,
        taskSlug: "x",
        base: null,
        include: [".env"],
      },
      workspace,
    });
    await git.worktreeRemove("/r", "/wt");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_worktree_remove", {
      repoRoot: "/r",
      path: "/wt",
      force: false,
      workspace,
    });
    await git.worktreeRemove("/r", "/wt", true);
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_worktree_remove", {
      repoRoot: "/r",
      path: "/wt",
      force: true,
      workspace,
    });
  });

  it("maps task commands and defaults archive to non-forced", async () => {
    await git.projectConfig("/r");
    expect(mocks.invoke).toHaveBeenLastCalledWith("task_project_config", {
      repoRoot: "/r",
      workspace,
    });
    await git.taskCreate("/r", { name: "fix" });
    expect(mocks.invoke).toHaveBeenLastCalledWith("task_worktree_create", {
      repoRoot: "/r",
      request: { name: "fix", base: null },
      workspace,
    });
    await git.taskPrepareArchive("/r", "id");
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "task_worktree_prepare_archive",
      { repoRoot: "/r", taskId: "id", workspace },
    );
    await git.taskArchive("/r", "id");
    expect(mocks.invoke).toHaveBeenLastCalledWith("task_worktree_archive", {
      repoRoot: "/r",
      taskId: "id",
      force: false,
      workspace,
    });
    await git.taskRestore("/r", "id");
    expect(mocks.invoke).toHaveBeenLastCalledWith("task_worktree_restore", {
      repoRoot: "/r",
      taskId: "id",
      reference: null,
      workspace,
    });
    await git.taskDiskUsage("/r", "id");
    expect(mocks.invoke).toHaveBeenLastCalledWith("task_worktree_disk_usage", {
      repoRoot: "/r",
      taskId: "id",
      workspace,
    });
  });

  it("maps checkpoint calls onto the backend argument names", async () => {
    await git.checkpointCreate("/wt", "task-1", 3);
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_checkpoint_create", {
      worktree: "/wt",
      taskId: "task-1",
      turn: 3,
      workspace,
    });
    await git.checkpointRestore("/wt", "refs/terax/checkpoints/task-1/2");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_checkpoint_restore", {
      worktree: "/wt",
      reference: "refs/terax/checkpoints/task-1/2",
      force: false,
      workspace,
    });
  });

  it("releases a watch by the key watch returned and sends nothing else", async () => {
    await git.unwatch("/repo");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_unwatch", {
      repo: "/repo",
    });
  });

  it("maps branch calls", async () => {
    await git.branchCreate("/r", "feature/x");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_branch_create", {
      repoRoot: "/r",
      name: "feature/x",
      base: null,
      workspace,
    });
    await git.branchRename("/r", "a", "b");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_branch_rename", {
      repoRoot: "/r",
      oldName: "a",
      newName: "b",
      workspace,
    });
  });
});
