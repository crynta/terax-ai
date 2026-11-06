import { describe, expect, it, vi } from "vitest";
import { FakeElement } from "./fakeTextArea";
import { TerminalMouse } from "./TerminalMouse";

function mouseEvent(
  type: string,
  values: Partial<MouseEvent> = {},
): MouseEvent {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    button: 0,
    clientX: 15,
    clientY: 25,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...values,
  }) as MouseEvent;
}

function harness(tracking = 1002) {
  const target = new FakeElement();
  const send = vi.fn<(report: Uint8Array) => void>();
  const mouse = new TerminalMouse({
    pointerTarget: target as unknown as HTMLElement,
    model: {
      cols: 80,
      rows: 24,
      modes: () => ({
        mouseTracking: true,
        alternateScreen: false,
        bracketedPaste: false,
        focusReporting: false,
        synchronizedOutput: false,
      }),
      mode: (mode) => mode === 1006 || mode === tracking,
    },
    cellSize: () => ({ width: 10, height: 20 }),
    send,
  });
  return {
    mouse,
    target,
    reports: () =>
      send.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)),
  };
}

describe("TerminalMouse press ownership", () => {
  it("reports an outside release once and stops dragging", () => {
    const h = harness();
    h.target.dispatchEvent(mouseEvent("mousedown"));
    h.target.ownerDocument.dispatchEvent(
      mouseEvent("mouseup", { clientX: 900, clientY: 600 }),
    );
    h.target.dispatchEvent(mouseEvent("mouseup"));
    h.target.dispatchEvent(mouseEvent("mousemove"));
    expect(h.reports()).toEqual(["\x1b[<0;2;2M", "\x1b[<0;80;24m"]);
    h.mouse.dispose();
  });

  it("does not report releases for Shift presses or presses outside its pane", () => {
    const h = harness();
    h.target.dispatchEvent(mouseEvent("mousedown", { shiftKey: true }));
    h.target.dispatchEvent(mouseEvent("mouseup"));
    h.target.ownerDocument.dispatchEvent(mouseEvent("mouseup"));
    expect(h.reports()).toEqual([]);
    h.mouse.dispose();
  });

  it("releases each owned button on focus loss and removes release listeners", () => {
    const h = harness();
    h.target.dispatchEvent(mouseEvent("mousedown"));
    h.target.dispatchEvent(mouseEvent("mousedown", { button: 2 }));
    h.target.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    h.target.ownerDocument.dispatchEvent(mouseEvent("mouseup"));
    h.target.dispatchEvent(mouseEvent("mousemove"));
    expect(h.reports()).toEqual([
      "\x1b[<0;2;2M",
      "\x1b[<2;2;2M",
      "\x1b[<0;2;2m",
      "\x1b[<2;2;2m",
    ]);
    h.mouse.dispose();
  });

  it("reports hover as no-button motion before and after a drag", () => {
    const h = harness(1003);
    h.target.dispatchEvent(mouseEvent("mousemove"));
    h.target.dispatchEvent(mouseEvent("mousedown"));
    h.target.dispatchEvent(mouseEvent("mousemove"));
    h.target.dispatchEvent(mouseEvent("mouseup"));
    h.target.dispatchEvent(mouseEvent("mousemove"));
    expect(h.reports()).toEqual([
      "\x1b[<35;2;2M",
      "\x1b[<0;2;2M",
      "\x1b[<32;2;2M",
      "\x1b[<0;2;2m",
      "\x1b[<35;2;2M",
    ]);
    h.mouse.dispose();
  });

  it("removes document and window listeners on disposal during a press", () => {
    const h = harness();
    h.target.dispatchEvent(mouseEvent("mousedown"));
    h.mouse.dispose();
    h.target.ownerDocument.dispatchEvent(mouseEvent("mouseup"));
    h.target.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    h.target.dispatchEvent(mouseEvent("mousedown"));
    expect(h.reports()).toEqual(["\x1b[<0;2;2M"]);
  });

  it.each(["mouseup", "blur"])(
    "keeps X10 press-only on %s and omits modifiers",
    (end) => {
      const h = harness(9);
      h.target.dispatchEvent(
        mouseEvent("mousedown", { ctrlKey: true, altKey: true }),
      );
      h.target.dispatchEvent(mouseEvent("mousemove"));
      if (end === "blur")
        h.target.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
      else h.target.ownerDocument.dispatchEvent(mouseEvent("mouseup"));
      h.target.dispatchEvent(mouseEvent("mousemove"));
      expect(h.reports()).toEqual(["\x1b[<0;2;2M"]);
      h.mouse.dispose();
    },
  );
});
