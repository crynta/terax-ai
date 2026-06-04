import { describe, expect, it } from "vitest";
import {
  isPrimarySidebarViewId,
  isSecondarySidebarViewId,
  isSidebarViewId,
  normalizePrimarySidebarView,
  normalizeSecondarySidebarView,
  PRIMARY_SIDEBAR_VIEW_ITEMS,
  SECONDARY_SIDEBAR_VIEW_ITEMS,
  SIDEBAR_VIEW_ITEMS,
} from "./views";

describe("sidebar views", () => {
  it("keeps the primary sidebar limited to Files and Git", () => {
    expect(
      PRIMARY_SIDEBAR_VIEW_ITEMS.map((item) => [item.id, item.label]),
    ).toEqual([
      ["explorer", "Files"],
      ["source-control", "Git"],
    ]);
  });

  it("keeps the secondary sidebar limited to Code, Chat, and Inbox", () => {
    expect(
      SECONDARY_SIDEBAR_VIEW_ITEMS.map((item) => [item.id, item.label]),
    ).toEqual([
      ["code", "Code"],
      ["chat", "Chat"],
      ["inbox", "Inbox"],
    ]);
  });

  it("registers all sidebar views without legacy Pi as a rail item", () => {
    expect(SIDEBAR_VIEW_ITEMS.map((item) => item.id)).toEqual([
      "explorer",
      "source-control",
      "code",
      "chat",
      "inbox",
    ]);
    expect(isSidebarViewId("pi")).toBe(false);
    expect(isSidebarViewId("code")).toBe(true);
    expect(isSidebarViewId("missing")).toBe(false);
  });

  it("normalizes persisted views per sidebar slot", () => {
    expect(isPrimarySidebarViewId("explorer")).toBe(true);
    expect(isPrimarySidebarViewId("code")).toBe(false);
    expect(isSecondarySidebarViewId("code")).toBe(true);
    expect(isSecondarySidebarViewId("source-control")).toBe(false);
    expect(normalizePrimarySidebarView("code")).toBe("explorer");
    expect(normalizeSecondarySidebarView("pi")).toBe("code");
    expect(normalizeSecondarySidebarView("source-control")).toBe("code");
  });
});
