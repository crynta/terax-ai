import { describe, expect, it } from "vitest";
import { refreshTargets, type TreeState } from "./refreshTargets";

const loaded = { status: "loaded" as const, entries: [] };

function tree(paths: string[]): TreeState {
  return Object.fromEntries(paths.map((path) => [path, loaded]));
}

describe("refreshTargets", () => {
  it("has nothing to read without a root", () => {
    expect(refreshTargets(null, tree(["/r/src"]), ["/r/src"])).toEqual([]);
  });

  it("always reads the root, even before it has loaded", () => {
    expect(refreshTargets("/r", {}, [])).toEqual(["/r"]);
    expect(refreshTargets("/r", { "/r": { status: "loading" } }, [])).toEqual([
      "/r",
    ]);
  });

  it("includes loaded directories the tree has collapsed", () => {
    const nodes = tree(["/r/src", "/r/src/lib"]);
    expect(refreshTargets("/r", nodes, [])).toEqual([
      "/r",
      "/r/src",
      "/r/src/lib",
    ]);
  });

  it("includes expanded directories that have not loaded yet", () => {
    const nodes: TreeState = { "/r": loaded, "/r/src": { status: "loading" } };
    expect(refreshTargets("/r", nodes, ["/r/src", "/r/docs"])).toEqual([
      "/r",
      "/r/docs",
      "/r/src",
    ]);
  });

  it("lists each directory once, root first then sorted", () => {
    const nodes = tree(["/r/src", "/r", "/r/a"]);
    expect(refreshTargets("/r", nodes, ["/r/a", "/r/src", "/r"])).toEqual([
      "/r",
      "/r/a",
      "/r/src",
    ]);
  });
});
