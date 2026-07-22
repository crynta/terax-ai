import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverRepositories } from "./discover";

// Mock the native module
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    canonicalize: vi.fn(),
    gitResolveRepo: vi.fn(),
    readDir: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Mock @tauri-apps/api/path
vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

import { native } from "@/modules/ai/lib/native";

const mockNative = vi.mocked(native);

// Helper to create a minimal DirEntry
const dir = (name: string) => ({
  name,
  kind: "dir" as const,
  size: 0,
  mtime: 0,
  gitignored: false,
});

const file = (name: string) => ({
  name,
  kind: "file" as const,
  size: 0,
  mtime: 0,
  gitignored: false,
});

// Helper to create a minimal GitRepoInfo
const repoInfo = (repoRoot: string) => ({
  repoRoot,
  branch: "main",
  upstream: null,
  isDetached: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: canonicalize returns its input
  mockNative.canonicalize.mockImplementation((p: string) => Promise.resolve(p));
  // Default: gitResolveRepo returns null (no repo)
  mockNative.gitResolveRepo.mockResolvedValue(null);
  // Default: readDir returns empty
  mockNative.readDir.mockResolvedValue([]);
});

describe("discoverRepositories", () => {
  it("returns empty array when workspace root has no git repo", async () => {
    const repos = await discoverRepositories("/workspace");
    expect(repos).toEqual([]);
  });

  it("detects root repository", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(repoInfo("/workspace"));
    mockNative.readDir.mockResolvedValue([]);

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      repoRoot: "/workspace",
      name: "workspace",
      type: "root",
    });
  });

  it("deduplicates by canonicalized path", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(repoInfo("/workspace"));
    mockNative.canonicalize.mockResolvedValue("/workspace");
    mockNative.readDir.mockResolvedValue([]);

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
  });

  it("respects maxResults option", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(repoInfo("/workspace"));
    const entries = Array.from({ length: 10 }, (_, i) => dir(`repo${i}`));
    mockNative.readDir.mockImplementation(async (d: string) => {
      if (d === "/workspace") return entries;
      if (d.startsWith("/workspace/repo")) return [dir(".git")];
      return [];
    });

    const repos = await discoverRepositories("/workspace", { maxResults: 3 });
    expect(repos.length).toBeLessThanOrEqual(3);
  });

  it("respects maxDepth option", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(null);
    mockNative.readDir.mockImplementation(async (d: string) => {
      if (d === "/workspace") return [dir("deep")];
      if (d === "/workspace/deep") return [dir(".git")];
      return [];
    });

    const repos = await discoverRepositories("/workspace", { maxDepth: 0 });
    expect(repos).toEqual([]);
  });

  it("detects .git file (submodule pointer)", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(null);
    mockNative.readDir.mockImplementation(async (d: string) => {
      if (d === "/workspace") return [dir("sub")];
      if (d === "/workspace/sub") return [file(".git")];
      return [];
    });
    mockNative.readFile.mockResolvedValue({
      kind: "text" as const,
      content: "gitdir: ../.git/modules/sub\n",
      size: 30,
    });
    mockNative.canonicalize.mockImplementation(async (p: string) => {
      if (p === "/workspace/sub") return "/workspace/sub";
      if (p === "/workspace/.git/modules/sub")
        return "/workspace/.git/modules/sub";
      return p;
    });

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
    expect(repos[0].type).toBe("submodule");
  });

  it("skips directories we cannot read", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(null);
    mockNative.readDir.mockImplementation(async (d: string) => {
      if (d === "/workspace") return [dir("ok"), dir("noaccess")];
      if (d === "/workspace/noaccess") throw new Error("EACCES");
      return [];
    });

    const repos = await discoverRepositories("/workspace");
    expect(repos).toEqual([]);
  });

  it("skips hidden directories except .git", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(null);
    mockNative.readDir.mockImplementation(async (d: string) => {
      if (d === "/workspace")
        return [dir(".hidden"), dir(".git"), dir("visible")];
      return [];
    });

    await discoverRepositories("/workspace");
    expect(mockNative.readDir).toHaveBeenCalledWith("/workspace");
  });

  it("sorts results with root first, then alphabetically", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(repoInfo("/workspace"));
    mockNative.readDir.mockImplementation(async (d: string) => {
      if (d === "/workspace") return [dir("zebra"), dir("alpha")];
      if (d.endsWith("/.git")) return [];
      return [dir(".git")];
    });

    const repos = await discoverRepositories("/workspace");
    expect(repos[0].type).toBe("root");
    const names = repos.map((r) => r.name);
    const nonRoot = names.slice(1);
    expect(nonRoot).toEqual([...nonRoot].sort());
  });

  it("handles canonicalize failure with fallback normalization", async () => {
    mockNative.gitResolveRepo.mockResolvedValue(repoInfo("/workspace"));
    mockNative.canonicalize
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValue("/workspace");
    mockNative.readDir.mockResolvedValue([]);

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
    expect(repos[0].repoRoot).toBe("/workspace");
  });
});
