import { describe, expect, it } from "vitest";
import { isSidebarViewId, SIDEBAR_VIEW_ITEMS } from "./views";

describe("sidebar views", () => {
  it("registers Files, Git, and Pi in rail order", () => {
    expect(SIDEBAR_VIEW_ITEMS.map((item) => [item.id, item.label])).toEqual([
      ["explorer", "Files"],
      ["source-control", "Git"],
      ["pi", "Pi"],
    ]);
  });

  it("recognizes the persisted Pi sidebar view", () => {
    expect(isSidebarViewId("pi")).toBe(true);
    expect(isSidebarViewId("missing")).toBe(false);
  });
});
