import { describe, expect, it } from "vitest";
import { planCloseOtherTabs, type Tab } from "./useTabs";

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

describe("planCloseOtherTabs", () => {
  it("collects every other tab within the same space", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseOtherTabs(tabs, 2, 2)).toEqual({
      closeIds: [1, 3],
      nextActiveId: 2,
    });
  });

  it("skips tabs in other spaces", () => {
    const tabs = [tab(1, "a"), tab(2, "b"), tab(3, "a")];
    expect(planCloseOtherTabs(tabs, 3, 2)).toEqual({
      closeIds: [1],
      nextActiveId: 2,
    });
  });

  it("returns nothing when the anchor is the only tab of its space", () => {
    const tabs = [tab(1, "a"), tab(2, "b")];
    expect(planCloseOtherTabs(tabs, 1, 2)).toEqual({
      closeIds: [],
      nextActiveId: 2,
    });
  });

  it("falls back to the anchor when the active tab is being closed", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseOtherTabs(tabs, 1, 3)).toEqual({
      closeIds: [2, 3],
      nextActiveId: 1,
    });
  });

  it("keeps the active tab when it is not among the closed", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseOtherTabs(tabs, 2, 2)).toEqual({
      closeIds: [1, 3],
      nextActiveId: 2,
    });
  });

  it("returns nothing for an unknown anchor", () => {
    const tabs = [tab(1, "a")];
    expect(planCloseOtherTabs(tabs, 99, 1)).toEqual({
      closeIds: [],
      nextActiveId: 1,
    });
  });
});
