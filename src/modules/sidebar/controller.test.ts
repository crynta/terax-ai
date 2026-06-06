import { describe, expect, it } from "vitest";
import { resolveSidebarResize } from "./controller";
import { SIDEBAR_MAX_WIDTH } from "./persistence";

describe("sidebar controller", () => {
  it("preserves the last width when a sidebar collapses", () => {
    expect(
      resolveSidebarResize({
        currentWidth: 260,
        sizeInPixels: 0,
      }),
    ).toEqual({
      visible: false,
      width: 260,
    });
  });

  it("marks the sidebar visible and clamps the remembered width when resized", () => {
    expect(
      resolveSidebarResize({
        currentWidth: 260,
        sizeInPixels: SIDEBAR_MAX_WIDTH + 100,
      }),
    ).toEqual({
      visible: true,
      width: SIDEBAR_MAX_WIDTH,
    });
  });
});
