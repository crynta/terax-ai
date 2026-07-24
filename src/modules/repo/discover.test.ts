import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverRepositories } from "./discover";

// Mock the native module
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    discoverRepos: vi.fn(),
  },
}));

import { native } from "@/modules/ai/lib/native";

const mockNative = vi.mocked(native);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: discovery returns empty
  mockNative.discoverRepos.mockResolvedValue({ repos: [], timedOut: false });
});

describe("discoverRepositories", () => {
  it("returns empty array when workspace root has no git repo", async () => {
    const repos = await discoverRepositories("/workspace");
    expect(repos).toEqual([]);
    expect(mockNative.discoverRepos).toHaveBeenCalledWith("/workspace", {
      maxDepth: undefined,
      maxResults: undefined,
      timeoutMs: undefined,
    });
  });

  it("detects root repository", async () => {
    mockNative.discoverRepos.mockResolvedValue({
      repos: [
        { repoRoot: "/workspace", name: "workspace", type: "root" },
      ],
      timedOut: false,
    });

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      repoRoot: "/workspace",
      name: "workspace",
      type: "root",
    });
  });

  it("detects multiple repos including submodules", async () => {
    mockNative.discoverRepos.mockResolvedValue({
      repos: [
        { repoRoot: "/workspace", name: "workspace", type: "root" },
        { repoRoot: "/workspace/sub", name: "sub", type: "submodule" },
        { repoRoot: "/workspace/nested", name: "nested", type: "nested" },
      ],
      timedOut: false,
    });

    const repos = await discoverRepositories("/workspace");
    expect(repos).toHaveLength(3);
    expect(repos[0].type).toBe("root");
    expect(repos[1].type).toBe("submodule");
    expect(repos[2].type).toBe("nested");
  });

  it("passes options to Rust command", async () => {
    await discoverRepositories("/workspace", {
      maxDepth: 2,
      maxResults: 5,
      timeoutMs: 100,
    });

    expect(mockNative.discoverRepos).toHaveBeenCalledWith("/workspace", {
      maxDepth: 2,
      maxResults: 5,
      timeoutMs: 100,
    });
  });

  it("handles Rust command failure gracefully", async () => {
    mockNative.discoverRepos.mockRejectedValue(new Error("IPC failed"));

    const repos = await discoverRepositories("/workspace");
    expect(repos).toEqual([]);
  });

  it("reports timed_out flag from Rust", async () => {
    mockNative.discoverRepos.mockResolvedValue({
      repos: [
        { repoRoot: "/workspace", name: "workspace", type: "root" },
        { repoRoot: "/workspace/a", name: "a", type: "nested" },
      ],
      timedOut: true,
    });

    const repos = await discoverRepositories("/workspace");
    // timed_out is informational; the caller still gets whatever repos were found
    expect(repos).toHaveLength(2);
  });
});
