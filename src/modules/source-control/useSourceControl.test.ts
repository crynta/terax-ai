import { describe, expect, it } from "vitest";
import {
  beginSourceControlRefresh,
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
