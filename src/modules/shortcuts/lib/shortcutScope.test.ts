import { describe, expect, it } from "vitest";
import { shouldDisablePaneSwapShortcut } from "@/modules/shortcuts/lib/shortcutScope";

describe("shouldDisablePaneSwapShortcut", () => {
  it.each([
    "pane.swapLeft",
    "pane.swapRight",
    "pane.swapUp",
    "pane.swapDown",
  ] as const)("disables %s outside multi-pane terminals", (id) => {
    expect(shouldDisablePaneSwapShortcut(id, null)).toBe(true);
    expect(shouldDisablePaneSwapShortcut(id, 1)).toBe(true);
    expect(shouldDisablePaneSwapShortcut(id, 2)).toBe(false);
  });

  it("rejects unrelated shortcuts", () => {
    expect(shouldDisablePaneSwapShortcut("pane.focusNext", null)).toBe(false);
    expect(shouldDisablePaneSwapShortcut("editor.undo", 1)).toBe(false);
  });
});
