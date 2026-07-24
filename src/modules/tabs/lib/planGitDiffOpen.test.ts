import { describe, expect, it } from "vitest";
import {
  type GitDiffOpenInput,
  type GitDiffTab,
  planGitDiffOpen,
  type Tab,
} from "./useTabs";

function terminal(id: number, spaceId = "default"): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  };
}

function gitDiff(
  id: number,
  path: string,
  preview: boolean,
  spaceId = "default",
): GitDiffTab {
  return {
    id,
    kind: "git-diff",
    spaceId,
    title: `${path} (-)`,
    path,
    repoRoot: "/repo",
    mode: "-",
    originalPath: null,
    preview,
  };
}

const input = (path: string): GitDiffOpenInput => ({
  path,
  repoRoot: "/repo",
  mode: "-",
});

describe("planGitDiffOpen", () => {
  it("replaces the transient diff slot", () => {
    const tabs = [terminal(1), gitDiff(2, "old.ts", true)];
    const result = planGitDiffOpen(
      tabs,
      input("new.ts"),
      "default",
      false,
      () => 3,
    );

    expect(result.targetId).toBe(3);
    expect(result.tabs).toEqual([
      tabs[0],
      expect.objectContaining({
        id: 3,
        kind: "git-diff",
        path: "new.ts",
        preview: true,
      }),
    ]);
  });

  it("keeps pinned diffs and appends a transient slot", () => {
    const pinned = gitDiff(2, "kept.ts", false);
    const result = planGitDiffOpen(
      [terminal(1), pinned],
      input("new.ts"),
      "default",
      false,
      () => 3,
    );

    expect(result.tabs).toEqual([
      expect.anything(),
      pinned,
      expect.objectContaining({ id: 3, path: "new.ts", preview: true }),
    ]);
  });

  it("activates an existing pinned diff without allocating another tab", () => {
    const pinned = gitDiff(2, "same.ts", false);
    let allocations = 0;
    const result = planGitDiffOpen(
      [terminal(1), pinned, gitDiff(3, "other.ts", true)],
      { ...input("same.ts"), originalPath: "before.ts" },
      "default",
      false,
      () => {
        allocations += 1;
        return 4;
      },
    );

    expect(result.targetId).toBe(2);
    expect(result.tabs).toHaveLength(3);
    expect(result.tabs[1]).toMatchObject({
      id: 2,
      originalPath: "before.ts",
      preview: false,
    });
    expect(allocations).toBe(0);
  });

  it("promotes a transient diff in place when pinned", () => {
    const preview = gitDiff(2, "same.ts", true);
    const result = planGitDiffOpen(
      [terminal(1), preview],
      input("same.ts"),
      "default",
      true,
      () => 3,
    );

    expect(result.targetId).toBe(2);
    expect(result.tabs[1]).toMatchObject({ id: 2, preview: false });
  });

  it("does not replace a preview slot in another space", () => {
    const otherSpacePreview = gitDiff(2, "other.ts", true, "other");
    const result = planGitDiffOpen(
      [terminal(1), otherSpacePreview],
      input("new.ts"),
      "default",
      false,
      () => 3,
    );

    expect(result.tabs).toHaveLength(3);
    expect(result.tabs[1]).toBe(otherSpacePreview);
    expect(result.tabs[2]).toMatchObject({
      id: 3,
      spaceId: "default",
      path: "new.ts",
    });
  });
});
