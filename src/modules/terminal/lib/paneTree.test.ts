import { describe, expect, it } from "vitest";
import {
  findLeafCwd,
  firstLeafSlotId,
  leafIds,
  nextLeafId,
  removeLeaf,
  setLeafCwd,
  siblingLeafOf,
  splitLeaf,
  type PaneNode,
} from "./panes";

function row(...children: PaneNode[]): PaneNode {
  return { kind: "split", id: 100 + children.length, dir: "row", children };
}

const leafA: PaneNode = { kind: "leaf", id: 1, slotId: 11, cwd: "/a" };
const leafB: PaneNode = { kind: "leaf", id: 2, cwd: "/b" };

describe("splitLeaf", () => {
  it("appends as a sibling when the enclosing split already runs that way", () => {
    const tree = row(leafA, leafB);
    const out = splitLeaf(tree, 1, 50, 3, "row");

    expect(leafIds(out)).toEqual([1, 3, 2]);
    expect(out).toMatchObject({ kind: "split" });
  });

  it("creates a nested perpendicular split otherwise", () => {
    const tree = row(leafA, leafB);
    const out = splitLeaf(tree, 1, 50, 3, "col");
    expect(out.kind).toBe("split");

    const first = (out as Extract<PaneNode, { kind: "split" }>).children[0];
    expect(first).toEqual({
      kind: "split",
      id: 50,
      dir: "col",
      children: [leafA, { kind: "leaf", id: 3 }],
    });
  });

  it("carries the new leaf's cwd and leaves other branches untouched", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 9,
      dir: "col",
      children: [leafA, row(leafB, { kind: "leaf", id: 4 })],
    };
    const out = splitLeaf(tree, 2, 50, 5, "row", "/new");

    expect(findLeafCwd(out, 5)).toBe("/new");
    expect(findLeafCwd(out, 1)).toBe("/a");
  });
});

describe("removeLeaf", () => {
  it("collapses single-child splits left behind", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 9,
      dir: "col",
      children: [leafA, row(leafB)],
    };

    const out = removeLeaf(tree, 2);

    expect(out).toBe(leafA);
  });

  it("returns null when the last leaf is removed", () => {
    expect(removeLeaf(leafA, 1)).toBeNull();
    expect(removeLeaf(row(leafA, leafB), 1)).toEqual(leafB);
  });
});

describe("nextLeafId", () => {
  it("wraps at both ends of the tree", () => {
    const tree = row(leafA, leafB);
    expect(nextLeafId(tree, 1, 1)).toBe(2);
    expect(nextLeafId(tree, 2, 1)).toBe(1);
    expect(nextLeafId(tree, 1, -1)).toBe(2);
  });

  it("falls back to the first leaf for unknown or empty trees", () => {
    expect(nextLeafId(row(leafA, leafB), 99, 1)).toBe(1);
    expect(nextLeafId(leafA, 1, 1)).toBe(1);
  });
});

describe("siblingLeafOf", () => {
  it("prefers the next sibling then the previous one", () => {
    const tree = row(leafA, leafB, { kind: "leaf", id: 3 });
    expect(siblingLeafOf(tree, 1)).toBe(2);
    expect(siblingLeafOf(tree, 3)).toBe(2);
  });

  it("descends into nested splits for the closest neighbor", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 9,
      dir: "col",
      children: [leafA, row(leafB, { kind: "leaf", id: 4 })],
    };
    expect(siblingLeafOf(tree, 2)).toBe(4);
    expect(siblingLeafOf(tree, 1)).toBe(2);
  });
});

describe("cwd helpers", () => {
  it("finds a leaf cwd anywhere in the tree", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 9,
      dir: "row",
      children: [leafA, leafB],
    };
    expect(findLeafCwd(tree, 2)).toBe("/b");
    expect(findLeafCwd(tree, 42)).toBeUndefined();
  });

  it("updates the matching leaf only and preserves identity elsewhere", () => {
    const tree = row(leafA, leafB);
    const out = setLeafCwd(tree, 1, "/changed");

    expect(findLeafCwd(out, 1)).toBe("/changed");
    expect((out as Extract<PaneNode, { kind: "split" }>).children[1]).toBe(leafB);
  });

  it("returns the same node when nothing changes", () => {
    expect(setLeafCwd(leafA, 1, "/a")).toBe(leafA);
    expect(setLeafCwd(leafA, 99, "/x")).toBe(leafA);
  });
});

describe("firstLeafSlotId", () => {
  it("prefers an explicit slotId over the leaf id", () => {
    expect(firstLeafSlotId(row({ kind: "leaf", id: 7 }, leafA))).toBe(7);
    expect(firstLeafSlotId(row(leafA, leafB))).toBe(11);
  });
});
