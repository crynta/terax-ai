import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffContentResult } from "@/modules/ai/lib/native";

// Controllable scope key so we can assert key composition and repo prefixing.
let scopeKey = "local";

const gitDiffContent = vi.fn();
const gitCommitFileDiff = vi.fn();

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceScopeKey: () => scopeKey,
}));

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitDiffContent: (...args: unknown[]) => gitDiffContent(...args),
    gitCommitFileDiff: (...args: unknown[]) => gitCommitFileDiff(...args),
  },
}));

function diff(tag: string): GitDiffContentResult {
  return {
    originalContent: `orig-${tag}`,
    modifiedContent: `mod-${tag}`,
    isBinary: false,
    fallbackPatch: "",
    truncated: false,
  };
}

// The module keeps a singleton cache, so reload it fresh for every test.
type DiffCacheModule = typeof import("./diffCache");
async function loadModule(): Promise<DiffCacheModule> {
  vi.resetModules();
  return import("./diffCache");
}

beforeEach(() => {
  scopeKey = "local";
  gitDiffContent.mockReset();
  gitCommitFileDiff.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("key builders", () => {
  it("encodes scope, repo, mode and path for working diffs", async () => {
    const { workingDiffKey } = await loadModule();
    expect(workingDiffKey("/repo", "src/a.ts", "+")).toBe(
      "local|/repo|w|+|src/a.ts",
    );
    expect(workingDiffKey("/repo", "src/a.ts", "-")).toBe(
      "local|/repo|w|-|src/a.ts",
    );
  });

  it("produces distinct keys for the two diff sides", async () => {
    const { workingDiffKey } = await loadModule();
    expect(workingDiffKey("/repo", "a", "+")).not.toBe(
      workingDiffKey("/repo", "a", "-"),
    );
  });

  it("encodes scope, repo, sha and path for commit diffs", async () => {
    const { commitDiffKey } = await loadModule();
    expect(commitDiffKey("/repo", "abc123", "src/a.ts")).toBe(
      "local|/repo|c|abc123|src/a.ts",
    );
  });

  it("namespaces keys by the active workspace scope", async () => {
    const { workingDiffKey } = await loadModule();
    scopeKey = "wsl:Ubuntu";
    expect(workingDiffKey("/repo", "a", "+")).toBe("wsl:Ubuntu|/repo|w|+|a");
  });
});

describe("getCachedDiff / fetchWorkingDiff", () => {
  it("returns undefined for an unknown key", async () => {
    const { getCachedDiff } = await loadModule();
    expect(getCachedDiff("missing")).toBeUndefined();
  });

  it("caches the native result so a second fetch hits memory", async () => {
    const mod = await loadModule();
    const value = diff("a");
    gitDiffContent.mockResolvedValue(value);

    const first = await mod.fetchWorkingDiff("/repo", "a.ts", "+", null);
    const second = await mod.fetchWorkingDiff("/repo", "a.ts", "+", null);

    expect(first).toBe(value);
    expect(second).toBe(value);
    expect(gitDiffContent).toHaveBeenCalledTimes(1);
    expect(mod.getCachedDiff(mod.workingDiffKey("/repo", "a.ts", "+"))).toBe(
      value,
    );
  });

  it("passes the staged flag and original path through to native", async () => {
    const mod = await loadModule();
    gitDiffContent.mockResolvedValue(diff("a"));

    await mod.fetchWorkingDiff("/repo", "new.ts", "+", "old.ts");
    expect(gitDiffContent).toHaveBeenCalledWith(
      "/repo",
      "new.ts",
      true,
      "old.ts",
    );

    gitDiffContent.mockResolvedValue(diff("b"));
    await mod.fetchWorkingDiff("/repo", "b.ts", "-", null);
    expect(gitDiffContent).toHaveBeenLastCalledWith(
      "/repo",
      "b.ts",
      false,
      null,
    );
  });

  it("deduplicates concurrent in-flight requests for the same key", async () => {
    const mod = await loadModule();
    let resolveFn: (v: GitDiffContentResult) => void = () => {};
    gitDiffContent.mockReturnValue(
      new Promise<GitDiffContentResult>((resolve) => {
        resolveFn = resolve;
      }),
    );

    const p1 = mod.fetchWorkingDiff("/repo", "a.ts", "+", null);
    const p2 = mod.fetchWorkingDiff("/repo", "a.ts", "+", null);
    resolveFn(diff("a"));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(gitDiffContent).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight entry after rejection so retries are possible", async () => {
    const mod = await loadModule();
    gitDiffContent.mockRejectedValueOnce(new Error("boom"));
    await expect(
      mod.fetchWorkingDiff("/repo", "a.ts", "+", null),
    ).rejects.toThrow("boom");

    const value = diff("retry");
    gitDiffContent.mockResolvedValueOnce(value);
    await expect(
      mod.fetchWorkingDiff("/repo", "a.ts", "+", null),
    ).resolves.toBe(value);
    expect(gitDiffContent).toHaveBeenCalledTimes(2);
  });
});

describe("fetchCommitDiff", () => {
  it("caches and forwards the original path to native", async () => {
    const mod = await loadModule();
    const value = diff("c");
    gitCommitFileDiff.mockResolvedValue(value);

    const first = await mod.fetchCommitDiff("/repo", "sha1", "a.ts", "old.ts");
    const second = await mod.fetchCommitDiff("/repo", "sha1", "a.ts", "old.ts");

    expect(first).toBe(value);
    expect(second).toBe(value);
    expect(gitCommitFileDiff).toHaveBeenCalledTimes(1);
    expect(gitCommitFileDiff).toHaveBeenCalledWith(
      "/repo",
      "sha1",
      "a.ts",
      "old.ts",
    );
  });
});

describe("invalidation", () => {
  it("removes a single cached entry", async () => {
    const mod = await loadModule();
    gitDiffContent.mockResolvedValue(diff("a"));
    await mod.fetchWorkingDiff("/repo", "a.ts", "+", null);
    const key = mod.workingDiffKey("/repo", "a.ts", "+");
    expect(mod.getCachedDiff(key)).toBeDefined();

    mod.invalidateDiff(key);
    expect(mod.getCachedDiff(key)).toBeUndefined();
  });

  it("invalidating a missing key is a no-op", async () => {
    const mod = await loadModule();
    expect(() => mod.invalidateDiff("nope")).not.toThrow();
  });

  it("drops only entries for the targeted repo within the scope", async () => {
    const mod = await loadModule();
    gitDiffContent.mockResolvedValue(diff("a"));
    await mod.fetchWorkingDiff("/repoA", "a.ts", "+", null);
    await mod.fetchWorkingDiff("/repoB", "b.ts", "+", null);

    mod.invalidateRepoDiffs("/repoA");

    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repoA", "a.ts", "+")),
    ).toBeUndefined();
    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repoB", "b.ts", "+")),
    ).toBeDefined();
  });

  it("does not drop another repo whose path is a prefix of the target", async () => {
    const mod = await loadModule();
    gitDiffContent.mockResolvedValue(diff("a"));
    await mod.fetchWorkingDiff("/repo", "a.ts", "+", null);
    await mod.fetchWorkingDiff("/repo-extra", "b.ts", "+", null);

    mod.invalidateRepoDiffs("/repo");

    // "/repo|" prefix must not match "/repo-extra|".
    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repo-extra", "b.ts", "+")),
    ).toBeDefined();
  });
});

describe("LRU eviction and recency", () => {
  it("evicts the oldest entry once the cache exceeds its limit of six", async () => {
    const mod = await loadModule();
    gitDiffContent.mockImplementation(async () => diff("x"));

    // Insert 7 distinct keys; the first should be evicted (limit is 6).
    for (let i = 0; i < 7; i++) {
      await mod.fetchWorkingDiff("/repo", `f${i}.ts`, "+", null);
    }

    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repo", "f0.ts", "+")),
    ).toBeUndefined();
    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repo", "f6.ts", "+")),
    ).toBeDefined();
  });

  it("treats a cache read as a use, protecting the entry from eviction", async () => {
    const mod = await loadModule();
    gitDiffContent.mockImplementation(async () => diff("x"));

    for (let i = 0; i < 6; i++) {
      await mod.fetchWorkingDiff("/repo", `f${i}.ts`, "+", null);
    }

    // Touch the oldest entry (f0) via a read so it becomes most-recent.
    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repo", "f0.ts", "+")),
    ).toBeDefined();

    // Adding a new entry should now evict f1 (the new oldest), not f0.
    await mod.fetchWorkingDiff("/repo", "f6.ts", "+", null);

    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repo", "f0.ts", "+")),
    ).toBeDefined();
    expect(
      mod.getCachedDiff(mod.workingDiffKey("/repo", "f1.ts", "+")),
    ).toBeUndefined();
  });
});
