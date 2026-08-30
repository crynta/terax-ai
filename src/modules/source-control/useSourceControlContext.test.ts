import { describe, expect, it, vi } from "vitest";
import type { SourceControlSummary } from "./useSourceControl";
import { maskSourceControlSummaryForContext } from "./useSourceControlContext";

function loadedSummary(): SourceControlSummary {
  return {
    contextPath: "/root-a",
    repo: {
      repoRoot: "/root-a",
      branch: "main",
      upstream: "origin/main",
      isDetached: false,
    },
    status: {
      repoRoot: "/root-a",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [
        {
          path: "changed.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          statusLabel: "Modified",
        },
      ],
    },
    changedCount: 1,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    hasRepo: true,
    isLoading: false,
    localError: null,
    busyAction: "fetch",
    lastRemoteError: "old error",
    applyStatus: vi.fn(),
    refresh: vi.fn(),
    runRemoteAction: vi.fn(),
  };
}

describe("maskSourceControlSummaryForContext", () => {
  it("masks root A data immediately when Source Control moves to root B", async () => {
    const summary = loadedSummary();
    const masked = maskSourceControlSummaryForContext(summary, "/root-b");

    expect(masked).toMatchObject({
      contextPath: "/root-b",
      repo: null,
      status: null,
      changedCount: 0,
      upstream: null,
      ahead: 0,
      behind: 0,
      hasRepo: false,
      isLoading: true,
      busyAction: null,
      lastRemoteError: null,
    });
    expect(masked.applyStatus).not.toBe(summary.applyStatus);
    masked.applyStatus((status) => status);
    expect(summary.applyStatus).not.toHaveBeenCalled();
    expect(await masked.runRemoteAction()).toEqual({
      ok: false,
      action: null,
      blocked: "no-repo",
    });
  });

  it("masks root A data immediately when the new root is unavailable", () => {
    const masked = maskSourceControlSummaryForContext(loadedSummary(), null);

    expect(masked).toMatchObject({
      contextPath: null,
      repo: null,
      status: null,
      changedCount: 0,
      hasRepo: false,
      isLoading: false,
      busyAction: null,
    });
  });
});
