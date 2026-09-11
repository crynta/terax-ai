import { describe, expect, it } from "vitest";
import {
  beginSourceControlRefresh,
  repositoryContainsContext,
  shouldRefreshForPaths,
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

describe("shouldRefreshForPaths", () => {
  const root = "/home/ada/repo";

  it("refreshes for a tracked path inside the repository", () => {
    expect(shouldRefreshForPaths(root, ["/home/ada/repo/src/main.rs"])).toBe(
      true,
    );
  });

  it("ignores paths outside the repository", () => {
    expect(shouldRefreshForPaths(root, ["/home/ada/other/main.rs"])).toBe(
      false,
    );
  });

  it("ignores git's own bookkeeping", () => {
    expect(
      shouldRefreshForPaths(root, [
        "/home/ada/repo/.git/index.lock",
        "/home/ada/repo/.git",
      ]),
    ).toBe(false);
  });

  it("refreshes when a batch mixes git internals with real changes", () => {
    expect(
      shouldRefreshForPaths(root, [
        "/home/ada/repo/.git/index",
        "/home/ada/repo/src/main.rs",
      ]),
    ).toBe(true);
  });

  it("ignores git's bookkeeping under a case-insensitive Windows path", () => {
    expect(shouldRefreshForPaths("C:\\Repo", ["C:\\Repo\\.GIT\\index"])).toBe(
      false,
    );
    expect(shouldRefreshForPaths("C:\\Repo", ["C:\\Repo\\src\\main.rs"])).toBe(
      true,
    );
  });

  it("needs a repository", () => {
    expect(shouldRefreshForPaths(null, ["/home/ada/repo/src/main.rs"])).toBe(
      false,
    );
  });
});
