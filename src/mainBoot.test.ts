import { describe, expect, it, vi } from "vitest";
import { startMainWindow } from "./mainBoot";

describe("startMainWindow", () => {
  it("schedules window show and renders before waiting on PTY cleanup", async () => {
    const timers: Array<() => void> = [];
    const setTimer = vi.fn((callback: () => void) => {
      timers.push(callback);
      return 1;
    });
    const show = vi.fn(() => Promise.resolve());
    const createRoot = vi.fn(() => ({ render: vi.fn() }));
    const blockedCloseAll = new Promise<void>(() => {});

    const boot = startMainWindow({
      app: null,
      closeAllPtys: () => blockedCloseAll,
      createRoot,
      currentWindow: { show },
      initLaunchDir: () => Promise.resolve(),
      logError: vi.fn(),
      root: {} as HTMLElement,
      setTimer,
    });

    expect(setTimer).toHaveBeenCalledTimes(2);
    timers[0]?.();
    expect(show).toHaveBeenCalledTimes(1);

    await boot;
    expect(createRoot).toHaveBeenCalledTimes(1);
  });
});
