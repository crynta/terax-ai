import { describe, expect, it } from "vitest";
import {
  card,
  cardIds,
  computeFrames,
  findCard,
  insertCardBeside,
  type LayoutNode,
  MIN_RATIO,
  neighborCard,
  removeCard,
  shiftBoundary,
  split,
  swapCardContents,
} from "./layout";

function alloc(start = 100) {
  let id = start;
  return () => id++;
}

describe("insertCardBeside", () => {
  it("turns a lone card into a two-way split", () => {
    const next = insertCardBeside(
      card(1, [10]),
      1,
      card(2, [20]),
      "row",
      "after",
      alloc(),
    );
    expect(next).toMatchObject({
      kind: "split",
      dir: "row",
      ratios: [0.5, 0.5],
    });
    expect(cardIds(next)).toEqual([1, 2]);
  });

  it("joins a split on the same axis, halving the target's share", () => {
    const tree = split(9, "row", [card(1, [10]), card(2, [20])], [0.6, 0.4]);
    const next = insertCardBeside(
      tree,
      1,
      card(3, [30]),
      "row",
      "after",
      alloc(),
    );
    expect(next.kind === "split" && next.children.length).toBe(3);
    expect(cardIds(next)).toEqual([1, 3, 2]);
    expect(next.kind === "split" && next.ratios).toEqual([0.3, 0.3, 0.4]);
  });

  it("nests a cross-axis split in place of the target", () => {
    const tree = split(9, "row", [card(1, [10]), card(2, [20])]);
    const next = insertCardBeside(
      tree,
      2,
      card(3, [30]),
      "col",
      "before",
      alloc(),
    );
    if (next.kind !== "split") throw new Error("split expected");
    expect(next.children[1]).toMatchObject({ kind: "split", dir: "col" });
    expect(cardIds(next)).toEqual([1, 3, 2]);
  });

  it("leaves untouched subtrees shared", () => {
    const left = split(8, "col", [card(1, [10]), card(2, [20])]);
    const tree = split(9, "row", [left, card(3, [30])]);
    const next = insertCardBeside(
      tree,
      3,
      card(4, [40]),
      "col",
      "after",
      alloc(),
    );
    expect(next.kind === "split" && next.children[0]).toBe(left);
  });
});

describe("removeCard", () => {
  it("gives the removed share to the remaining siblings", () => {
    const tree = split(
      9,
      "row",
      [card(1, [10]), card(2, [20]), card(3, [30])],
      [0.5, 0.25, 0.25],
    );
    const next = removeCard(tree, 2);
    expect(next?.kind === "split" && next.ratios).toEqual([
      0.5 / 0.75,
      0.25 / 0.75,
    ]);
  });

  it("collapses a single remaining child into its parent", () => {
    const tree = split(9, "row", [card(1, [10]), card(2, [20])]);
    expect(removeCard(tree, 2)).toEqual(card(1, [10]));
  });

  it("merges a collapsed split that runs along its parent's axis", () => {
    const inner = split(8, "col", [
      card(2, [20]),
      split(7, "row", [card(3, [30]), card(4, [40])]),
    ]);
    const tree = split(9, "row", [card(1, [10]), inner], [0.5, 0.5]);
    const next = removeCard(tree, 2);
    if (next?.kind !== "split") throw new Error("split expected");
    expect(next.dir).toBe("row");
    expect(cardIds(next)).toEqual([1, 3, 4]);
    expect(next.ratios).toEqual([0.5, 0.25, 0.25]);
  });

  it("returns null when the last card goes", () => {
    expect(removeCard(card(1, [10]), 1)).toBeNull();
  });
});

describe("computeFrames", () => {
  const tree: LayoutNode = split(
    9,
    "row",
    [
      card(1, [10]),
      split(8, "col", [card(2, [20]), card(3, [30])], [0.25, 0.75]),
    ],
    [0.4, 0.6],
  );

  it("tiles the root exactly", () => {
    const { cards } = computeFrames(tree);
    expect(cards.get(1)).toEqual({ x: 0, y: 0, w: 0.4, h: 1 });
    expect(cards.get(2)).toEqual({ x: 0.4, y: 0, w: 0.6, h: 0.25 });
    expect(cards.get(3)).toEqual({ x: 0.4, y: 0.25, w: 0.6, h: 0.75 });
  });

  it("reports one divider per boundary", () => {
    const { dividers } = computeFrames(tree);
    expect(dividers.map((d) => [d.splitId, d.index, d.at])).toEqual([
      [9, 1, 0.4],
      [8, 1, 0.25],
    ]);
  });
});

describe("neighborCard", () => {
  const frames = computeFrames(
    split(9, "row", [
      card(1, [10]),
      split(8, "col", [card(2, [20]), card(3, [30])], [0.3, 0.7]),
    ]),
  ).cards;

  it("moves across an edge to the card sharing most of it", () => {
    expect(neighborCard(frames, 1, "right")).toBe(3);
    expect(neighborCard(frames, 2, "left")).toBe(1);
    expect(neighborCard(frames, 2, "down")).toBe(3);
    expect(neighborCard(frames, 3, "up")).toBe(2);
  });

  it("returns null at the layout's edge", () => {
    expect(neighborCard(frames, 1, "left")).toBeNull();
    expect(neighborCard(frames, 3, "down")).toBeNull();
  });
});

describe("shiftBoundary", () => {
  it("moves only the two neighbours of the boundary", () => {
    const [a, b, c] = shiftBoundary([0.2, 0.3, 0.5], 1, 0.1);
    expect(a).toBeCloseTo(0.3);
    expect(b).toBeCloseTo(0.2);
    expect(c).toBe(0.5);
  });

  it("never shrinks a child below the minimum share", () => {
    const [a, b] = shiftBoundary([0.5, 0.5], 1, 0.9);
    expect(b).toBeCloseTo(MIN_RATIO);
    expect(a + b).toBeCloseTo(1);
  });
});

it("swaps what two cards hold without changing the tree", () => {
  const tree = split(9, "row", [card(1, [10, 11], 11), card(2, [20])]);
  const next = swapCardContents(tree, 1, 2);
  expect(findCard(next, 1)).toMatchObject({ tabIds: [20], activeTabId: 20 });
  expect(findCard(next, 2)).toMatchObject({
    tabIds: [10, 11],
    activeTabId: 11,
  });
});
