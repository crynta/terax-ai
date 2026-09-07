import { describe, expect, it, vi } from "vitest";

import {
  applyAnchor,
  attachImeAnchorFreeze,
  readAnchor,
  type FrozenAnchor,
} from "./imeAnchorFreeze";

function styleEl(initial: FrozenAnchor): HTMLElement {
  const style = { ...initial } as Record<string, string>;
  return {
    get style() {
      return style as unknown as CSSStyleDeclaration;
    },
  } as HTMLElement;
}

describe("readAnchor / applyAnchor", () => {
  it("reads left/top from style", () => {
    expect(readAnchor(styleEl({ left: "3px", top: "4px" }))).toEqual({
      left: "3px",
      top: "4px",
    });
  });

  it("defaults missing style to 0px", () => {
    expect(readAnchor(styleEl({ left: "", top: "" }))).toEqual({
      left: "0px",
      top: "0px",
    });
  });

  it("writes when values differ", () => {
    const el = styleEl({ left: "1px", top: "2px" });
    applyAnchor(el, { left: "9px", top: "8px" });
    expect(el.style.left).toBe("9px");
    expect(el.style.top).toBe("8px");
    applyAnchor(el, { left: "9px", top: "8px" });
    expect(el.style.left).toBe("9px");
  });
});

describe("attachImeAnchorFreeze", () => {
  it("captures on first compositionupdate and restores on style mutation", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const style = { left: "12px", top: "34px" } as Record<string, string>;
    let observed: MutationCallback | null = null;

    class FakeMutationObserver {
      constructor(cb: MutationCallback) {
        observed = cb;
      }
      observe() {}
      disconnect() {
        observed = null;
      }
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);

    const ta = {
      style,
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as HTMLTextAreaElement;

    const handle = attachImeAnchorFreeze(ta);
    for (const fn of listeners.get("compositionupdate") ?? []) {
      fn(new Event("compositionupdate"));
    }

    style.left = "99px";
    style.top = "88px";
    (observed as MutationCallback | null)?.([], {} as MutationObserver);
    expect(style.left).toBe("12px");
    expect(style.top).toBe("34px");

    for (const fn of listeners.get("compositionend") ?? []) {
      fn(new Event("compositionend"));
    }
    style.left = "50px";
    expect(observed).toBeNull();
    expect(style.left).toBe("50px");

    handle.dispose();
    vi.unstubAllGlobals();
  });

  it("pins composition view to the same origin", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const taStyle = { left: "1px", top: "2px" } as Record<string, string>;
    const viewStyle = { left: "1px", top: "2px" } as Record<string, string>;
    let observed: MutationCallback | null = null;

    class FakeMutationObserver {
      constructor(cb: MutationCallback) {
        observed = cb;
      }
      observe() {}
      disconnect() {
        observed = null;
      }
    }
    vi.stubGlobal("MutationObserver", FakeMutationObserver);

    const ta = {
      style: taStyle,
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as HTMLTextAreaElement;
    const view = { style: viewStyle } as unknown as HTMLElement;

    const handle = attachImeAnchorFreeze(ta, { compositionView: view });
    for (const fn of listeners.get("compositionupdate") ?? []) {
      fn(new Event("compositionupdate"));
    }
    viewStyle.left = "77px";
    viewStyle.top = "66px";
    (observed as MutationCallback | null)?.([], {} as MutationObserver);
    expect(viewStyle.left).toBe("1px");
    expect(viewStyle.top).toBe("2px");
    handle.dispose();
    vi.unstubAllGlobals();
  });
});
