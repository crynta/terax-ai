import { describe, expect, it } from "vitest";
import {
  checkpointRef,
  freezeScope,
  isLiveScope,
  sameScope,
  scopeKey,
  scopeLabel,
  sinceCheckpointScope,
  supportsHunkActions,
  taskScope,
  turnScope,
} from "./scope";
import type { GitDiffScope } from "./types";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("scopeLabel", () => {
  it("names the working-tree scopes", () => {
    expect(scopeLabel({ kind: "uncommitted" })).toBe("Uncommitted changes");
    expect(scopeLabel({ kind: "staged" })).toBe("Staged changes");
    expect(scopeLabel({ kind: "unstaged" })).toBe("Unstaged changes");
  });

  it("shortens full shas but leaves branch names alone", () => {
    expect(scopeLabel({ kind: "commit", sha: SHA })).toBe("Commit 0123456");
    expect(scopeLabel(taskScope("main", "feature/x"))).toBe("feature/x vs main");
    expect(scopeLabel(taskScope(SHA))).toBe("HEAD vs 0123456");
  });

  it("describes checkpoint scopes in turns", () => {
    const ref = checkpointRef("task-1", 4);
    expect(scopeLabel(sinceCheckpointScope(ref))).toBe("Since turn 4");
    expect(scopeLabel(turnScope(checkpointRef("task-1", 3), ref))).toBe(
      "turn 3 to turn 4",
    );
    expect(
      scopeLabel({
        kind: "checkpoint",
        from: { kind: "worktree" },
        to: { kind: "ref", name: ref },
      }),
    ).toBe("working tree to turn 4");
    expect(scopeLabel(sinceCheckpointScope("some-other-ref"))).toBe(
      "Since some-other-ref",
    );
  });
});

describe("scopeKey / sameScope", () => {
  const scopes: GitDiffScope[] = [
    { kind: "uncommitted" },
    { kind: "staged" },
    { kind: "unstaged" },
    { kind: "range", base: "main", head: "HEAD" },
    { kind: "range", base: "main", head: "feature" },
    { kind: "commit", sha: SHA },
    sinceCheckpointScope(checkpointRef("t", 1)),
    turnScope(checkpointRef("t", 1), checkpointRef("t", 2)),
  ];

  it("gives every distinct scope a distinct key", () => {
    const keys = scopes.map(scopeKey);
    expect(new Set(keys).size).toBe(scopes.length);
  });

  it("treats equal scopes as the same regardless of object identity", () => {
    expect(sameScope(taskScope("main"), taskScope("main"))).toBe(true);
    expect(sameScope(taskScope("main"), taskScope("develop"))).toBe(false);
    expect(
      sameScope(
        sinceCheckpointScope(checkpointRef("t", 1)),
        sinceCheckpointScope(checkpointRef("t", 1)),
      ),
    ).toBe(true);
  });

  it("does not confuse a worktree endpoint with a ref named like one", () => {
    const live: GitDiffScope = {
      kind: "checkpoint",
      from: { kind: "ref", name: "a" },
      to: { kind: "worktree" },
    };
    const named: GitDiffScope = {
      kind: "checkpoint",
      from: { kind: "ref", name: "a" },
      to: { kind: "ref", name: "worktree" },
    };
    expect(sameScope(live, named)).toBe(false);
  });
});

describe("freezeScope", () => {
  const ref = checkpointRef("t", 2);

  it("pins the worktree end to the snapshot the summary returned", () => {
    const live = sinceCheckpointScope(ref);
    const frozen = freezeScope(live, {
      from: { kind: "rev", id: "c0ffee" },
      to: { kind: "worktree", tree: "abc123" },
    });
    expect(frozen).toEqual({
      kind: "checkpoint",
      from: { kind: "ref", name: ref },
      to: { kind: "worktree", tree: "abc123" },
    });
    expect(live.kind === "checkpoint" && live.to).toEqual({ kind: "worktree" });
  });

  it("pins either end and keeps refs and unpinned sides as they are", () => {
    const frozen = freezeScope(
      {
        kind: "checkpoint",
        from: { kind: "worktree" },
        to: { kind: "ref", name: ref },
      },
      {
        from: { kind: "worktree", tree: "t1" },
        to: { kind: "rev", id: "x" },
      },
    );
    expect(frozen).toEqual({
      kind: "checkpoint",
      from: { kind: "worktree", tree: "t1" },
      to: { kind: "ref", name: ref },
    });
    const unpinned = freezeScope(sinceCheckpointScope(ref), {
      from: { kind: "rev", id: "x" },
      to: { kind: "worktree" },
    });
    expect(unpinned).toEqual(sinceCheckpointScope(ref));
  });

  it("leaves every other scope alone and does not change its identity", () => {
    const summary = {
      from: { kind: "index" as const },
      to: { kind: "worktree" as const },
    };
    expect(freezeScope({ kind: "unstaged" }, summary)).toEqual({
      kind: "unstaged",
    });
    const live = sinceCheckpointScope(ref);
    const frozen = freezeScope(live, {
      from: { kind: "rev", id: "x" },
      to: { kind: "worktree", tree: "abc" },
    });
    expect(sameScope(live, frozen)).toBe(true);
  });
});

describe("isLiveScope", () => {
  it("is true for scopes that read the working tree or index", () => {
    expect(isLiveScope({ kind: "uncommitted" })).toBe(true);
    expect(isLiveScope({ kind: "staged" })).toBe(true);
    expect(isLiveScope({ kind: "unstaged" })).toBe(true);
    expect(isLiveScope(sinceCheckpointScope(checkpointRef("t", 1)))).toBe(true);
  });

  it("is false for fixed history", () => {
    expect(isLiveScope(taskScope("main"))).toBe(false);
    expect(isLiveScope({ kind: "commit", sha: SHA })).toBe(false);
    expect(
      isLiveScope(turnScope(checkpointRef("t", 1), checkpointRef("t", 2))),
    ).toBe(false);
  });
});

describe("supportsHunkActions", () => {
  it("matches the backend's scope and action table", () => {
    expect(supportsHunkActions({ kind: "unstaged" })).toEqual({
      stage: true,
      unstage: false,
      revert: true,
    });
    expect(supportsHunkActions({ kind: "staged" })).toEqual({
      stage: false,
      unstage: true,
      revert: false,
    });
    expect(supportsHunkActions({ kind: "uncommitted" })).toEqual({
      stage: false,
      unstage: false,
      revert: true,
    });
    expect(supportsHunkActions(taskScope("main"))).toEqual({
      stage: false,
      unstage: false,
      revert: false,
    });
  });
});

describe("checkpointRef", () => {
  it("builds the ref the backend uses", () => {
    expect(checkpointRef("task-1", 12)).toBe("refs/terax/checkpoints/task-1/12");
  });
});
