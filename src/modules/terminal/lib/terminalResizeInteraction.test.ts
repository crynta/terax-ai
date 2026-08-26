import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PTY_RESIZE_DEBOUNCE_MS,
  PtyResizeScheduler,
} from "./ptyResizeScheduler";
import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
  subscribeTerminalResizeInteraction,
} from "./terminalResizeInteraction";

afterEach(() => vi.useRealTimers());

describe("terminalResizeInteraction", () => {
  it("publishes one transaction across repeated layout updates", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalResizeInteraction(listener);
    const token = {};

    beginTerminalResizeInteraction(token);
    beginTerminalResizeInteraction(token);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(true);

    endTerminalResizeInteraction(token);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });

  it("stays active until nested layout transactions have completed", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalResizeInteraction(listener);
    const outer = {};
    const inner = {};

    beginTerminalResizeInteraction(outer);
    beginTerminalResizeInteraction(inner);
    endTerminalResizeInteraction(outer);
    expect(listener).toHaveBeenCalledTimes(1);

    endTerminalResizeInteraction(inner);
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
  });

  it("keeps a session-owned PTY scheduler silent for the full gesture", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const scheduler = new PtyResizeScheduler(deliver);
    const token = {};
    const unsubscribe = subscribeTerminalResizeInteraction((active) => {
      if (active) scheduler.suspend();
      else scheduler.resume();
    });

    beginTerminalResizeInteraction(token);
    scheduler.schedule(90, 30);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 10);
    scheduler.schedule(120, 40);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 10);
    expect(deliver).not.toHaveBeenCalled();
    expect(scheduler.diagnostics()).toMatchObject({
      schedules: 2,
      deliveries: 0,
      suspended: true,
      pending: { cols: 120, rows: 40 },
    });

    endTerminalResizeInteraction(token);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(120, 40);
    expect(scheduler.diagnostics()).toMatchObject({
      deliveries: 1,
      suspended: false,
      pending: null,
    });
    unsubscribe();
    scheduler.reset();
  });
});
