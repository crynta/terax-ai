import { describe, expect, it } from "vitest";
import {
  normalizeSidebarPosition,
  tooltipSideForSidebar,
} from "@/modules/sidebar/position";

describe("sidebar position", () => {
  it.each([
    ["left", "left"],
    ["right", "right"],
    ["bottom", "left"],
    [null, "left"],
    [undefined, "left"],
    [true, "left"],
  ] as const)("normalizes %j to %s", (input, expected) => {
    expect(normalizeSidebarPosition(input)).toBe(expected);
  });

  it.each([
    ["left", "right"],
    ["right", "left"],
  ] as const)("places tooltips toward the center for %s sidebar", (position, expected) => {
    expect(tooltipSideForSidebar(position)).toBe(expected);
  });
});
