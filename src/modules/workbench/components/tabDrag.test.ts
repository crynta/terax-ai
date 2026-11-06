import { describe, expect, it } from "vitest";
import { type DropElement, resolveDropTarget } from "./tabDrag";

type Node = {
  dataset?: Record<string, string>;
  rect?: { left: number; top: number; width: number; height: number };
  matches?: string;
  parent?: Node;
  children?: Node[];
};

function el(node: Node): DropElement {
  const self: DropElement = {
    dataset: node.dataset ?? {},
    closest: (selector) => {
      for (let n: Node | undefined = node; n; n = n.parent)
        if (n.matches === selector) return el(n);
      return null;
    },
    querySelectorAll: () => (node.children ?? []).map(el),
    getBoundingClientRect: () =>
      node.rect ?? { left: 0, top: 0, width: 0, height: 0 },
  };
  return self;
}

const header: Node = {
  matches: "[data-card-header]",
  dataset: { cardHeader: "7" },
  children: [
    { rect: { left: 0, top: 0, width: 100, height: 24 } },
    { rect: { left: 100, top: 0, width: 100, height: 24 } },
  ],
};
const body: Node = {
  matches: "[data-tab-slot]",
  dataset: { tabSlot: "42" },
  rect: { left: 0, top: 0, width: 400, height: 200 },
};
const cardOf = (tabId: number) => (tabId === 42 ? 9 : null);

describe("resolveDropTarget", () => {
  it("inserts at the gap under the pointer on a card header", () => {
    const pill = el({ parent: header });
    expect(resolveDropTarget(pill, 40, 10, cardOf)).toEqual({
      cardId: 7,
      zone: "stack",
      index: 0,
    });
    expect(resolveDropTarget(pill, 160, 10, cardOf)).toMatchObject({
      index: 2,
    });
  });

  it("stacks in a body's middle and splits near its edges", () => {
    const inside = el({ parent: body });
    expect(resolveDropTarget(inside, 200, 100, cardOf)).toEqual({
      cardId: 9,
      zone: "stack",
    });
    expect(resolveDropTarget(inside, 20, 100, cardOf)?.zone).toBe("left");
    expect(resolveDropTarget(inside, 200, 190, cardOf)?.zone).toBe("bottom");
  });

  it("has no target outside cards or over an unknown tab", () => {
    expect(resolveDropTarget(null, 0, 0, cardOf)).toBeNull();
    expect(resolveDropTarget(el({}), 0, 0, cardOf)).toBeNull();
    const stray = el({ parent: { ...body, dataset: { tabSlot: "5" } } });
    expect(resolveDropTarget(stray, 10, 10, cardOf)).toBeNull();
  });
});
