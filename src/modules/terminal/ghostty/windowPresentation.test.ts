import { afterEach, describe, expect, it, vi } from "vitest";
import {
  subscribeWindowPresentation,
  terminalWindowPresentation,
} from "@/modules/terminal/ghostty/windowPresentation";

const bridge = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: bridge.listen }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
const subscriptions: (() => void)[] = [];

afterEach(() => {
  for (const stop of subscriptions.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function harness() {
  vi.useFakeTimers();
  let documentVisible = true;
  let onVisibility = () => {};
  let nativeEvent: (event: { payload: unknown }) => void = () => {};
  let initial: (value: unknown) => void = () => {};
  const unlisten = vi.fn();
  bridge.listen.mockImplementation((_name, callback) => {
    nativeEvent = callback;
    return Promise.resolve(unlisten);
  });
  bridge.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        initial = resolve;
      }),
  );
  const removeEventListener = vi.fn();
  const addEventListener = vi.fn((_name, callback) => {
    onVisibility = callback;
  });
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("document", {
    get visibilityState() {
      return documentVisible ? "visible" : "hidden";
    },
    addEventListener,
    removeEventListener,
  });
  return {
    unlisten,
    addEventListener,
    removeEventListener,
    native(value: unknown) {
      nativeEvent({ payload: value });
    },
    initial(value: unknown) {
      initial(value);
    },
    visible(value: boolean) {
      documentVisible = value;
      onVisibility();
    },
    subscribe() {
      const listener = vi.fn();
      const stop = subscribeWindowPresentation(listener);
      subscriptions.push(stop);
      return { listener, stop };
    },
  };
}

describe("window presentation bridge", () => {
  it("shares one event subscription and releases it after the last consumer", async () => {
    const h = harness();
    const first = h.subscribe();
    const second = h.subscribe();
    await Promise.resolve();
    expect(bridge.listen).toHaveBeenCalledOnce();
    expect(h.addEventListener).toHaveBeenCalledOnce();
    first.stop();
    expect(h.unlisten).not.toHaveBeenCalled();
    h.visible(false);
    second.stop();
    expect(h.unlisten).toHaveBeenCalledOnce();
    expect(h.removeEventListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores stale initial queries and malformed native events", async () => {
    const h = harness();
    h.subscribe();
    await Promise.resolve();
    h.native({ revision: 4, occluded: true, sleeping: false });
    h.initial({ revision: 3, occluded: false, sleeping: false });
    await Promise.resolve();
    for (const payload of [
      null,
      {},
      { revision: -1 },
      { revision: 5, occluded: "false", sleeping: false },
    ])
      h.native(payload);
    expect(terminalWindowPresentation()).toEqual({
      visible: false,
      reclaim: false,
    });
    vi.advanceTimersByTime(2_000);
    expect(terminalWindowPresentation()).toEqual({
      visible: false,
      reclaim: true,
    });
    h.native({ revision: 5, occluded: false, sleeping: false });
    expect(terminalWindowPresentation()).toEqual({
      visible: true,
      reclaim: false,
    });
    h.native({ revision: 6, occluded: false, sleeping: true });
    expect(terminalWindowPresentation()).toEqual({
      visible: false,
      reclaim: true,
    });
    h.visible(false);
    h.native({ revision: 7, occluded: false, sleeping: false });
    expect(terminalWindowPresentation().visible).toBe(false);
    h.visible(true);
    expect(terminalWindowPresentation().visible).toBe(true);
  });

  it("unsubscribes a native listener that resolves after its consumer closes", async () => {
    const h = harness();
    const subscriber = h.subscribe();
    subscriber.stop();
    await Promise.resolve();
    expect(h.unlisten).toHaveBeenCalledOnce();
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
