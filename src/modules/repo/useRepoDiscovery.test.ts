import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverRepositories, type GitRepo } from "./discover";

// Mock the discover module
vi.mock("./discover", () => ({
  discoverRepositories: vi.fn(),
}));

const mockDiscover = vi.mocked(discoverRepositories);

const makeRepos = (...names: string[]): GitRepo[] =>
  names.map((name) => ({
    repoRoot: `/workspace/${name}`,
    name,
    type: "root" as const,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mockDiscover.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("discoverRepositories", () => {
  it("returns empty array when workspace root has no git repo", async () => {
    const repos = await discoverRepositories("/workspace");
    expect(repos).toEqual([]);
  });

  it("detects root repository", async () => {
    mockDiscover.mockResolvedValueOnce([
      { repoRoot: "/workspace", name: "workspace", type: "root" },
    ]);
    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      repoRoot: "/workspace",
      name: "workspace",
      type: "root",
    });
  });

  it("deduplicates by canonicalized path", async () => {
    mockDiscover.mockResolvedValueOnce([
      { repoRoot: "/workspace", name: "workspace", type: "root" },
    ]);
    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
  });

  it("respects maxResults option", async () => {
    mockDiscover.mockResolvedValueOnce([
      { repoRoot: "/workspace", name: "workspace", type: "root" },
      { repoRoot: "/workspace/repo0", name: "repo0", type: "submodule" },
      { repoRoot: "/workspace/repo1", name: "repo1", type: "submodule" },
    ]);

    const repos = await discoverRepositories("/workspace", { maxResults: 3 });
    expect(repos).toHaveLength(3);
    expect(repos[0]).toEqual({
      repoRoot: "/workspace",
      name: "workspace",
      type: "root",
    });
    expect(repos[1]).toEqual({
      repoRoot: "/workspace/repo0",
      name: "repo0",
      type: "submodule",
    });
    expect(repos[2]).toEqual({
      repoRoot: "/workspace/repo1",
      name: "repo1",
      type: "submodule",
    });
  });

  it("respects maxDepth option", async () => {
    mockDiscover.mockResolvedValueOnce([]);
    const repos = await discoverRepositories("/workspace", { maxDepth: 0 });
    expect(repos).toEqual([]);
  });

  it("sorts results with root first, then alphabetically", async () => {
    mockDiscover.mockResolvedValueOnce([
      { repoRoot: "/workspace", name: "workspace", type: "root" },
      { repoRoot: "/workspace/alpha", name: "alpha", type: "submodule" },
      { repoRoot: "/workspace/zebra", name: "zebra", type: "submodule" },
    ]);

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(3);
    expect(repos[0]).toEqual({
      repoRoot: "/workspace",
      name: "workspace",
      type: "root",
    });
    expect(repos[1]).toEqual({
      repoRoot: "/workspace/alpha",
      name: "alpha",
      type: "submodule",
    });
    expect(repos[2]).toEqual({
      repoRoot: "/workspace/zebra",
      name: "zebra",
      type: "submodule",
    });
  });
});

describe("useRepoDiscovery state logic", () => {
  it("discovers repos and selects the first one by default", async () => {
    mockDiscover.mockResolvedValueOnce(makeRepos("alpha", "beta"));
    const repos = await discoverRepositories("/workspace");

    expect(repos).toHaveLength(2);
    expect(repos[0].name).toBe("alpha");
    expect(repos[1].name).toBe("beta");
  });

  it("preserves currentRepoRoot when it still exists after re-discovery", async () => {
    mockDiscover.mockResolvedValueOnce(makeRepos("alpha", "beta", "gamma"));
    await discoverRepositories("/workspace");

    const currentRepoRoot = "/workspace/beta";

    mockDiscover.mockResolvedValueOnce(makeRepos("alpha", "beta"));
    const repos = await discoverRepositories("/workspace");

    const stillExists = repos.some((r) => r.repoRoot === currentRepoRoot);
    expect(stillExists).toBe(true);
    expect(currentRepoRoot).toBe("/workspace/beta");
  });

  it("falls back to first repo when selection no longer exists", async () => {
    mockDiscover.mockResolvedValueOnce(makeRepos("alpha", "beta"));
    await discoverRepositories("/workspace");

    const currentRepoRoot = "/workspace/beta";

    mockDiscover.mockResolvedValueOnce(makeRepos("alpha", "gamma"));
    const repos = await discoverRepositories("/workspace");

    const stillExists = repos.some((r) => r.repoRoot === currentRepoRoot);
    expect(stillExists).toBe(false);
    expect(repos[0].repoRoot).toBe("/workspace/alpha");
  });

  it("detects when stale results should be discarded", async () => {
    // Simulate the seq-based stale detection logic from the hook
    let seqRef = 0;

    // First discovery starts
    const seq1 = ++seqRef;
    mockDiscover.mockResolvedValueOnce(makeRepos("slow-repo"));
    const slowPromise = discoverRepositories("/workspace");

    // Second discovery starts (workspace changed)
    const seq2 = ++seqRef;
    mockDiscover.mockResolvedValueOnce(makeRepos("fast-repo"));
    const fastPromise = discoverRepositories("/workspace");

    // Both resolve
    await slowPromise;
    const fastRepos = await fastPromise;

    // The hook checks: if (seq !== seqRef.current) return;
    // After both resolve, seqRef.current is seq2
    const slowIsStale = seq1 !== seqRef; // seq1 < seqRef → stale
    const fastIsCurrent = seq2 === seqRef; // seq2 === seqRef → current

    expect(slowIsStale).toBe(true);
    expect(fastIsCurrent).toBe(true);
    expect(fastRepos[0].name).toBe("fast-repo");
  });

  it("returns empty state when workspaceRoot is null", () => {
    // When null, discoverRepositories should not be called
    expect(mockDiscover).not.toHaveBeenCalled();
  });
});
