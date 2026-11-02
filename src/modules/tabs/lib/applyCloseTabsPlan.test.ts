import { describe, expect, it } from "vitest";
import {
  applyCloseTabsPlan,
  planCloseTabsToRight,
  planSingleTabClose,
  type Tab,
} from "./useTabs";

function editor(id: number, spaceId = "a"): Tab {
  return {
    id,
    kind: "editor",
    spaceId,
    title: `file-${id}`,
    path: `/file-${id}`,
    dirty: false,
    preview: false,
  };
}

function terminal(id: number, leafId: number, spaceId = "a"): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: leafId },
    activeLeafId: leafId,
  };
}

describe("applyCloseTabsPlan", () => {
  it("plans single-tab cleanup before React schedules any state update", () => {
    const tabs = [terminal(1, 10), terminal(2, 20), editor(3, "b")];
    const first = planSingleTabClose(tabs, 2, 2);
    if (!first) throw new Error("Expected terminal close plan");
    expect(first?.disposeLeafIds).toEqual([20]);
    expect(first?.nextActiveId).toBe(1);
    expect(first?.tabs.map((tab) => tab.id)).toEqual([1, 3]);
    expect(planSingleTabClose(first.tabs, 2, 1)).toBeNull();
    expect(planSingleTabClose(first.tabs, 1, 1)).toBeNull();
    expect(tabs).toHaveLength(3);
  });

  it("preserves the active tab when closing a background editor", () => {
    const result = planSingleTabClose(
      [terminal(1, 10), editor(2), editor(3, "b")],
      2,
      3,
    );
    expect(result?.nextActiveId).toBe(3);
    expect(result?.disposeLeafIds).toEqual([]);
  });

  it("returns every split leaf of the closed terminal without touching its neighbor", () => {
    const split: Tab = {
      ...terminal(2, 20),
      kind: "terminal",
      activeLeafId: 20,
      paneTree: {
        kind: "split",
        id: 99,
        dir: "row",
        children: [
          { kind: "leaf", id: 20 },
          { kind: "leaf", id: 21 },
        ],
      },
    };
    expect(
      planSingleTabClose([terminal(1, 10), split], 2, 1)?.disposeLeafIds,
    ).toEqual([20, 21]);
  });

  it("closes exactly the planned tabs and returns terminal leaves to dispose", () => {
    const tabs = [terminal(1, 10), terminal(2, 20), editor(3), editor(4)];
    const result = applyCloseTabsPlan(tabs, 1, {
      closeIds: [2, 3],
      nextActiveId: 1,
    });

    expect(result?.tabs.map((tab) => tab.id)).toEqual([1, 4]);
    expect(result?.closeIds).toEqual([2, 3]);
    expect(result?.disposeLeafIds).toEqual([20]);
    expect(result?.nextActiveId).toBe(1);
  });

  it("does not sweep in a tab added after the close range was planned", () => {
    const original = [editor(1), editor(2), editor(3)];
    const plan = planCloseTabsToRight(original, 1, 1);
    const current = [...original, editor(4)];

    expect(
      applyCloseTabsPlan(current, 1, plan)?.tabs.map((tab) => tab.id),
    ).toEqual([1, 4]);
  });

  it("does not close a planned tab that moved to another space", () => {
    const tabs = [editor(1), editor(2), editor(3, "b")];
    const result = applyCloseTabsPlan(tabs, 1, {
      closeIds: [2, 3],
      nextActiveId: 1,
    });

    expect(result?.tabs.map((tab) => tab.id)).toEqual([1, 3]);
    expect(result?.closeIds).toEqual([2]);
  });

  it("falls back to the anchor when the planned active tab is unavailable", () => {
    const result = applyCloseTabsPlan([editor(1), editor(2)], 1, {
      closeIds: [2],
      nextActiveId: 2,
    });

    expect(result?.nextActiveId).toBe(1);
  });

  it("does nothing when the anchor no longer exists", () => {
    expect(
      applyCloseTabsPlan([editor(2)], 1, {
        closeIds: [2],
        nextActiveId: 1,
      }),
    ).toBeNull();
  });
});
