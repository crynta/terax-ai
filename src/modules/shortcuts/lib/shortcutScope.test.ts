import { describe, expect, it, vi } from "vitest";
import {
  shouldDisableAskSelection,
  shouldDisablePaneSwapShortcut,
} from "@/modules/shortcuts/lib/shortcutScope";

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

describe("shouldDisableAskSelection", () => {
  const plain = { ctrlKey: true, shiftKey: false };
  const chord = { ctrlKey: true, shiftKey: true };

  it("always runs on Ctrl+Shift, selection or not, terminal or not", () => {
    for (const inTerminal of [true, false])
      for (const selected of [true, false])
        expect(
          shouldDisableAskSelection(
            chord,
            () => inTerminal,
            () => selected,
          ),
        ).toBe(false);
  });

  it("leaves a user's plain Ctrl+J to the shell when nothing is selected", () => {
    expect(
      shouldDisableAskSelection(
        plain,
        () => true,
        () => false,
      ),
    ).toBe(true);
    expect(
      shouldDisableAskSelection(
        plain,
        () => true,
        () => true,
      ),
    ).toBe(false);
    expect(
      shouldDisableAskSelection(
        plain,
        () => false,
        () => false,
      ),
    ).toBe(false);
  });

  it("does not read the selection when the chord already decides", () => {
    const selected = vi.fn(() => false);
    shouldDisableAskSelection(chord, () => true, selected);
    expect(selected).not.toHaveBeenCalled();
  });
});
