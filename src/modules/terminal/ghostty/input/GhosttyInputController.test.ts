import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { describe, expect, it, vi } from "vitest";
import {
  GhosttyInputController,
  terminalMouseModifiers,
} from "./GhosttyInputController";

describe("terminalMouseModifiers", () => {
  it("encodes xterm Shift, Alt, and Control bits", () => {
    expect(
      terminalMouseModifiers({ shiftKey: true, altKey: true, ctrlKey: true }),
    ).toBe(28);
  });

  it("does not confuse the macOS Command modifier with Alt", () => {
    const commandOnly = {
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: true,
    };
    expect(terminalMouseModifiers(commandOnly)).toBe(0);
  });
});

describe("GhosttyInputController", () => {
  it("emits macOS Option-produced Unicode as text by default", () => {
    const input = new FakeTextArea();
    const pointerTarget = new FakeElement();
    const onData = vi.fn();
    const controller = new GhosttyInputController({
      model: inputModel(),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: pointerTarget as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      onData,
      onCopy: () => false,
      isMac: true,
    });

    input.dispatchEvent(
      keyboardEvent({
        key: "å",
        code: "KeyA",
        altKey: true,
      }),
    );

    expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe("å");
    controller.dispose();
  });

  it("deduplicates identical mouse-motion reports within a cell", () => {
    const input = new FakeTextArea();
    const pointerTarget = new FakeElement();
    const onData = vi.fn();
    const controller = new GhosttyInputController({
      model: inputModel((mode) => mode === 1003 || mode === 1006),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: pointerTarget as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      onData,
      onCopy: () => false,
      isMac: false,
    });

    for (let index = 0; index < 2; index += 1) {
      pointerTarget.dispatchEvent(
        mouseEvent("mousemove", {
          clientX: 15,
          clientY: 25,
        }),
      );
    }

    expect(onData).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe(
      "\x1b[<32;2;2M",
    );
    controller.dispose();
  });
});

function inputModel(
  mode: (value: number) => boolean = () => false,
): GhosttyTerminalModelApi {
  return {
    cols: 80,
    rows: 24,
    modes: () => ({
      alternateScreen: false,
      bracketedPaste: false,
      focusReporting: false,
      mouseTracking: true,
      synchronizedOutput: false,
    }),
    mode,
    scrollToBottom: () => false,
    scrollPosition: () => ({ offset: 0, history: 0 }),
    scrollBy: () => false,
    encodeKey: () => new Uint8Array(0),
  } as unknown as GhosttyTerminalModelApi;
}

class FakeElement extends EventTarget {
  getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      right: 800,
      bottom: 480,
      width: 800,
      height: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

class FakeTextArea extends FakeElement {
  value = "";
}

function keyboardEvent(values: Partial<KeyboardEvent>): KeyboardEvent {
  return Object.assign(
    new Event("keydown", { bubbles: true, cancelable: true }),
    {
      altKey: false,
      code: "",
      ctrlKey: false,
      getModifierState: () => false,
      isComposing: false,
      key: "",
      keyCode: 0,
      metaKey: false,
      repeat: false,
      shiftKey: false,
      ...values,
    },
  ) as KeyboardEvent;
}

function mouseEvent(type: string, values: Partial<MouseEvent>): MouseEvent {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    altKey: false,
    button: 0,
    clientX: 0,
    clientY: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...values,
  }) as MouseEvent;
}
