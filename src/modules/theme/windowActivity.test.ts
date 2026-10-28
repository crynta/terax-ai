import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWindowInactive,
  installWindowActivity,
  isWindowInactive,
  subscribeWindowInactive,
  WINDOW_INACTIVE_ATTR,
} from "./windowActivity";

function fakeEnv(visibility: "visible" | "hidden" = "visible") {
  const attrs = new Map<string, string>();
  const docListeners = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: visibility as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      docListeners.get(type)?.delete(fn);
    },
  };
  const root = {
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
  };
  let focus: ((focused: boolean) => void) | null = null;
  let presentation: ((s: { visible: boolean }) => void) | null = null;
  const unbindFocus = vi.fn(() => {
    focus = null;
  });
  const unsubscribePresentation = vi.fn(() => {
    presentation = null;
  });
  const sources = {
    root,
    doc: doc as unknown as Document,
    bindFocus: (l: (focused: boolean) => void) => {
      focus = l;
      return unbindFocus;
    },
    subscribePresentation: (l: (s: { visible: boolean }) => void) => {
      presentation = l;
      return unsubscribePresentation;
    },
  };
  return {
    attrs,
    sources,
    unbindFocus,
    unsubscribePresentation,
    setFocus: (v: boolean) => focus?.(v),
    setPresentation: (visible: boolean) => presentation?.({ visible }),
    setVisibility: (v: DocumentVisibilityState) => {
      doc.visibilityState = v;
      for (const fn of docListeners.get("visibilitychange") ?? []) fn();
    },
    docListenerCount: () => docListeners.get("visibilitychange")?.size ?? 0,
  };
}

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("isWindowInactive", () => {
  it("is active only when focused, visible and presented", () => {
    const on = {
      focused: true,
      documentVisible: true,
      presentationVisible: true,
    };
    expect(isWindowInactive(on)).toBe(false);
    expect(isWindowInactive({ ...on, focused: false })).toBe(true);
    expect(isWindowInactive({ ...on, documentVisible: false })).toBe(true);
    expect(isWindowInactive({ ...on, presentationVisible: false })).toBe(true);
  });
});

describe("installWindowActivity", () => {
  it("starts active without an inactive marker", () => {
    const env = fakeEnv();
    dispose = installWindowActivity(env.sources);
    expect(getWindowInactive()).toBe(false);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(false);
  });

  it("marks <html> inactive on blur and clears it on focus", () => {
    const env = fakeEnv();
    dispose = installWindowActivity(env.sources);
    env.setFocus(false);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(true);
    expect(getWindowInactive()).toBe(true);
    env.setFocus(true);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(false);
    expect(getWindowInactive()).toBe(false);
  });

  it("stays inactive until every reason has cleared", () => {
    const env = fakeEnv();
    dispose = installWindowActivity(env.sources);
    env.setFocus(false);
    env.setPresentation(false);
    env.setVisibility("hidden");
    env.setFocus(true);
    expect(getWindowInactive()).toBe(true);
    env.setPresentation(true);
    expect(getWindowInactive()).toBe(true);
    env.setVisibility("visible");
    expect(getWindowInactive()).toBe(false);
  });

  it("treats a window that starts hidden as inactive", () => {
    const env = fakeEnv("hidden");
    dispose = installWindowActivity(env.sources);
    expect(getWindowInactive()).toBe(true);
    env.setVisibility("visible");
    expect(getWindowInactive()).toBe(false);
  });

  it("follows native occlusion from the shared presentation feed", () => {
    const env = fakeEnv();
    dispose = installWindowActivity(env.sources);
    env.setPresentation(false);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(true);
    env.setPresentation(true);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(false);
  });

  it("notifies subscribers only on real transitions", () => {
    const env = fakeEnv();
    dispose = installWindowActivity(env.sources);
    const listener = vi.fn();
    const off = subscribeWindowInactive(listener);
    env.setFocus(false);
    env.setFocus(false);
    env.setPresentation(false);
    expect(listener).toHaveBeenCalledTimes(1);
    env.setFocus(true);
    env.setPresentation(true);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    env.setFocus(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("works without a native presentation feed", () => {
    const env = fakeEnv();
    const { subscribePresentation: _unused, ...rest } = env.sources;
    dispose = installWindowActivity(rest);
    env.setFocus(false);
    expect(getWindowInactive()).toBe(true);
  });

  it("releases every source and clears the marker on dispose", () => {
    const env = fakeEnv();
    const stop = installWindowActivity(env.sources);
    env.setFocus(false);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(true);
    stop();
    expect(env.unbindFocus).toHaveBeenCalledTimes(1);
    expect(env.unsubscribePresentation).toHaveBeenCalledTimes(1);
    expect(env.docListenerCount()).toBe(0);
    expect(env.attrs.has(WINDOW_INACTIVE_ATTR)).toBe(false);
    expect(getWindowInactive()).toBe(false);
  });
});
