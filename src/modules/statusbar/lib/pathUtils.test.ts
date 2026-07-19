import { describe, expect, it } from "vitest";
import { segmentsFromCwd } from "./pathUtils";

function shape(cwd: string, home: string | null) {
  return segmentsFromCwd(cwd, home).map((s) => ({
    label: s.label,
    fullPath: s.fullPath,
    isHome: s.isHome,
  }));
}

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

  it("uses the drive letter as the root on Windows paths", () => {
    expect(shape("C:/Users/me/proj", null)).toEqual([
      { label: "C:", fullPath: "C:/", isHome: false },
      { label: "Users", fullPath: "C:/Users", isHome: false },
      { label: "me", fullPath: "C:/Users/me", isHome: false },
      { label: "proj", fullPath: "C:/Users/me/proj", isHome: false },
    ]);
  });

  it("normalizes backslash separators", () => {
    expect(shape("C:\\Users\\me\\proj", null).map((s) => s.label)).toEqual([
      "C:",
      "Users",
      "me",
      "proj",
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
