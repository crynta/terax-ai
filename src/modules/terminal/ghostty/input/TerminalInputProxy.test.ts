import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";
import { GhosttyInputController } from "./GhosttyInputController";
import {
  TERMINAL_INPUT_PLACEHOLDER as PLACEHOLDER,
  TerminalInputProxy,
} from "./TerminalInputProxy";

function setup(options: { isMac?: boolean } = {}) {
  const input = new FakeTextArea();
  const onData = vi.fn();
  const pasted = vi.fn();
  const controller = new GhosttyInputController({
    model: model(),
    input: input as unknown as HTMLTextAreaElement,
    pointerTarget: new FakeElement() as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    isMac: options.isMac ?? true,
    onCopy: () => false,
    onPaste: (text) => {
      pasted(text);
      return true;
    },
    onData,
  });
  const text = () =>
    onData.mock.calls.map((call) => new TextDecoder().decode(call[0])).join("");
  const armed = () =>
    input.value === PLACEHOLDER &&
    input.selectionStart === 0 &&
    input.selectionEnd === 1;
  return { input, controller, onData, pasted, text, armed };
}

function model(): GhosttyTerminalModelApi {
  return {
    cols: 80,
    rows: 24,
    modes: () => ({
      alternateScreen: false,
      bracketedPaste: false,
      focusReporting: false,
      mouseTracking: false,
      synchronizedOutput: false,
    }),
    mode: () => false,
    scrollToBottom: () => false,
    scrollPosition: () => ({ offset: 0, history: 0 }),
    scrollBy: () => false,
    encodeKey: (event: { utf8?: string }) =>
      new TextEncoder().encode(event.utf8 ?? ""),
  } as unknown as GhosttyTerminalModelApi;
}

function fire(
  input: EventTarget,
  type: string,
  values: Record<string, unknown> = {},
): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    isComposing: false,
    getModifierState: () => false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...values,
  });
  input.dispatchEvent(event);
  return event;
}

describe("TerminalInputProxy", () => {
  it("holds a selected placeholder, so the textarea never paints a caret", () => {
    const h = setup();
    expect(h.armed()).toBe(true);
    expect(h.input.caretVisible).toBe(false);
    h.controller.dispose();
  });

  it("restores the placeholder when focus, a key release or an input event collapsed the selection", () => {
    const h = setup();
    for (const type of ["focus", "keyup", "input"]) {
      h.input.setSelectionRange(1, 1);
      expect(h.input.caretVisible).toBe(true);
      fire(h.input, type);
      expect(h.armed()).toBe(true);
    }
    h.input.value = "stray";
    fire(h.input, "input");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("restores the placeholder after a handled beforeinput without touching the text sent", () => {
    const h = setup();
    const event = fire(h.input, "beforeinput", {
      inputType: "insertText",
      data: "x",
    });
    expect(event.defaultPrevented).toBe(true);
    expect(h.text()).toBe("x");
    expect(h.armed()).toBe(true);
    // Backspace / Delete / Enter through the native editing path.
    fire(h.input, "beforeinput", { inputType: "deleteContentBackward" });
    fire(h.input, "beforeinput", { inputType: "insertLineBreak" });
    expect(h.text()).toBe("x\x7f\r");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("does not touch value or selection while an IME composition is in progress", () => {
    const h = setup();
    fire(h.input, "compositionstart");
    // WebKit replaces the selected placeholder with the marked text.
    h.input.replaceSelection("に");
    const snapshot = [h.input.value, h.input.selectionStart];
    for (const type of ["focus", "keyup", "input"]) {
      fire(h.input, type, { isComposing: type === "input" });
      expect([h.input.value, h.input.selectionStart]).toEqual(snapshot);
    }
    fire(h.input, "beforeinput", {
      inputType: "insertCompositionText",
      data: "にほ",
      isComposing: true,
    });
    h.input.replaceSelection("");
    h.input.value = "にほ";
    h.input.setSelectionRange(1, 2);
    h.controller.paste("");
    fire(h.input, "keyup");
    expect(h.input.value).toBe("にほ");
    expect(h.input.selectionStart).toBe(1);
    expect(h.onData).not.toHaveBeenCalled();
    fire(h.input, "compositionend", { data: "日本" });
    expect(h.text()).toBe("日本");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("commits a dead-key sequence (Option+E, E) as one character and re-arms", () => {
    const h = setup();
    fire(h.input, "keydown", {
      key: "Dead",
      code: "KeyE",
      altKey: true,
      keyCode: 229,
      getModifierState: () => false,
    });
    fire(h.input, "compositionstart");
    h.input.replaceSelection("´");
    fire(h.input, "beforeinput", {
      inputType: "insertCompositionText",
      data: "´",
      isComposing: true,
    });
    fire(h.input, "input", { isComposing: true });
    fire(h.input, "compositionend", { data: "é" });
    // WebKit commits the final text after compositionend.
    h.input.replaceSelection("é");
    fire(h.input, "input");
    expect(h.text()).toBe("é");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("types a repeating key through keydown without ever collapsing the selection", () => {
    const h = setup();
    for (let index = 0; index < 5; index += 1) {
      const event = fire(h.input, "keydown", {
        key: "a",
        code: "KeyA",
        keyCode: 65,
        repeat: index > 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        getModifierState: () => false,
      });
      expect(event.defaultPrevented).toBe(true);
      expect(h.armed()).toBe(true);
    }
    fire(h.input, "keyup", { code: "KeyA" });
    expect(h.text()).toBe("aaaaa");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("routes native paste to the terminal and keeps the placeholder", async () => {
    const h = setup();
    const event = fire(h.input, "paste", {
      clipboardData: { getData: () => "pasted text" },
    });
    expect(event.defaultPrevented).toBe(true);
    expect(h.pasted).toHaveBeenCalledWith("pasted text");
    await Promise.resolve();
    fire(h.input, "beforeinput", {
      inputType: "insertFromPaste",
      data: "other",
    });
    expect(h.pasted).toHaveBeenLastCalledWith("other");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("keeps an emoji picker insert (insertText) as one terminal write", () => {
    const h = setup();
    fire(h.input, "beforeinput", { inputType: "insertText", data: "😀" });
    expect(h.text()).toBe("😀");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });

  it("stops listening once disposed", () => {
    const input = new FakeTextArea();
    const proxy = new TerminalInputProxy(
      input as unknown as HTMLTextAreaElement,
    );
    proxy.dispose();
    input.value = "x";
    fire(input, "input");
    expect(input.value).toBe("x");
  });

  it("lets the context menu own the field until released", () => {
    const input = new FakeTextArea();
    const proxy = new TerminalInputProxy(
      input as unknown as HTMLTextAreaElement,
    );
    proxy.expose("selected output");
    input.select();
    fire(input, "keyup");
    fire(input, "focus");
    expect(input.value).toBe("selected output");
    proxy.release();
    expect(input.value).toBe(PLACEHOLDER);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    proxy.expose("");
    expect(input.value).toBe(PLACEHOLDER);
    proxy.dispose();
  });

  it("forgets a composition abandoned by a blur", () => {
    const h = setup();
    fire(h.input, "compositionstart");
    h.input.value = "x";
    fire(h.input, "blur");
    fire(h.input, "focus");
    expect(h.armed()).toBe(true);
    h.controller.dispose();
  });
});

describe("TerminalInputProxy off macOS", () => {
  // WebKitGTK and Chromium can publish a non-collapsed selection of a focused textarea as the
  // X11 PRIMARY selection, and screen readers announce it: the placeholder is macOS only.
  it("never selects anything: the field stays empty with a collapsed selection", () => {
    const h = setup({ isMac: false });
    expect(h.input.value).toBe("");
    expect(h.input.selectionStart).toBe(h.input.selectionEnd);
    for (const type of ["focus", "keyup", "input"]) {
      fire(h.input, type);
      expect(h.input.value).toBe("");
      expect(h.input.selectionStart).toBe(h.input.selectionEnd);
    }
    h.controller.dispose();
  });

  it("empties the field after handled input, as before the placeholder existed", () => {
    const h = setup({ isMac: false });
    h.input.replaceSelection("x");
    fire(h.input, "beforeinput", { inputType: "insertText", data: "x" });
    expect(h.text()).toBe("x");
    expect(h.input.value).toBe("");
    h.input.replaceSelection("é");
    fire(h.input, "compositionstart");
    fire(h.input, "compositionend", { data: "é" });
    expect(h.text()).toBe("xé");
    expect(h.input.value).toBe("");
    h.controller.dispose();
  });

  it("leaves a composition and the context menu's text alone", () => {
    const h = setup({ isMac: false });
    fire(h.input, "compositionstart");
    h.input.value = "に";
    fire(h.input, "keyup");
    expect(h.input.value).toBe("に");
    fire(h.input, "compositionend", { data: "日" });
    expect(h.input.value).toBe("");

    const input = new FakeTextArea();
    const proxy = new TerminalInputProxy(
      input as unknown as HTMLTextAreaElement,
      { placeholder: false },
    );
    proxy.expose("selected output");
    input.select();
    fire(input, "focus");
    expect(input.value).toBe("selected output");
    proxy.release();
    expect(input.value).toBe("");
    expect(input.selectionStart).toBe(input.selectionEnd);
    proxy.dispose();
    h.controller.dispose();
  });

  it("enables the placeholder by the platform unless told otherwise", () => {
    for (const [isMac, inputPlaceholder, armed] of [
      [true, undefined, true],
      [false, undefined, false],
      [false, true, true],
      [true, false, false],
    ] as const) {
      const input = new FakeTextArea();
      const controller = new GhosttyInputController({
        model: model(),
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac,
        inputPlaceholder,
        onCopy: () => false,
        onData: () => {},
      });
      expect(input.value === PLACEHOLDER).toBe(armed);
      controller.dispose();
    }
  });
});
