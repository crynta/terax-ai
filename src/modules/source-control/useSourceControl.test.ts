import { describe, expect, it } from "vitest";
import {
  beginSourceControlRefresh,
  planContextRefresh,
  repositoryContainsContext,
} from "./useSourceControl";

describe("repositoryContainsContext", () => {
  it("matches a repository root and its descendants", () => {
    expect(repositoryContainsContext("/repo", "/repo")).toBe(true);
    expect(repositoryContainsContext("/repo", "/repo/packages/app")).toBe(
      true,
    );
  });

  it("rejects sibling paths that only share a string prefix", () => {
    expect(repositoryContainsContext("/repo", "/repo-other/app")).toBe(false);
    expect(repositoryContainsContext("/Repo", "/repo/app")).toBe(false);
  });

  it("normalizes Windows separators and drive-letter casing", () => {
    expect(
      repositoryContainsContext("C:\\Repo", "c:/repo/packages/app"),
    ).toBe(true);
  });

  it("normalizes UNC server and share casing", () => {
    expect(
      repositoryContainsContext(
        "\\\\SERVER\\Share\\Repo",
        "//server/share/repo/packages/app",
      ),
    ).toBe(true);
  });

  it("handles filesystem roots", () => {
    expect(repositoryContainsContext("/", "/workspace")).toBe(true);
    expect(repositoryContainsContext("C:/", "C:/workspace")).toBe(true);
  });
});

describe("beginSourceControlRefresh", () => {
  const loaded = {
    contextPath: "/old/repo",
    repo: {
      repoRoot: "/old/repo",
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: {
      repoRoot: "/old/repo",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [],
    },
    hasRepo: true,
    isLoading: false,
    localError: "old error",
    lastRemoteError: "old remote error",
    untouched: 42,
  };

  it("clears stale repository data when the context changes repositories", () => {
    expect(beginSourceControlRefresh(loaded, "/new/repo", false)).toEqual({
      contextPath: "/new/repo",
      repo: null,
      status: null,
      hasRepo: false,
      isLoading: true,
      localError: null,
      lastRemoteError: null,
      untouched: 42,
    });
  });

  it("preserves fresh repository data for a context inside the same repo", () => {
    expect(
      beginSourceControlRefresh(loaded, "/old/repo/packages/app", true),
    ).toEqual({
      ...loaded,
      contextPath: "/old/repo/packages/app",
      isLoading: true,
      localError: null,
    });
  });
});

describe("planContextRefresh", () => {
  const loaded = {
    enabled: true,
    live: true,
    contextPath: "/repo/app",
    repoRoot: "/repo",
    hasRepo: true,
    ageMs: 60_000,
  };

  it("clears everything when disabled", () => {
    expect(planContextRefresh({ ...loaded, enabled: false })).toBe("reset");
  });

  it("runs git for a live consumer when the data is old", () => {
    expect(planContextRefresh(loaded)).toBe("refresh");
    expect(
      planContextRefresh({ ...loaded, repoRoot: null, hasRepo: false }),
    ).toBe("refresh");
  });

  it("reuses very fresh data inside the same repository", () => {
    expect(planContextRefresh({ ...loaded, ageMs: 500 })).toBe("reuse");
    // Fresh but a different repository: must refetch.
    expect(
      planContextRefresh({ ...loaded, ageMs: 500, contextPath: "/other" }),
    ).toBe("refresh");
  });

  it("never runs git while no live consumer is on screen", () => {
    for (const ageMs of [0, 500, 60_000, 3_600_000]) {
      for (const contextPath of ["/repo/app", "/other", null]) {
        expect(
          planContextRefresh({ ...loaded, live: false, ageMs, contextPath }),
        ).not.toBe("refresh");
      }
    }
  });

  it("keeps the snapshot while the context stays inside its repository", () => {
    expect(planContextRefresh({ ...loaded, live: false })).toBe("keep");
  });

  it("drops a snapshot that no longer describes the context, instead of showing the wrong repo's badge", () => {
    expect(
      planContextRefresh({ ...loaded, live: false, contextPath: "/other" }),
    ).toBe("clear");
    expect(
      planContextRefresh({ ...loaded, live: false, contextPath: null }),
    ).toBe("clear");
  });

  it("has nothing to clear or keep when nothing is loaded", () => {
    expect(
      planContextRefresh({
        ...loaded,
        live: false,
        repoRoot: null,
        hasRepo: false,
      }),
    ).toBe("keep");
  });

  it("refreshes stale data the moment a consumer appears", () => {
    const hidden = planContextRefresh({ ...loaded, live: false });
    const shown = planContextRefresh({ ...loaded, live: true });
    expect([hidden, shown]).toEqual(["keep", "refresh"]);
  });
});
