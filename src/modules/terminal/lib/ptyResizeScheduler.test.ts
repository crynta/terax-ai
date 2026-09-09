import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PTY_RESIZE_DEBOUNCE_MS,
  PtyResizeScheduler,
} from "./ptyResizeScheduler";

afterEach(() => vi.useRealTimers());

describe("PtyResizeScheduler", () => {
  it("coalesces a split drag to its final dimensions", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const scheduler = new PtyResizeScheduler(deliver);

    scheduler.schedule(80, 24);
    scheduler.schedule(90, 30);
    scheduler.schedule(100, 36);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS - 1);
    expect(deliver).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(100, 36);
  });

  it("flushes the final dimensions before a surface detaches", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const scheduler = new PtyResizeScheduler(deliver);

    scheduler.schedule(120, 40);

    expect(scheduler.flush()).toBe(true);
    expect(deliver).toHaveBeenCalledWith(120, 40);
    vi.runAllTimers();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("keeps the quiet period open while pointer motion stays within one cell", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const scheduler = new PtyResizeScheduler(deliver);

    scheduler.schedule(100, 36);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS - 32);
    scheduler.schedule(100, 36);
    vi.advanceTimersByTime(32);
    expect(deliver).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS - 32);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(100, 36);
  });

  it("keeps client-side dimensions pending for the complete split gesture", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const scheduler = new PtyResizeScheduler(deliver);

    scheduler.schedule(80, 24);
    scheduler.suspend();
    scheduler.schedule(100, 36);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 4);
    expect(deliver).not.toHaveBeenCalled();
    expect(scheduler.flush()).toBe(false);
    expect(deliver).not.toHaveBeenCalled();

    scheduler.resume();
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS - 1);
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(100, 36);
  });

  it("does not redeliver unchanged dimensions", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const scheduler = new PtyResizeScheduler(deliver);

    scheduler.schedule(80, 24);
    scheduler.flush();
    scheduler.schedule(80, 24);

    expect(scheduler.flush()).toBe(false);
    expect(deliver).toHaveBeenCalledOnce();
  });
});
