import { describe, expect, it } from "vitest";
import {
  defaultSidebarVisibility,
  oppositeSidebarPosition,
  orderSidebarLayout,
  resolveSidebarViewSelection,
} from "./layout";

describe("sidebar layout", () => {
  it("places the secondary sidebar opposite the primary sidebar", () => {
    expect(orderSidebarLayout("left")).toEqual([
      "primary-sidebar",
      "workspace",
      "secondary-sidebar",
    ]);
    expect(orderSidebarLayout("right")).toEqual([
      "secondary-sidebar",
      "workspace",
      "primary-sidebar",
    ]);
  });

  it("finds the opposite sidebar position", () => {
    expect(oppositeSidebarPosition("left")).toBe("right");
    expect(oppositeSidebarPosition("right")).toBe("left");
  });

  it("updates each sidebar view independently", () => {
    expect(
      resolveSidebarViewSelection(
        { primary: "explorer", secondary: "code" },
        "primary",
        "source-control",
      ),
    ).toEqual({ primary: "source-control", secondary: "code" });

    expect(
      resolveSidebarViewSelection(
        { primary: "source-control", secondary: "code" },
        "secondary",
        "chat",
      ),
    ).toEqual({ primary: "source-control", secondary: "chat" });
  });

  it("keeps the secondary sidebar collapsed by default unless restored", () => {
    expect(defaultSidebarVisibility("primary", null)).toBe(true);
    expect(defaultSidebarVisibility("secondary", null)).toBe(false);
    expect(defaultSidebarVisibility("secondary", true)).toBe(true);
    expect(defaultSidebarVisibility("secondary", false)).toBe(false);
  });
});
