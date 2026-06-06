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
    ]);
    expect(sidebarViewItemsForSlot("secondary").map((item) => item.id)).toEqual(
      ["code", "chat", "compare", "inbox"],
    );
    expect(SIDEBAR_VIEW_REGISTRY.compare.slot).toBe("secondary");
  });

  it("exposes icon metadata for every rail item", () => {
    expect(sidebarViewMetadataForId("explorer").icon).toBeDefined();
    expect(sidebarViewMetadataForId("source-control").icon).toBeDefined();
    expect(sidebarViewMetadataForId("code").icon).toBeDefined();
    expect(sidebarViewMetadataForId("chat").icon).toBeDefined();
    expect(sidebarViewMetadataForId("compare").icon).toBeDefined();
    expect(sidebarViewMetadataForId("inbox").icon).toBeDefined();
  });
});
