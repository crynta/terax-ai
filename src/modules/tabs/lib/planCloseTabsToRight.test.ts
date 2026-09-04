import { describe, expect, it } from "vitest";
import { planCloseTabsToRight, type Tab } from "./useTabs";

function tab(id: number, spaceId: string, kind: Tab["kind"] = "editor"): Tab {
  return {
    id,
    kind,
    spaceId,
    title: `tab-${id}`,
    path: `/file-${id}`,
    dirty: false,
    preview: false,
  } as Tab;
}

describe("planCloseTabsToRight", () => {
  it("collects tabs strictly to the right within the same space", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseTabsToRight(tabs, 1, 1)).toEqual({
      closeIds: [2, 3],
      nextActiveId: 1,
    });
  });

  it("skips tabs in other spaces", () => {
    const tabs = [tab(1, "a"), tab(2, "b"), tab(3, "a")];
    expect(planCloseTabsToRight(tabs, 1, 2)).toEqual({
      closeIds: [3],
      nextActiveId: 2,
    });
  });

  it("returns nothing when the anchor is the last tab of its space", () => {
    const tabs = [tab(1, "a"), tab(2, "a")];
    expect(planCloseTabsToRight(tabs, 2, 1)).toEqual({
      closeIds: [],
      nextActiveId: 1,
    });
  });

  it("falls back to the anchor when the active tab is being closed", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseTabsToRight(tabs, 1, 3)).toEqual({
      closeIds: [2, 3],
      nextActiveId: 1,
    });
  });

  it("keeps the active tab when it is not among the closed", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseTabsToRight(tabs, 2, 1)).toEqual({
      closeIds: [3],
      nextActiveId: 1,
    });
  });

  it("returns nothing for an unknown anchor", () => {
    const tabs = [tab(1, "a")];
    expect(planCloseTabsToRight(tabs, 99, 1)).toEqual({
      closeIds: [],
      nextActiveId: 1,
    });
  });
});
