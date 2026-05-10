import { describe, expect, it } from "vitest";
import {
  getGitStatus,
  GIT_STATUS_COLOR,
  type GitStatusMap,
} from "@/modules/explorer/lib/useGitStatus";

describe("getGitStatus", () => {
  const statusMap: GitStatusMap = {
    "src/main.ts": "modified",
    "src/new.ts": "added",
    "src/old.ts": "deleted",
    "README.md": "untracked",
  };

  it("finds modified file on Unix path", () => {
    expect(
      getGitStatus(statusMap, "/home/user/project", "/home/user/project/src/main.ts"),
    ).toBe("modified");
  });

  it("finds added file on Windows path", () => {
    expect(
      getGitStatus(
        statusMap,
        "C:\\Users\\dev\\project",
        "C:\\Users\\dev\\project\\src\\new.ts",
      ),
    ).toBe("added");
  });

  it("returns undefined for clean file", () => {
    expect(
      getGitStatus(statusMap, "/home/user/project", "/home/user/project/src/clean.ts"),
    ).toBeUndefined();
  });

  it("returns undefined for root path", () => {
    expect(
      getGitStatus(statusMap, "/home/user/project", "/home/user/project"),
    ).toBeUndefined();
  });

  it("returns undefined for path outside root", () => {
    expect(
      getGitStatus(statusMap, "/home/user/project", "/other/path/main.ts"),
    ).toBeUndefined();
  });

  it("returns undefined for empty inputs", () => {
    expect(getGitStatus(statusMap, "", "/some/path")).toBeUndefined();
    expect(getGitStatus(statusMap, "/root", "")).toBeUndefined();
  });

  it("returns undefined for null root", () => {
    expect(getGitStatus(statusMap, null as any, "/path")).toBeUndefined();
  });
});

describe("GIT_STATUS_COLOR", () => {
  it("has color for every status type", () => {
    const statuses: Array<keyof typeof GIT_STATUS_COLOR> = [
      "modified",
      "added",
      "deleted",
      "untracked",
      "renamed",
      "copied",
    ];
    for (const s of statuses) {
      expect(GIT_STATUS_COLOR[s]).toBeTruthy();
      expect(GIT_STATUS_COLOR[s]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
