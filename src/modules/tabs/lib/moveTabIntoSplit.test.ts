import { describe, expect, it } from "vitest";
import { leafIds, type PaneNode } from "@/modules/terminal/lib/panes";
import {
  applyMoveTabIntoSplit,
  moveToSplitTargets,
  planMoveTabIntoSplit,
  type Tab,
  type TerminalTab,
} from "./useTabs";

function term(
  id: number,
  overrides: Partial<TerminalTab> = {},
  spaceId = "a",
): TerminalTab {
  const leaf = id * 10;
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: leaf },
    activeLeafId: leaf,
    ...overrides,
  };
}

function row(id: number, ...ids: number[]): PaneNode {
  return {
    kind: "split",
    id,
    dir: "row",
    children: ids.map((leaf) => ({ kind: "leaf", id: leaf })),
  };
}

const editor: Tab = {
  id: 9,
  kind: "editor",
  spaceId: "a",
  title: "file.ts",
  path: "/file.ts",
  dirty: false,
  preview: false,
};

function destinationOf(tabs: Tab[] | null, id: number): TerminalTab {
  const tab = tabs?.find((t) => t.id === id);
  if (tab?.kind !== "terminal") throw new Error("destination missing");
  return tab;
}

describe("planMoveTabIntoSplit", () => {
  it("accepts a single-pane terminal moving into a compatible tab", () => {
    const plan = planMoveTabIntoSplit([term(1), term(2)], 2, 1);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.leaf).toEqual({ kind: "leaf", id: 20 });
  });

  it.each([
    ["same-tab", [term(1), term(2)], 1, 1],
    ["source-missing", [term(1)], 5, 1],
    ["destination-missing", [term(1)], 1, 5],
    ["source-not-terminal", [term(1), editor], 9, 1],
    ["destination-not-terminal", [term(1), editor], 1, 9],
    [
      "source-multi-pane",
      [term(1), term(2, { paneTree: row(99, 20, 21) })],
      2,
      1,
    ],
    ["different-space", [term(1), term(2, {}, "b")], 2, 1],
    ["blocks-mismatch", [term(1), term(2, { blocks: true })], 2, 1],
    [
      "blocks-mismatch",
      [term(1, { blocks: true }), term(2, { blocks: false })],
      2,
      1,
    ],
    [
      "blocks-unsplittable",
      [term(1, { blocks: true }), term(2, { blocks: true })],
      2,
      1,
    ],
    ["private-mismatch", [term(1), term(2, { private: true })], 2, 1],
    [
      "pane-limit",
      [
        term(1, {
          paneTree: row(99, 10, 11, 12, 13),
        }),
        term(2),
      ],
      2,
      1,
    ],
  ] as const)("rejects %s", (reason, tabs, source, destination) => {
    expect(planMoveTabIntoSplit([...tabs], source, destination)).toEqual({
      ok: false,
      reason,
    });
  });

  it("treats undefined and false flags as equal", () => {
    const tabs = [
      term(1, { blocks: false, private: false }),
      term(2, { blocks: undefined, private: undefined }),
    ];
    expect(planMoveTabIntoSplit(tabs, 2, 1).ok).toBe(true);
  });

  it("allows filling the destination up to the pane cap", () => {
    const tabs = [term(1, { paneTree: row(99, 10, 11, 12) }), term(2)];
    expect(planMoveTabIntoSplit(tabs, 2, 1).ok).toBe(true);
  });
});

describe("moveToSplitTargets", () => {
  it("lists only compatible destinations", () => {
    const tabs: Tab[] = [
      term(1),
      term(2),
      term(3, { private: true }),
      term(4, {}, "b"),
      editor,
      term(5, { paneTree: row(99, 50, 51, 52, 53) }),
      term(6),
    ];
    expect(moveToSplitTargets(tabs, 2).map((t) => t.id)).toEqual([1, 6]);
  });

  it("returns nothing for a multi-pane source", () => {
    const tabs = [term(1), term(2, { paneTree: row(99, 20, 21) })];
    expect(moveToSplitTargets(tabs, 2)).toEqual([]);
  });
});

describe("applyMoveTabIntoSplit", () => {
  it("removes the source and grafts its leaf with the same id", () => {
    const leaf = { kind: "leaf", id: 20, slotId: 7, cwd: "/src" } as const;
    const tabs = [term(1), term(2, { paneTree: leaf }), term(3)];
    const next = applyMoveTabIntoSplit(tabs, 2, 1, "right", 500);
    expect(next?.map((t) => t.id)).toEqual([1, 3]);
    const dest = destinationOf(next, 1);
    expect(leafIds(dest.paneTree)).toEqual([10, 20]);
    expect(dest.paneTree.kind === "split" && dest.paneTree.children[1]).toBe(
      leaf,
    );
    expect(dest.activeLeafId).toBe(20);
  });

  it.each([
    ["left", "row", [20, 10]],
    ["right", "row", [10, 20]],
    ["top", "col", [20, 10]],
    ["bottom", "col", [10, 20]],
  ] as const)(
    "orders the moved leaf %s of the target",
    (position, dir, ids) => {
      const next = applyMoveTabIntoSplit(
        [term(1), term(2)],
        2,
        1,
        position,
        500,
      );
      const dest = destinationOf(next, 1);
      expect(dest.paneTree).toMatchObject({ kind: "split", id: 500, dir });
      expect(leafIds(dest.paneTree)).toEqual(ids);
    },
  );

  it("splits beside the destination's active leaf", () => {
    const tabs = [
      term(1, { paneTree: row(99, 10, 11, 12), activeLeafId: 11 }),
      term(2),
    ];
    const dest = destinationOf(
      applyMoveTabIntoSplit(tabs, 2, 1, "left", 500),
      1,
    );
    expect(leafIds(dest.paneTree)).toEqual([10, 20, 11, 12]);
  });

  it("takes the moved leaf's cwd, falling back to the source tab's", () => {
    const withLeafCwd = applyMoveTabIntoSplit(
      [
        term(1, { cwd: "/dest" }),
        term(2, {
          cwd: "/tab",
          paneTree: { kind: "leaf", id: 20, cwd: "/leaf" },
        }),
      ],
      2,
      1,
      "right",
      500,
    );
    expect(destinationOf(withLeafCwd, 1).cwd).toBe("/leaf");

    const withTabCwd = applyMoveTabIntoSplit(
      [term(1, { cwd: "/dest" }), term(2, { cwd: "/tab" })],
      2,
      1,
      "right",
      500,
    );
    expect(destinationOf(withTabCwd, 1).cwd).toBe("/tab");

    const withDestCwd = applyMoveTabIntoSplit(
      [term(1, { cwd: "/dest" }), term(2)],
      2,
      1,
      "right",
      500,
    );
    expect(destinationOf(withDestCwd, 1).cwd).toBe("/dest");
  });

  it("keeps the destination's cold flag for the activation path to warm", () => {
    const next = applyMoveTabIntoSplit(
      [term(1, { cold: true }), term(2)],
      2,
      1,
      "right",
      500,
    );
    expect(destinationOf(next, 1).cold).toBe(true);
  });

  it("returns null when the plan is rejected", () => {
    const tabs = [term(1), term(2, { private: true })];
    expect(applyMoveTabIntoSplit(tabs, 2, 1, "right", 500)).toBeNull();
  });
});
