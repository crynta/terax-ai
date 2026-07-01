import { describe, expect, it, vi } from "vitest";
import {
  clearLiveTerminalSelections,
  isReleasedMoveDuringSelection,
  isTerminalSelectionStart,
} from "./stuckSelectionGuard";

function target(matches: boolean) {
  return {
    closest: vi.fn((selector: string) =>
      selector === ".xterm" && matches ? {} : null,
    ),
  } as unknown as EventTarget;
}

describe("stuck terminal selection guard", () => {
  it("tracks only primary-button mousedown inside xterm", () => {
    expect(isTerminalSelectionStart({ button: 0 }, target(true))).toBe(true);
    expect(isTerminalSelectionStart({ button: 1 }, target(true))).toBe(false);
    expect(isTerminalSelectionStart({ button: 0 }, target(false))).toBe(false);
    expect(isTerminalSelectionStart({ button: 0 }, null)).toBe(false);
  });

  it("clears only when a tracked selection receives a released mousemove", () => {
    expect(isReleasedMoveDuringSelection(true, { buttons: 0 })).toBe(true);
    expect(isReleasedMoveDuringSelection(true, { buttons: 1 })).toBe(false);
    expect(isReleasedMoveDuringSelection(false, { buttons: 0 })).toBe(false);
  });

  it("clears selections only on live terminal slots", () => {
    const liveClear = vi.fn();
    const retainedClear = vi.fn();

    clearLiveTerminalSelections([
      { currentLeafId: 1, term: { clearSelection: liveClear } },
      { currentLeafId: null, term: { clearSelection: retainedClear } },
    ]);

    expect(liveClear).toHaveBeenCalledOnce();
    expect(retainedClear).not.toHaveBeenCalled();
  });
});
