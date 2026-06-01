import type { GitChangedFile, GitStatusSnapshot } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import {
  bubbleUpDirectoryStatuses,
  buildGitStatusMap,
  lookupGitStatus,
  repoCoversPath,
  repoRelativePath,
  statusCodeForFile,
} from "./gitStatusUtils";

function changedFile(
  overrides: Partial<GitChangedFile> & Pick<GitChangedFile, "path">,
): GitChangedFile {
  return {
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

function snapshot(
  changedFiles: GitChangedFile[],
  repoRoot = "/repo",
): GitStatusSnapshot {
  return {
    repoRoot,
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
  it("returns U for untracked files", () => {
    expect(
      statusCodeForFile(
        changedFile({
          path: "new.txt",
          untracked: true,
          worktreeStatus: "?",
          unstaged: true,
        }),
      ),
    ).toBe("U");
  });

  it("returns U for unmerged files", () => {
    expect(
      statusCodeForFile(
        changedFile({
          path: "conflict.txt",
          indexStatus: "U",
          worktreeStatus: "U",
          staged: true,
          unstaged: true,
        }),
      ),
    ).toBe("U");
  });

  it("prefers unstaged worktree over staged index", () => {
    expect(
      statusCodeForFile(
        changedFile({
          path: "file.ts",
          indexStatus: "A",
          worktreeStatus: "M",
          staged: true,
          unstaged: true,
        }),
      ),
    ).toBe("M");
  });

  it("uses staged index when only staged", () => {
    expect(
      statusCodeForFile(
        changedFile({
          path: "file.ts",
          indexStatus: "A",
          worktreeStatus: " ",
          staged: true,
        }),
      ),
    ).toBe("A");
  });

  it("returns D for deleted files", () => {
    expect(
      statusCodeForFile(
        changedFile({
          path: "gone.txt",
          worktreeStatus: "D",
          unstaged: true,
        }),
      ),
    ).toBe("D");
  });

  it("returns R for renamed files", () => {
    expect(
      statusCodeForFile(
        changedFile({
          path: "new.ts",
          originalPath: "old.ts",
          indexStatus: "R",
          worktreeStatus: " ",
          staged: true,
        }),
      ),
    ).toBe("R");
  });
});

describe("bubbleUpDirectoryStatuses", () => {
  it("bubbles child status to parent directories", () => {
    const map = buildGitStatusMap(
      snapshot([
        changedFile({
          path: "src/lib/util.ts",
          worktreeStatus: "M",
          unstaged: true,
        }),
      ]),
    );
    bubbleUpDirectoryStatuses(map);
    expect(map.get("src/lib/util.ts")).toBe("M");
    expect(map.get("src/lib")).toBe("M");
    expect(map.get("src")).toBe("M");
  });

  it("merges sibling statuses by priority", () => {
    const map = buildGitStatusMap(
      snapshot([
        changedFile({
          path: "src/a.ts",
          worktreeStatus: "A",
          unstaged: true,
        }),
        changedFile({
          path: "src/b.ts",
          worktreeStatus: "D",
          unstaged: true,
        }),
      ]),
    );
    bubbleUpDirectoryStatuses(map);
    expect(map.get("src")).toBe("D");
  });

  it("prefers unmerged over deleted in parent merge", () => {
    const map = buildGitStatusMap(
      snapshot([
        changedFile({
          path: "pkg/a.ts",
          worktreeStatus: "D",
          unstaged: true,
        }),
        changedFile({
          path: "pkg/b.ts",
          indexStatus: "U",
          worktreeStatus: "U",
          staged: true,
          unstaged: true,
        }),
      ]),
    );
    bubbleUpDirectoryStatuses(map);
    expect(map.get("pkg")).toBe("U");
  });
});

describe("lookupGitStatus", () => {
  const repoRoot = "/repo";
  let map: ReturnType<typeof buildGitStatusMap>;

  it("returns null for paths outside the repo", () => {
    map = buildGitStatusMap(
      snapshot(
        [changedFile({ path: "a.ts", worktreeStatus: "M", unstaged: true })],
        repoRoot,
      ),
    );
    bubbleUpDirectoryStatuses(map);
    expect(lookupGitStatus(map, repoRoot, "/other/a.ts")).toBeNull();
  });

  it("looks up file and directory paths", () => {
    map = buildGitStatusMap(
      snapshot(
        [
          changedFile({
            path: "src/deep/file.ts",
            worktreeStatus: "M",
            unstaged: true,
          }),
        ],
        repoRoot,
      ),
    );
    bubbleUpDirectoryStatuses(map);
    expect(lookupGitStatus(map, repoRoot, "/repo/src/deep/file.ts")).toBe("M");
    expect(lookupGitStatus(map, repoRoot, "/repo/src")).toBe("M");
  });

  it("handles trailing slashes and backslashes", () => {
    map = buildGitStatusMap(
      snapshot(
        [changedFile({ path: "a.ts", worktreeStatus: "?", untracked: true, unstaged: true })],
        "/repo/",
      ),
    );
    bubbleUpDirectoryStatuses(map);
    expect(repoCoversPath("/repo/", "/repo/sub")).toBe(true);
    expect(repoRelativePath("\\repo\\", "\\repo\\a.ts")).toBe("a.ts");
    expect(lookupGitStatus(map, "/repo/", "\\repo\\a.ts")).toBe("U");
  });
});
