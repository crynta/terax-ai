// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useRepoDiscovery } from "./useRepoDiscovery";
import { type GitRepo } from "./discover";

vi.mock("./discover", () => ({
  discoverRepositories: vi.fn(),
}));

import { discoverRepositories } from "./discover";

const mockDiscover = vi.mocked(discoverRepositories);

// ---------------------------------------------------------------------------
// Deferred promise helper
// ---------------------------------------------------------------------------
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Test harness: single mount with prop-driven re-renders to trigger
// re-discovery without unmount/remount.
// ---------------------------------------------------------------------------
function createHarness() {
  let state: {
    detectedRepos: GitRepo[];
    currentRepoRoot: string | undefined;
    loading: boolean;
  } | null = null;
  let onChange: ((root: string) => void) | null = null;

  function Component({ workspaceRoot }: { workspaceRoot: string | null }) {
    const result = useRepoDiscovery(workspaceRoot);
    state = {
      detectedRepos: result.detectedRepos,
      currentRepoRoot: result.currentRepoRoot,
      loading: result.loading,
    };
    onChange = result.onRepoChange;
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  return {
    getState: () => state,
    getOnChange: () => onChange,
    /** Render with a workspace root. Triggers the discovery effect if root changed. */
    render: (workspaceRoot: string | null) => {
      act(() => {
        root.render(
          React.createElement(Component, { workspaceRoot }),
        );
      });
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockDiscover.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRepoDiscovery", () => {
  it("returns empty state when workspaceRoot is null", () => {
    const h = createHarness();
    h.render(null);
    expect(h.getState()?.detectedRepos).toEqual([]);
    expect(h.getState()?.currentRepoRoot).toBeUndefined();
    expect(h.getState()?.loading).toBe(false);
    // mockDiscover should not be called because the effect early-returns on null
    expect(mockDiscover).not.toHaveBeenCalled();
    h.unmount();
  });

  it("discovers repos and selects the first one by default", async () => {
    const d = createDeferred<GitRepo[]>();
    mockDiscover.mockReturnValue(d.promise);

    const h = createHarness();
    h.render("/workspace");
    expect(h.getState()?.loading).toBe(true);

    await act(async () => {
      d.resolve([
        { repoRoot: "/workspace/alpha", name: "alpha", type: "root" },
        { repoRoot: "/workspace/beta", name: "beta", type: "root" },
      ]);
    });

    expect(h.getState()?.loading).toBe(false);
    expect(h.getState()?.detectedRepos).toHaveLength(2);
    expect(h.getState()?.currentRepoRoot).toBe("/workspace/alpha");
    h.unmount();
  });

  it("preserves currentRepoRoot when it still exists after re-discovery", async () => {
    // First discovery
    const d1 = createDeferred<GitRepo[]>();
    mockDiscover.mockReturnValue(d1.promise);

    const h = createHarness();
    h.render("/workspace");

    await act(async () => {
      d1.resolve([
        { repoRoot: "/workspace/alpha", name: "alpha", type: "root" },
        { repoRoot: "/workspace/beta", name: "beta", type: "root" },
        { repoRoot: "/workspace/gamma", name: "gamma", type: "root" },
      ]);
    });

    // User selects beta
    act(() => h.getOnChange()?.("/workspace/beta"));
    expect(h.getState()?.currentRepoRoot).toBe("/workspace/beta");

    // Second discovery, beta still present
    const d2 = createDeferred<GitRepo[]>();
    mockDiscover.mockReturnValue(d2.promise);

    // Trigger re-discovery by re-rendering with a different root
    h.render("/workspace2");

    await act(async () => {
      d2.resolve([
        { repoRoot: "/workspace/alpha", name: "alpha", type: "root" },
        { repoRoot: "/workspace/beta", name: "beta", type: "root" },
      ]);
    });

    // Selection should be preserved
    expect(h.getState()?.currentRepoRoot).toBe("/workspace/beta");
    h.unmount();
  });

  it("falls back to first repo when selection no longer exists", async () => {
    const d1 = createDeferred<GitRepo[]>();
    mockDiscover.mockReturnValue(d1.promise);

    const h = createHarness();
    h.render("/workspace");

    await act(async () => {
      d1.resolve([
        { repoRoot: "/workspace/alpha", name: "alpha", type: "root" },
        { repoRoot: "/workspace/beta", name: "beta", type: "root" },
      ]);
    });

    act(() => h.getOnChange()?.("/workspace/beta"));
    expect(h.getState()?.currentRepoRoot).toBe("/workspace/beta");

    // Re-discovery without beta
    const d2 = createDeferred<GitRepo[]>();
    mockDiscover.mockReturnValue(d2.promise);

    h.render("/workspace2");

    await act(async () => {
      d2.resolve([
        { repoRoot: "/workspace/alpha", name: "alpha", type: "root" },
        { repoRoot: "/workspace/gamma", name: "gamma", type: "root" },
      ]);
    });

    // Selection should fall back to first repo
    expect(h.getState()?.currentRepoRoot).toBe("/workspace/alpha");
    h.unmount();
  });

  it("suppresses stale results when a newer discovery completes first", async () => {
    // Use a single mock reference so both calls go through the same mock
    const d1 = createDeferred<GitRepo[]>();
    const d2 = createDeferred<GitRepo[]>();
    let callCount = 0;
    mockDiscover.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? d1.promise : d2.promise;
    });

    const h = createHarness();
    h.render("/workspace");

    // First discovery is in-flight (d1 pending)

    // Trigger second discovery by changing root
    h.render("/workspace2");

    // Resolve the fast (second) call first
    await act(async () => {
      d2.resolve([
        { repoRoot: "/workspace2/fast", name: "fast", type: "root" },
      ]);
    });

    expect(h.getState()?.detectedRepos[0]?.name).toBe("fast");

    // Now resolve the stale (first) call, should be ignored
    await act(async () => {
      d1.resolve([
        { repoRoot: "/workspace/stale", name: "stale", type: "root" },
      ]);
    });

    // State should still show fast, not stale
    expect(h.getState()?.detectedRepos[0]?.name).toBe("fast");
    h.unmount();
  });


  it("resets state on discoverRepositories rejection", async () => {
    mockDiscover.mockRejectedValueOnce(new Error("network error"));

    const h = createHarness();
    h.render("/workspace");

    // Wait for the rejected promise to flush
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.getState()?.detectedRepos).toEqual([]);
    expect(h.getState()?.currentRepoRoot).toBeUndefined();
    expect(h.getState()?.loading).toBe(false);
    h.unmount();
  });

  it("resets state when workspaceRoot changes to null", async () => {
    const d = createDeferred<GitRepo[]>();
    mockDiscover.mockReturnValue(d.promise);

    const h = createHarness();
    h.render("/workspace");

    await act(async () => {
      d.resolve([
        { repoRoot: "/workspace/alpha", name: "alpha", type: "root" },
      ]);
    });

    expect(h.getState()?.detectedRepos).toHaveLength(1);

    // Change to null, effect should reset state
    h.render(null);
    expect(h.getState()?.detectedRepos).toEqual([]);
    expect(h.getState()?.currentRepoRoot).toBeUndefined();
    h.unmount();
  });
});
