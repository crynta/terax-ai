import { describe, expect, it } from "vitest";
import {
  boostRecent,
  parseFileTarget,
  pathParts,
  recentToHits,
  relativeTo,
} from "./quickOpen";

describe("parseFileTarget", () => {
  it("returns the plain query without a position", () => {
    expect(parseFileTarget("  App.tsx ")).toEqual({ query: "App.tsx" });
  });

  it("reads path:line", () => {
    expect(parseFileTarget("src/App.tsx:42")).toEqual({
      query: "src/App.tsx",
      line: 42,
    });
  });

  it("reads path:line:col", () => {
    expect(parseFileTarget("App.tsx:42:7")).toEqual({
      query: "App.tsx",
      line: 42,
      column: 7,
    });
  });

  it("drops a dangling colon while the position is still being typed", () => {
    expect(parseFileTarget("App.tsx:")).toEqual({ query: "App.tsx" });
    expect(parseFileTarget("App.tsx:12:")).toEqual({
      query: "App.tsx",
      line: 12,
    });
  });

  it("clamps zero and absurd positions", () => {
    expect(parseFileTarget("a:0")).toEqual({ query: "a", line: 1 });
    expect(parseFileTarget("a:99999999999")).toEqual({
      query: "a",
      line: 9_999_999,
    });
  });

  it("does not treat a Windows drive or non-numeric suffix as a position", () => {
    expect(parseFileTarget("C:\\src\\app.ts")).toEqual({
      query: "C:\\src\\app.ts",
    });
    expect(parseFileTarget("notes:todo")).toEqual({ query: "notes:todo" });
  });

  it("keeps an empty query when only a position is given", () => {
    expect(parseFileTarget(":30")).toEqual({ query: "", line: 30 });
  });
});

describe("boostRecent", () => {
  const hit = (path: string, score: number) => ({ path, score });

  it("keeps the search order when nothing is recent", () => {
    const hits = [hit("a", 90), hit("b", 80)];
    expect(boostRecent(hits, [])).toEqual(hits);
  });

  it("lifts a recent file past a slightly better match", () => {
    const out = boostRecent([hit("a", 100), hit("b", 90)], ["b"]);
    expect(out.map((h) => h.path)).toEqual(["b", "a"]);
  });

  it("does not let a recent weak match outrank a clearly better one", () => {
    const out = boostRecent([hit("a", 100), hit("b", 40)], ["b"]);
    expect(out.map((h) => h.path)).toEqual(["a", "b"]);
  });

  it("favours the more recent of two recent files with equal scores", () => {
    const out = boostRecent(
      [hit("a", 80), hit("b", 80), hit("c", 80)],
      ["c", "b"],
    );
    expect(out.map((h) => h.path)).toEqual(["c", "b", "a"]);
  });

  it("is stable for equal totals and does not mutate its input", () => {
    const hits = [hit("a", 50), hit("b", 50)];
    const out = boostRecent(hits, ["zzz"]);
    expect(out.map((h) => h.path)).toEqual(["a", "b"]);
    expect(out).not.toBe(hits);
  });
});

describe("relativeTo / recentToHits", () => {
  it("strips the root, tolerating backslashes and trailing separators", () => {
    expect(relativeTo("/p/app/", "/p/app/src/a.ts")).toBe("src/a.ts");
    expect(relativeTo("C:\\p\\app", "C:\\p\\app\\src\\a.ts")).toBe("src/a.ts");
  });

  it("leaves paths outside the root alone", () => {
    expect(relativeTo("/p/app", "/p/other/a.ts")).toBe("/p/other/a.ts");
    expect(relativeTo("/p/app", "/p/application/a.ts")).toBe(
      "/p/application/a.ts",
    );
  });

  it("maps recents to hits in order and honours the limit", () => {
    const hits = recentToHits("/p", ["/p/a/x.ts", "/p/y.ts", "/p/z.ts"], 2);
    expect(hits.map((h) => [h.rel, h.name])).toEqual([
      ["a/x.ts", "x.ts"],
      ["y.ts", "y.ts"],
    ]);
  });
});

describe("pathParts", () => {
  const text = (segs: { text: string }[]) => segs.map((s) => s.text).join("");

  it("splits name and directory and marks matched characters", () => {
    const { name, dir } = pathParts("src/app/Main.tsx", [0, 4, 8, 9]);
    expect(text(dir)).toBe("src/app");
    expect(text(name)).toBe("Main.tsx");
    expect(dir.filter((s) => s.hit).map((s) => s.text)).toEqual(["s", "a"]);
    expect(name.filter((s) => s.hit).map((s) => s.text)).toEqual(["Ma"]);
  });

  it("handles top-level files and no matches", () => {
    const parts = pathParts("README.md", []);
    expect(parts.dir).toEqual([]);
    expect(parts.name).toEqual([{ text: "README.md", hit: false }]);
  });

  it("counts indices in code points, not UTF-16 units", () => {
    const { name } = pathParts("dir/😀a.ts", [4, 5]);
    expect(name.map((s) => [s.text, s.hit])).toEqual([
      ["😀a", true],
      [".ts", false],
    ]);
  });
});
