import { beforeEach, describe, expect, it, vi } from "vitest";

const gitMock = vi.hoisted(() => ({
  diffContent: vi.fn(),
  commitFileDiff: vi.fn(),
}));

vi.mock("@/modules/git", () => ({ git: gitMock }));

const workspaceMock = vi.hoisted(() => ({
  currentWorkspaceScopeKey: vi.fn(() => "scope"),
}));

vi.mock("@/modules/workspace", () => workspaceMock);

import type { GitDiffContentResult } from "@/modules/git";

function result(modifiedContent: string): GitDiffContentResult {
  return {
    originalContent: "",
    modifiedContent,
    isBinary: false,
    fallbackPatch: "",
    truncated: false,
  };
}

async function loadModule() {
  return await import("./diffCache");
}

describe("git diff content cache", () => {
  beforeEach(() => {
    vi.resetModules();
    gitMock.diffContent.mockReset();
    gitMock.commitFileDiff.mockReset();
    workspaceMock.currentWorkspaceScopeKey.mockClear();
    workspaceMock.currentWorkspaceScopeKey.mockReturnValue("scope");
  });

  it("scopes diff keys by workspace, repo, and kind", async () => {
    const { workingDiffKey, commitDiffKey } = await loadModule();

    expect(workingDiffKey("/repo", "src/a.ts", "-")).toBe(
      "scope|/repo|w|-|src/a.ts",
    );
    expect(commitDiffKey("/repo", "abc123", "src/a.ts")).toBe(
      "scope|/repo|c|abc123|src/a.ts",
    );
  });

  it("serves repeated reads of the same file from cache", async () => {
    const { fetchWorkingDiff } = await loadModule();
    gitMock.diffContent.mockResolvedValue(result("- line"));

    await fetchWorkingDiff("/repo", "a.ts", "-", null);
    const second = await fetchWorkingDiff("/repo", "a.ts", "-", null);

    expect(second.modifiedContent).toBe("- line");
    expect(gitMock.diffContent).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent reads of the same diff into one backend call", async () => {
    const { fetchWorkingDiff } = await loadModule();
    let release: ((v: GitDiffContentResult) => void) | undefined;
    gitMock.diffContent.mockReturnValue(
      new Promise<GitDiffContentResult>((r) => {
        release = r;
      }),
    );

    const first = fetchWorkingDiff("/repo", "a.ts", "-", null);
    const second = fetchWorkingDiff("/repo", "a.ts", "-", null);
    release?.(result("shared"));

    expect(await first).toBe(await second);
    expect(gitMock.diffContent).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used entry past six", async () => {
    const mod = await loadModule();
    gitMock.diffContent.mockImplementation((_root, path: string) =>
      Promise.resolve(result(`body ${path}`)),
    );

    for (let i = 0; i < 6; i++) {
      await mod.fetchWorkingDiff("/repo", `f${i}.ts`, "-", null);
    }
    await mod.fetchWorkingDiff("/repo", "new.ts", "-", null);

    expect(mod.getCachedDiff(mod.workingDiffKey("/repo", "f0.ts", "-"))).toBeUndefined();
    expect(mod.getCachedDiff(mod.workingDiffKey("/repo", "f1.ts", "-"))).toBeDefined();
  });

  it("keeps an entry that was just read when the limit overflows", async () => {
    const { fetchWorkingDiff, getCachedDiff, workingDiffKey } =
      await loadModule();
    gitMock.diffContent.mockImplementation((_root, path: string) =>
      Promise.resolve(result(`body ${path}`)),
    );

    for (let i = 0; i < 6; i++) {
      await fetchWorkingDiff("/repo", `f${i}.ts`, "-", null);
    }
    getCachedDiff(workingDiffKey("/repo", "f0.ts", "-"));
    await fetchWorkingDiff("/repo", "new.ts", "-", null);

    expect(getCachedDiff(workingDiffKey("/repo", "f0.ts", "-"))).toBeDefined();
    expect(getCachedDiff(workingDiffKey("/repo", "f1.ts", "-"))).toBeUndefined();
  });

  it("does not retry or cache a failed backend call", async () => {
    const { fetchWorkingDiff } = await loadModule();
    gitMock.diffContent
      .mockRejectedValueOnce(new Error("git failed"))
      .mockResolvedValueOnce(result("recovered"));

    await expect(fetchWorkingDiff("/repo", "a.ts", "-", null)).rejects.toThrow(
      "git failed",
    );
    await expect(fetchWorkingDiff("/repo", "a.ts", "-", null)).resolves.toEqual(
      result("recovered"),
    );
    expect(gitMock.diffContent).toHaveBeenCalledTimes(2);
  });

  it("invalidates only the current workspace scope for a repo root", async () => {
    const mod = await loadModule();
    const { fetchWorkingDiff, getCachedDiff, workingDiffKey } = mod;
    gitMock.diffContent.mockImplementation((_root, path: string) =>
      Promise.resolve(result(`body ${path}`)),
    );

    await fetchWorkingDiff("/repo-a", "x.ts", "-", null);

    workspaceMock.currentWorkspaceScopeKey.mockReturnValue("other");
    await fetchWorkingDiff("/repo-a", "x.ts", "-", null);
    workspaceMock.currentWorkspaceScopeKey.mockReturnValue("scope");

    const { invalidateRepoDiffs } = mod;
    invalidateRepoDiffs("/repo-a");

    expect(getCachedDiff(workingDiffKey("/repo-a", "x.ts", "-"))).toBeUndefined();

    workspaceMock.currentWorkspaceScopeKey.mockReturnValue("other");
    expect(getCachedDiff(workingDiffKey("/repo-a", "x.ts", "-"))).toBeDefined();
  });

  it("keeps working-tree and commit diffs under separate namespaces", async () => {
    const { fetchWorkingDiff, fetchCommitDiff } = await loadModule();
    gitMock.diffContent.mockResolvedValue(result("work"));
    gitMock.commitFileDiff.mockResolvedValue(result("commit"));

    await fetchWorkingDiff("/repo", "a.ts", "+", null);
    await fetchCommitDiff("/repo", "sha1", "a.ts", null);

    expect(gitMock.diffContent).toHaveBeenCalledTimes(1);
    expect(gitMock.commitFileDiff).toHaveBeenCalledWith(
      "/repo",
      "sha1",
      "a.ts",
      null,
    );
  });
});
