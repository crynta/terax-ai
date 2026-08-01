import type {
  GitChangedFile,
  GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import {
  buildGitStatusMap,
  lookupGitStatus,
  repoRelativePath,
  statusCodeForFile,
} from "./gitStatusUtils";

function file(overrides: Partial<GitChangedFile>): GitChangedFile {
  return {
    path: "a.ts",
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: " ",
    staged: false,
    unstaged: false,
    untracked: false,
    statusLabel: "",
    ...overrides,
  };
}

function snapshot(changedFiles: GitChangedFile[]): GitStatusSnapshot {
  return {
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles,
  };
}

describe("statusCodeForFile", () => {
  it("maps untracked", () => {
    expect(statusCodeForFile(file({ untracked: true }))).toBe("U");
    expect(statusCodeForFile(file({ worktreeStatus: "U" }))).toBe("U");
  });

  it("prefers worktree status when unstaged, index when staged", () => {
    expect(
      statusCodeForFile(file({ unstaged: true, worktreeStatus: "M" })),
    ).toBe("M");
    expect(statusCodeForFile(file({ staged: true, indexStatus: "A" }))).toBe(
      "A",
    );
  });

  it("normalizes rename/copy to R", () => {
    expect(statusCodeForFile(file({ staged: true, indexStatus: "R" }))).toBe(
      "R",
    );
    expect(statusCodeForFile(file({ staged: true, indexStatus: "C" }))).toBe(
      "R",
    );
  });
});

describe("buildGitStatusMap", () => {
  it("keys by normalized repo-relative path", () => {
    const map = buildGitStatusMap(
      snapshot([
        file({ path: "src/a.ts", unstaged: true, worktreeStatus: "M" }),
        file({ path: "b.ts", untracked: true }),
      ]),
    );
    expect(map.get("src/a.ts")).toBe("M");
    expect(map.get("b.ts")).toBe("U");
  });
});

describe("repoRelativePath", () => {
  it("returns relative path for files under the root", () => {
    expect(repoRelativePath("/repo/src/a.ts", ["/repo"])).toBe("src/a.ts");
  });

  it("returns empty string for the root itself", () => {
    expect(repoRelativePath("/repo", ["/repo"])).toBe("");
  });

  it("returns null when outside every root", () => {
    expect(repoRelativePath("/other/a.ts", ["/repo"])).toBeNull();
  });

  it("normalizes backslashes and trailing slashes", () => {
    expect(repoRelativePath("C:\\repo\\src\\a.ts", ["C:/repo/"])).toBe(
      "src/a.ts",
    );
  });

  it("matches through a symlinked alias root", () => {
    expect(
      repoRelativePath("/tmp/proj/a.ts", ["/private/tmp/proj", "/tmp/proj"]),
    ).toBe("a.ts");
  });
});

describe("lookupGitStatus", () => {
  const map = buildGitStatusMap(
    snapshot([file({ path: "src/a.ts", unstaged: true, worktreeStatus: "M" })]),
  );

  it("resolves an absolute path against the repo root", () => {
    expect(lookupGitStatus(map, "/repo", "/repo/src/a.ts")).toBe("M");
  });

  it("returns null for unchanged and out-of-repo paths", () => {
    expect(lookupGitStatus(map, "/repo", "/repo/src/b.ts")).toBeNull();
    expect(lookupGitStatus(map, "/repo", "/elsewhere/a.ts")).toBeNull();
  });
});
