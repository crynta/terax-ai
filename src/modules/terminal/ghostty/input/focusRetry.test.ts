import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusUntilActive } from "./focusRetry";

const body = {};
const target = {} as Element;

function setActive(element: unknown) {
  (document as { activeElement: unknown }).activeElement = element;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { activeElement: body, body });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("focusUntilActive", () => {
  it("focuses once when the first attempt sticks", () => {
    const focus = vi.fn(() => setActive(target));
    focusUntilActive(target, focus);
    vi.runAllTimers();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("retries on the schedule until the focus lands", () => {
    let attempts = 0;
    const focus = vi.fn(() => {
      attempts += 1;
      if (attempts === 3) setActive(target);
    });
    focusUntilActive(target, focus);
    expect(focus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15);
    expect(focus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(focus).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(48);
    expect(focus).toHaveBeenCalledTimes(3);
    vi.runAllTimers();
    expect(focus).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last delay", () => {
    const focus = vi.fn();
    focusUntilActive(target, focus, [1, 2]);
    vi.runAllTimers();
    expect(focus).toHaveBeenCalledTimes(3);
  });

  it("does not take focus from an element the user moved to", () => {
    const focus = vi.fn();
    focusUntilActive(target, focus);
    setActive({});
    vi.runAllTimers();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("does not start when another element already holds the focus", () => {
    const focus = vi.fn();
    setActive({});
    focusUntilActive(target, focus);
    vi.runAllTimers();
    expect(focus).not.toHaveBeenCalled();
  });

  it("does nothing when the target already has the focus", () => {
    const focus = vi.fn();
    setActive(target);
    focusUntilActive(target, focus);
    vi.runAllTimers();
    expect(focus).not.toHaveBeenCalled();
  });

  it("stops when cancelled", () => {
    const focus = vi.fn();
    const cancel = focusUntilActive(target, focus);
    cancel();
    vi.runAllTimers();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
