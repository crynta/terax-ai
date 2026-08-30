import { describe, expect, it, vi } from "vitest";
import * as pathUtils from "./pathUtils";

const { segmentsFromCwd } = pathUtils;

function shape(cwd: string, home: string | null) {
  return segmentsFromCwd(cwd, home).map((s) => ({
    label: s.label,
    fullPath: s.fullPath,
    isHome: s.isHome,
  }));
}

describe("joinCanonicalChild", () => {
  it("joins with forward slash without stripping legal backslashes", () => {
    expect(pathUtils.joinCanonicalChild("/", "tmp")).toBe("/tmp");
    expect(pathUtils.joinCanonicalChild("C:/", "Users")).toBe("C:/Users");
    expect(pathUtils.joinCanonicalChild("/repo/dir\\", "child")).toBe(
      "/repo/dir\\/child",
    );
  });
});

describe("listSubdirsForEnv", () => {
  it("passes the explicit Space environment to directory listing", async () => {
    const list = vi.fn().mockResolvedValue(["src"]);
    const env = { kind: "wsl" as const, distro: "Ubuntu" };

    await expect(
      pathUtils.listSubdirsForEnv(list, "/work", false, env),
    ).resolves.toEqual(["src"]);
    expect(list).toHaveBeenCalledWith("/work", false, env);
  });
});

describe("scrollBreadcrumbToEnd", () => {
  it("moves a breadcrumb viewport to its right edge", () => {
    const target = { scrollLeft: 12, scrollWidth: 480 };
    pathUtils.scrollBreadcrumbToEnd(target);
    expect(target.scrollLeft).toBe(480);
  });
});

describe("latest request gate", () => {
  it("rejects stale and invalidated directory-list responses", () => {
    const gate = pathUtils.createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });
});

describe("horizontalWheelDelta", () => {
  it("uses the dominant wheel axis for horizontal breadcrumb navigation", () => {
    expect(pathUtils.horizontalWheelDelta(0, 24)).toBe(24);
    expect(pathUtils.horizontalWheelDelta(-18, 3)).toBe(-18);
  });
});

describe("segmentsFromCwd", () => {
  it("renders a path under home with a ~ root and accumulated paths", () => {
    expect(shape("/Users/me/projects/terax", "/Users/me")).toEqual([
      { label: "~", fullPath: "/Users/me", isHome: true },
      { label: "projects", fullPath: "/Users/me/projects", isHome: false },
      { label: "terax", fullPath: "/Users/me/projects/terax", isHome: false },
    ]);
  });

  it("collapses the home directory itself to a single ~ segment", () => {
    expect(shape("/Users/me", "/Users/me")).toEqual([
      { label: "~", fullPath: "/Users/me", isHome: true },
    ]);
  });

  it("does not treat a sibling that merely shares the home prefix as home", () => {
    const segments = shape("/Users/mefoo", "/Users/me");
    expect(segments[0]).toEqual({ label: "/", fullPath: "/", isHome: false });
    expect(segments.map((s) => s.label)).toEqual(["/", "Users", "mefoo"]);
  });

  it("builds unix absolute paths from the / root", () => {
    expect(shape("/usr/local/bin", null)).toEqual([
      { label: "/", fullPath: "/", isHome: false },
      { label: "usr", fullPath: "/usr", isHome: false },
      { label: "local", fullPath: "/usr/local", isHome: false },
      { label: "bin", fullPath: "/usr/local/bin", isHome: false },
    ]);
  });

  it("preserves the server and share as a UNC root", () => {
    expect(shape("//server/share/dir/nested", null)).toEqual([
      { label: "//server/share", fullPath: "//server/share", isHome: false },
      { label: "dir", fullPath: "//server/share/dir", isHome: false },
      { label: "nested", fullPath: "//server/share/dir/nested", isHome: false },
    ]);
  });

  it("uses the drive letter as the root on Windows paths", () => {
    expect(shape("C:/Users/me/proj", null)).toEqual([
      { label: "C:", fullPath: "C:/", isHome: false },
      { label: "Users", fullPath: "C:/Users", isHome: false },
      { label: "me", fullPath: "C:/Users/me", isHome: false },
      { label: "proj", fullPath: "C:/Users/me/proj", isHome: false },
    ]);
  });

  it("preserves backslashes in canonical Unix directory names", () => {
    expect(shape("/repo/dir\\name", null)).toEqual([
      { label: "/", fullPath: "/", isHome: false },
      { label: "repo", fullPath: "/repo", isHome: false },
      { label: "dir\\name", fullPath: "/repo/dir\\name", isHome: false },
    ]);
  });

  it("returns just the root for a bare drive or /", () => {
    expect(shape("C:/", null)).toEqual([
      { label: "C:", fullPath: "C:/", isHome: false },
    ]);
    expect(shape("/", null)).toEqual([
      { label: "/", fullPath: "/", isHome: false },
    ]);
  });
});
