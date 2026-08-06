import { describe, expect, it } from "vitest";
import {
  hasLeaf,
  leafIds,
  removeLeaf,
  siblingLeafOf,
  splitLeaf,
  findLeafPath,
  setLeafPath,
} from "@/modules/terminal/lib/panes";
import type { PaneNode } from "@/modules/terminal/lib/panes";

// Helpers to build test trees
function leaf(id: number, path?: string): PaneNode {
  return { kind: "leaf", id, path };
}

function hSplit(id: number, ...children: PaneNode[]): PaneNode {
  return { kind: "split", id, dir: "row", children };
}

function vSplit(id: number, ...children: PaneNode[]): PaneNode {
  return { kind: "split", id, dir: "col", children };
}

describe("editor pane tree: splitLeaf with path", () => {
  it("splits a single leaf and preserves paths", () => {
    const tree = leaf(1, "/a/foo.ts");
    const result = splitLeaf(tree, 1, 10, 2, "row", undefined, "/a/bar.ts");
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      expect(result.children).toHaveLength(2);
      expect(result.children[0]).toMatchObject({ kind: "leaf", id: 1, path: "/a/foo.ts" });
      expect(result.children[1]).toMatchObject({ kind: "leaf", id: 2, path: "/a/bar.ts" });
    }
  });

  it("appends sibling when enclosing split matches direction", () => {
    const tree = hSplit(10, leaf(1, "/a.ts"), leaf(2, "/b.ts"));
    const result = splitLeaf(tree, 1, 11, 3, "row", undefined, "/a.ts");
    if (result.kind === "split") {
      // new leaf inserted right after target (idx+1), so order: [1, 3, 2]
      expect(result.children).toHaveLength(3);
      expect(result.children[1]).toMatchObject({ kind: "leaf", id: 3, path: "/a.ts" });
    }
  });

  it("leafIds returns all leaf ids after split", () => {
    const tree = leaf(1, "/a.ts");
    const split = splitLeaf(tree, 1, 10, 2, "col", undefined, "/b.ts");
    expect(leafIds(split)).toEqual([1, 2]);
  });
});

describe("editor pane tree: findLeafPath / setLeafPath", () => {
  it("finds a leaf path by id", () => {
    const tree = hSplit(10, leaf(1, "/a.ts"), leaf(2, "/b.ts"));
    expect(findLeafPath(tree, 1)).toBe("/a.ts");
    expect(findLeafPath(tree, 2)).toBe("/b.ts");
    expect(findLeafPath(tree, 99)).toBeUndefined();
  });

  it("sets a leaf path by id (immutable)", () => {
    const tree = hSplit(10, leaf(1, "/a.ts"), leaf(2, "/b.ts"));
    const updated = setLeafPath(tree, 1, "/renamed.ts");
    expect(findLeafPath(updated, 1)).toBe("/renamed.ts");
    expect(findLeafPath(updated, 2)).toBe("/b.ts");
    // Original unchanged
    expect(findLeafPath(tree, 1)).toBe("/a.ts");
  });

  it("returns same reference when path is unchanged", () => {
    const tree = leaf(1, "/a.ts");
    expect(setLeafPath(tree, 1, "/a.ts")).toBe(tree);
  });

  it("returns same reference when id not found", () => {
    const tree = leaf(1, "/a.ts");
    expect(setLeafPath(tree, 99, "/x.ts")).toBe(tree);
  });
});

describe("editor pane tree: removeLeaf", () => {
  it("returns null when last leaf is removed", () => {
    const tree = leaf(1, "/a.ts");
    expect(removeLeaf(tree, 1)).toBeNull();
  });

  it("collapses split when one child is removed", () => {
    const tree = hSplit(10, leaf(1, "/a.ts"), leaf(2, "/b.ts"));
    const result = removeLeaf(tree, 1);
    expect(result).toMatchObject({ kind: "leaf", id: 2, path: "/b.ts" });
  });

  it("sibling leaf focus after close stays in neighborhood", () => {
    const tree = hSplit(10,
      leaf(1, "/a.ts"),
      leaf(2, "/b.ts"),
      leaf(3, "/c.ts"),
    );
    // Close leaf 2; sibling should be 3 (next) or 1 (prev)
    const sib = siblingLeafOf(tree, 2);
    expect([1, 3]).toContain(sib);
  });

  it("active leaf updates to remaining leaf after closing active pane", () => {
    const tree = hSplit(10, leaf(1, "/a.ts"), leaf(2, "/b.ts"));
    const afterRemove = removeLeaf(tree, 1);
    expect(afterRemove).not.toBeNull();
    if (afterRemove) {
      const remaining = leafIds(afterRemove);
      expect(remaining).toEqual([2]);
    }
  });

  it("hasLeaf returns false after removal", () => {
    const tree = hSplit(10, leaf(1, "/a.ts"), leaf(2, "/b.ts"));
    const result = removeLeaf(tree, 1);
    if (result) {
      expect(hasLeaf(result, 1)).toBe(false);
      expect(hasLeaf(result, 2)).toBe(true);
    }
  });
});

describe("editor pane tree: nested splits", () => {
  it("handles column split within row split", () => {
    const tree = hSplit(10,
      leaf(1, "/a.ts"),
      vSplit(11, leaf(2, "/b.ts"), leaf(3, "/c.ts")),
    );
    expect(leafIds(tree)).toEqual([1, 2, 3]);
    expect(findLeafPath(tree, 3)).toBe("/c.ts");

    const afterRemove = removeLeaf(tree, 2);
    expect(afterRemove).not.toBeNull();
    if (afterRemove) {
      // vSplit collapses to just leaf 3, so tree becomes hSplit([1], [3])
      expect(leafIds(afterRemove)).toEqual([1, 3]);
    }
  });
});
