import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import { createTerminalPathDropTarget } from "./useTerminalFileDrop";

describe("createTerminalPathDropTarget", () => {
  it("tracks the terminal leaf under the pointer", () => {
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: (x, y) => (x === 20 && y === 30 ? 7 : null),
      paste: vi.fn(),
      setTarget,
    });

    expect(target.updateTarget(20, 30)).toBe(true);
    expect(setTarget).toHaveBeenLastCalledWith(7);
    expect(target.updateTarget(1, 2)).toBe(false);
    expect(setTarget).toHaveBeenLastCalledWith(null);
  });

  it("clears the target and pastes a shell-quoted path", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => 11,
      paste,
      setTarget,
    });

    expect(target.dropPath("/repo/My File.ts", 40, 50)).toBe(true);
    expect(setTarget).toHaveBeenCalledWith(null);
    expect(paste).toHaveBeenCalledWith(11, "'/repo/My File.ts' ");
  });

  it("clears stale state when a drop misses every terminal", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => null,
      paste,
      setTarget,
    });

    expect(target.dropPath("/repo/file.ts", 1, 2)).toBe(false);
    expect(setTarget).toHaveBeenCalledWith(null);
    expect(paste).not.toHaveBeenCalled();
  });
});
