import { describe, expect, it } from "vitest";
import { leafIds, type PaneNode } from "@/modules/terminal/lib/panes";
import {
  applyMovePaneToNewTab,
  planMovePaneToNewTab,
  type Tab,
  type TerminalTab,
} from "./useTabs";

type Leaf = Extract<PaneNode, { kind: "leaf" }>;

function leaf(id: number, cwd?: string, slotId?: number): Leaf {
  return {
    kind: "leaf",
    id,
    ...(cwd && { cwd }),
    ...(slotId !== undefined && { slotId }),
  };
}

function term(id: number, overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id,
    kind: "terminal",
    spaceId: "a",
    title: "shell",
    paneTree: leaf(id * 10),
    activeLeafId: id * 10,
    ...overrides,
  };
}

const moved = leaf(21, "/code/api", 22);

function twoPane(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return term(2, {
    cwd: "/code/web",
    paneTree: {
      kind: "split",
      id: 5,
      dir: "row",
      children: [leaf(20, "/code/web"), moved],
    },
    activeLeafId: 20,
    ...overrides,
  });
}

// row[ 30, col[ 31, 32 ] ]
function threePane(activeLeafId: number): TerminalTab {
  return term(3, {
    cwd: "/code/x",
    paneTree: {
      kind: "split",
      id: 6,
      dir: "row",
      children: [
        leaf(30, "/code/x"),
        {
          kind: "split",
          id: 7,
          dir: "col",
          children: [leaf(31, "/code/y"), leaf(32, "/code/z")],
        },
      ],
    },
    activeLeafId,
  });
}

const editor: Tab = {
  id: 9,
  kind: "editor",
  spaceId: "a",
  title: "a.ts",
  path: "/a.ts",
  dirty: false,
  preview: false,
};

function terminalAt(tabs: Tab[], index: number): TerminalTab {
  const tab = tabs[index];
  if (tab.kind !== "terminal") throw new Error("expected terminal tab");
  return tab;
}

describe("planMovePaneToNewTab", () => {
  it("accepts a pane of a split terminal tab", () => {
    const plan = planMovePaneToNewTab([twoPane()], 2, 21);
    expect(plan.ok && plan.leaf).toBe(moved);
  });

  it.each([
    ["tab-missing", [twoPane()], 99, 21],
    ["tab-not-terminal", [editor], 9, 21],
    ["leaf-missing", [twoPane()], 2, 99],
    ["single-pane", [term(1)], 1, 10],
  ] as const)("rejects %s", (reason, tabs, tabId, leafId) => {
    expect(planMovePaneToNewTab([...tabs], tabId, leafId)).toEqual({
      ok: false,
      reason,
    });
  });
});

describe("applyMovePaneToNewTab", () => {
  it("wraps the exact leaf node in a new tab, keeping its id", () => {
    const next = applyMovePaneToNewTab([twoPane()], 2, 21, 50);
    expect(next).not.toBeNull();
    const created = terminalAt(next as Tab[], 1);
    expect(created.id).toBe(50);
    expect(created.paneTree).toBe(moved);
    expect(created.activeLeafId).toBe(21);
    expect(created.cwd).toBe("/code/api");
    expect(created.customTitle).toBeUndefined();
    expect(created.cold).toBeUndefined();
  });

  it("collapses a two-pane source to its remaining leaf", () => {
    const next = applyMovePaneToNewTab([twoPane()], 2, 21, 50) as Tab[];
    const source = terminalAt(next, 0);
    expect(source.paneTree).toEqual(leaf(20, "/code/web"));
    expect(source.activeLeafId).toBe(20);
    expect(source.cwd).toBe("/code/web");
  });

  it("collapses the nested split of a three-pane source", () => {
    const next = applyMovePaneToNewTab([threePane(30)], 3, 32, 50) as Tab[];
    const source = terminalAt(next, 0);
    expect(source.paneTree).toEqual({
      kind: "split",
      id: 6,
      dir: "row",
      children: [leaf(30, "/code/x"), leaf(31, "/code/y")],
    });
    expect(source.activeLeafId).toBe(30);
    expect(leafIds(terminalAt(next, 1).paneTree)).toEqual([32]);
  });

  it("focuses a sibling and mirrors its cwd when the active pane moves", () => {
    const next = applyMovePaneToNewTab([threePane(31)], 3, 31, 50) as Tab[];
    const source = terminalAt(next, 0);
    expect(source.activeLeafId).toBe(32);
    expect(source.cwd).toBe("/code/z");
  });

  it("keeps the source focus when another pane moves", () => {
    const next = applyMovePaneToNewTab([threePane(30)], 3, 31, 50) as Tab[];
    const source = terminalAt(next, 0);
    expect(source.activeLeafId).toBe(30);
    expect(source.cwd).toBe("/code/x");
  });

  it("inherits space, blocks and private from the source", () => {
    const tabs = [twoPane({ spaceId: "b", blocks: true, private: true })];
    const created = terminalAt(
      applyMovePaneToNewTab(tabs, 2, 21, 50) as Tab[],
      1,
    );
    expect(created.spaceId).toBe("b");
    expect(created.blocks).toBe(true);
    expect(created.private).toBe(true);
    expect(created.title).toBe("private");
  });

  it("does not copy the source custom title", () => {
    const tabs = [twoPane({ customTitle: "Agents" })];
    const created = terminalAt(
      applyMovePaneToNewTab(tabs, 2, 21, 50) as Tab[],
      1,
    );
    expect(created.customTitle).toBeUndefined();
  });

  it("falls back to the source cwd when the leaf has none", () => {
    const tabs = [
      twoPane({
        paneTree: {
          kind: "split",
          id: 5,
          dir: "row",
          children: [leaf(20, "/code/web"), leaf(21)],
        },
      }),
    ];
    const created = terminalAt(
      applyMovePaneToNewTab(tabs, 2, 21, 50) as Tab[],
      1,
    );
    expect(created.cwd).toBe("/code/web");
  });

  it("places the new tab right after the source", () => {
    const tabs = [term(1), twoPane(), editor];
    const next = applyMovePaneToNewTab(tabs, 2, 21, 50) as Tab[];
    expect(next.map((t) => t.id)).toEqual([1, 2, 50, 9]);
    expect(next[0]).toBe(tabs[0]);
    expect(next[3]).toBe(tabs[2]);
  });

  it("keeps every leaf id live across the move", () => {
    const tabs = [term(1), threePane(31)];
    const before = tabs.flatMap((t) => leafIds(t.paneTree)).sort();
    const next = applyMovePaneToNewTab(tabs, 3, 31, 50) as Tab[];
    const after = next
      .flatMap((t) => (t.kind === "terminal" ? leafIds(t.paneTree) : []))
      .sort();
    expect(after).toEqual(before);
  });

  it("returns null for a rejected move", () => {
    expect(applyMovePaneToNewTab([term(1)], 1, 10, 50)).toBeNull();
  });
});
