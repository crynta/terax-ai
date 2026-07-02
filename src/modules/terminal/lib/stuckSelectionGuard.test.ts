import { describe, expect, it, vi } from "vitest";
import {
  clearLiveTerminalSelection,
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

  it("clears selection only on the tracked live terminal slot", () => {
    const liveClear = vi.fn();
    const otherClear = vi.fn();
    const retainedClear = vi.fn();

    clearLiveTerminalSelection(
      { currentLeafId: 1, term: { clearSelection: liveClear } },
      1,
    );
    clearLiveTerminalSelection(
      { currentLeafId: 2, term: { clearSelection: otherClear } },
      1,
    );
    clearLiveTerminalSelection(
      { currentLeafId: null, term: { clearSelection: retainedClear } },
      1,
    );

    expect(liveClear).toHaveBeenCalledOnce();
    expect(otherClear).not.toHaveBeenCalled();
    expect(retainedClear).not.toHaveBeenCalled();
  });
});
