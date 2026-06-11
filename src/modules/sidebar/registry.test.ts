import { describe, expect, it } from "vitest";
import {
  SIDEBAR_VIEW_REGISTRY,
  sidebarViewItemsForSlot,
  sidebarViewMetadataForId,
} from "./registry";

describe("sidebar registry", () => {
  it("keeps sidebar labels and slots in one source of truth", () => {
    expect(sidebarViewItemsForSlot("primary").map((item) => item.id)).toEqual([
      "explorer",
      "source-control",
      "automation",
      "agent-manager",
      "skill-browser",
    ]);
    expect(sidebarViewItemsForSlot("secondary").map((item) => item.id)).toEqual(
      ["code", "chat", "compare", "inbox"],
    );
    expect(SIDEBAR_VIEW_REGISTRY.compare.slot).toBe("secondary");
  });

  it("exposes icon metadata for every rail item", () => {
    for (const id of Object.keys(SIDEBAR_VIEW_REGISTRY) as Array<
      keyof typeof SIDEBAR_VIEW_REGISTRY
    >) {
      expect(sidebarViewMetadataForId(id).icon).toBeDefined();
    }
  });
});
