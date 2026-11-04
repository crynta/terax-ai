import { describe, expect, it, vi } from "vitest";
import { type FocusEnv, focusUntilActive } from "./focusRetry";

function env(over: Partial<FocusEnv> = {}) {
  const timers: { callback: () => void; ms: number; live: boolean }[] = [];
  const state = { focused: false, unclaimed: true };
  const environment: FocusEnv = {
    isFocused: () => state.focused,
    isUnclaimed: () => state.unclaimed,
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as { live: boolean } | undefined)!.live = false;
    },
    ...over,
  };
  const fire = () => {
    const timer = timers.find((candidate) => candidate.live);
    if (!timer) return false;
    timer.live = false;
    timer.callback();
    return true;
  };
  return { environment, state, timers, fire };
}

describe("focusUntilActive", () => {
  it("focuses once when the first attempt sticks", () => {
    const { environment, state, timers } = env();
    const focus = vi.fn(() => {
      state.focused = true;
    });
    focusUntilActive(focus, environment);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(0);
  });

  it("retries on the schedule until the focus lands", () => {
    const { environment, state, timers, fire } = env();
    let attempts = 0;
    const focus = vi.fn(() => {
      attempts += 1;
      state.focused = attempts === 3;
    });
    focusUntilActive(focus, environment);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(timers.map((timer) => timer.ms)).toEqual([16]);
    fire();
    expect(focus).toHaveBeenCalledTimes(2);
    fire();
    expect(focus).toHaveBeenCalledTimes(3);
    expect(fire()).toBe(false);
    expect(timers.map((timer) => timer.ms)).toEqual([16, 48]);
  });

  it("gives up after the last delay", () => {
    const { environment, fire } = env();
    const focus = vi.fn();
    focusUntilActive(focus, environment, [1, 2]);
    while (fire());
    expect(focus).toHaveBeenCalledTimes(3);
  });

  it("does not take focus from an element the user moved to", () => {
    const { environment, state, fire } = env();
    const focus = vi.fn();
    focusUntilActive(focus, environment);
    state.unclaimed = false;
    fire();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("stops when cancelled", () => {
    const { environment, fire } = env();
    const focus = vi.fn();
    const cancel = focusUntilActive(focus, environment);
    cancel();
    expect(fire()).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
