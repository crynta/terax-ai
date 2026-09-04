import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_NEW_TERMINAL_DELAY_MS,
  scheduleFocusNewTerminalTab,
} from "./focusNewTerminalTab";

describe("scheduleFocusNewTerminalTab", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("focuses the new tab's active leaf after the default delay", () => {
    vi.useFakeTimers();
    const focus = vi.fn();
    scheduleFocusNewTerminalTab(7, {
      getTab: (id) =>
        id === 7 ? { kind: "terminal", activeLeafId: 42 } : undefined,
      getHandle: (leafId) => (leafId === 42 ? { focus } : undefined),
    });
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FOCUS_NEW_TERMINAL_DELAY_MS - 1);
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("no-ops when the tab is missing or not a terminal", () => {
    vi.useFakeTimers();
    const focus = vi.fn();
    scheduleFocusNewTerminalTab(1, {
      getTab: () => undefined,
      getHandle: () => ({ focus }),
    });
    scheduleFocusNewTerminalTab(2, {
      getTab: () => ({ kind: "editor", activeLeafId: 9 }),
      getHandle: () => ({ focus }),
    });
    vi.advanceTimersByTime(FOCUS_NEW_TERMINAL_DELAY_MS);
    expect(focus).not.toHaveBeenCalled();
  });

  it("no-ops when the terminal handle is not registered yet", () => {
    vi.useFakeTimers();
    scheduleFocusNewTerminalTab(3, {
      getTab: () => ({ kind: "terminal", activeLeafId: 1 }),
      getHandle: () => undefined,
    });
    vi.advanceTimersByTime(FOCUS_NEW_TERMINAL_DELAY_MS);
    // Should not throw.
  });
});
