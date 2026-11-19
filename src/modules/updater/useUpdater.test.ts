import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(async () => null),
  effects: [] as Array<() => unknown>,
}));

// Minimal React stand-in: capture effects so the test can run them by hand.
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, () => {}],
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => unknown) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.9.0"),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@/lib/platform", () => ({ IS_LINUX: false }));

import { useUpdater } from "./useUpdater";

/** Simulate one render of the hook, then run its effects. */
async function renderHook(options?: { autoCheck?: boolean }) {
  mocks.effects.length = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: test drives the hook manually, outside React.
  useUpdater(options);
  for (const effect of mocks.effects) effect();
  // runCheck is async; let its microtasks settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useUpdater autoCheck", () => {
  beforeEach(() => {
    mocks.check.mockClear();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
  });

  it("checks on mount by default", async () => {
    await renderHook();
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it("never checks on mount when autoCheck is false", async () => {
    await renderHook({ autoCheck: false });
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("resumes checking once autoCheck is turned back on", async () => {
    await renderHook({ autoCheck: false });
    expect(mocks.check).not.toHaveBeenCalled();

    await renderHook({ autoCheck: true });
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
});
