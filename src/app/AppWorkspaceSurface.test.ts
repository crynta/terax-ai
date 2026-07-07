import { describe, expect, it } from "vitest";
import { shouldRenderLegacyMiniWindow } from "./AppWorkspaceSurface";

describe("AppFloatingSurfaces mini window routing", () => {
  it("keeps the legacy AI mini window out of the Pi conversation surface", () => {
    expect(
      shouldRenderLegacyMiniWindow({
        hasLegacyComposer: true,
        legacyMiniOpen: true,
        usePiConversationSurface: true,
      }),
    ).toBe(false);
  });

  it("preserves the legacy mini window until the Pi surface is selected", () => {
    expect(
      shouldRenderLegacyMiniWindow({
        hasLegacyComposer: true,
        legacyMiniOpen: true,
        usePiConversationSurface: false,
      }),
    ).toBe(true);
  });
});
