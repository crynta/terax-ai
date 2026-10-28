import { describe, expect, it, vi } from "vitest";
import {
  installLivePageResize,
  LIVE_RESIZE_ATTR,
  LIVE_RESIZE_IDLE_MS,
} from "./livePageResize";

function fakeEnv() {
  const attrs = new Map<string, string>();
  let listener: (() => void) | null = null;
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const stopListening = vi.fn(() => {
    listener = null;
  });
  const sources = {
    root: {
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      removeAttribute: (name: string) => attrs.delete(name),
    },
    onResize: (l: () => void) => {
      listener = l;
      return stopListening;
    },
    setTimer: (run: () => void, ms: number) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, run });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
  };
  return {
    attrs,
    sources,
    stopListening,
    timers,
    resize: () => listener?.(),
    advance: (ms: number) => {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.run();
        }
      }
    },
  };
}

describe("installLivePageResize", () => {
  it("is off until the window resizes", () => {
    const env = fakeEnv();
    installLivePageResize(env.sources);
    expect(env.attrs.has(LIVE_RESIZE_ATTR)).toBe(false);
    expect(env.timers.size).toBe(0);
  });

  it("holds the mark across a burst and releases it after the idle gap", () => {
    const env = fakeEnv();
    installLivePageResize(env.sources);
    for (let step = 0; step < 20; step++) {
      env.resize();
      env.advance(LIVE_RESIZE_IDLE_MS - 50);
      expect(env.attrs.has(LIVE_RESIZE_ATTR)).toBe(true);
    }
    // One timer, however many steps arrived.
    expect(env.timers.size).toBe(1);
    env.advance(LIVE_RESIZE_IDLE_MS);
    expect(env.attrs.has(LIVE_RESIZE_ATTR)).toBe(false);
    expect(env.timers.size).toBe(0);
  });

  it("marks again for the next drag", () => {
    const env = fakeEnv();
    installLivePageResize(env.sources);
    env.resize();
    env.advance(LIVE_RESIZE_IDLE_MS);
    expect(env.attrs.has(LIVE_RESIZE_ATTR)).toBe(false);
    env.resize();
    expect(env.attrs.has(LIVE_RESIZE_ATTR)).toBe(true);
  });

  it("clears the mark and the timer when uninstalled mid-drag", () => {
    const env = fakeEnv();
    const stop = installLivePageResize(env.sources);
    env.resize();
    stop();
    expect(env.stopListening).toHaveBeenCalledTimes(1);
    expect(env.attrs.has(LIVE_RESIZE_ATTR)).toBe(false);
    expect(env.timers.size).toBe(0);
  });
});
