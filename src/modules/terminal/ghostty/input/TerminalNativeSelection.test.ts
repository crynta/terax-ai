import { describe, expect, it, vi } from "vitest";
import { TerminalNativeSelection } from "./TerminalNativeSelection";

function harness() {
  const target = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
  });
  const input = Object.assign(new EventTarget(), {
    value: "",
    style: { cssText: "original" } as CSSStyleDeclaration,
    focus: vi.fn(),
    select: vi.fn(),
  });
  const getSelection = vi.fn(() => "selected output");
  const mouseTracking = vi.fn(() => false);
  const bridge = new TerminalNativeSelection({
    target: target as unknown as HTMLElement,
    input: input as unknown as HTMLTextAreaElement,
    getSelection,
    mouseTracking,
    isMac: true,
  });
  const dispatch = (type: string, values = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button: 2,
      clientX: 150,
      clientY: 100,
      ctrlKey: false,
      shiftKey: false,
      ...values,
    });
    target.dispatchEvent(event);
    return event;
  };
  return { target, input, bridge, getSelection, mouseTracking, dispatch };
}

describe("native terminal text selection", () => {
  it.each([{ button: 2 }, { button: 0, ctrlKey: true }])(
    "exposes selection only for a context click: %s",
    (click) => {
      const h = harness();
      expect(h.getSelection).not.toHaveBeenCalled();
      h.dispatch("pointerdown", click);
      expect(h.input.value).toBe("selected output");
      expect(h.input.style.pointerEvents).toBe("auto");
      expect(h.input.style.left).toBe("40px");
      expect(h.input.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(h.input.select).toHaveBeenCalledOnce();
      expect(h.dispatch("contextmenu").defaultPrevented).toBe(false);
      h.input.dispatchEvent(new Event("blur"));
      expect(h.input.value).toBe("");
      expect(h.input.style.cssText).toBe("original");
      h.bridge.dispose();
    },
  );

  it("copies output without deleting terminal content for native Cut", () => {
    const h = harness();
    h.dispatch("contextmenu");
    const setData = vi.fn();
    const event = Object.assign(new Event("cut", { cancelable: true }), {
      clipboardData: { setData },
    });
    h.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "selected output");
    h.bridge.dispose();
    expect(h.input.value).toBe("");
    h.dispatch("contextmenu");
    expect(h.input.value).toBe("");
  });

  it("preserves application mouse reporting with a Shift override", () => {
    const h = harness();
    h.mouseTracking.mockReturnValue(true);
    h.dispatch("pointerdown");
    expect(h.getSelection).not.toHaveBeenCalled();
    expect(h.dispatch("contextmenu").defaultPrevented).toBe(true);
    expect(h.dispatch("contextmenu", { shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(h.input.value).toBe("selected output");
    h.bridge.reset();
    expect(h.input.value).toBe("");
    h.bridge.dispose();
  });
});
