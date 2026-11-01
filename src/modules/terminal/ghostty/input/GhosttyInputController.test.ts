import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { readFile } from "node:fs/promises";
import { Key, Mods } from "@terax/ghostty-core";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";
import {
  GhosttyInputController,
  type GhosttyInputControllerOptions,
  terminalMouseModifiers,
} from "./GhosttyInputController";

const clipboard = vi.hoisted(() => ({ read: vi.fn<() => Promise<string>>() }));
vi.mock("@/modules/terminal/lib/terminalClipboard", () => ({
  readTerminalClipboard: clipboard.read,
}));
beforeEach(() => {
  clipboard.read.mockReset().mockResolvedValue("clipboard text");
});

describe("terminal clipboard input", () => {
  it("sends Ctrl+C immediately and cancels a pending clipboard read", async () => {
    let complete = (_text: string) => {};
    clipboard.read.mockReturnValue(
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
    );
    const h = clipboardInput({ isWindows: true });
    try {
      h.input.dispatchEvent(
        keyboardEvent({ key: "v", code: "KeyV", ctrlKey: true }),
      );
      h.input.dispatchEvent(
        keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true }),
      );
      expect(h.onData).toHaveBeenCalledWith(Uint8Array.of(3));
      complete("cancelled");
      await Promise.resolve();
      expect(h.onData).toHaveBeenCalledOnce();
    } finally {
      h.controller.dispose();
    }
  });

  it("does not send Enter before a pending native clipboard paste", async () => {
    let complete = (_text: string) => {};
    clipboard.read.mockReturnValue(
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
    );
    const h = clipboardInput({ isWindows: true });
    h.encodeKey.mockReturnValue(Uint8Array.of(13));
    try {
      h.input.dispatchEvent(
        keyboardEvent({ key: "v", code: "KeyV", ctrlKey: true }),
      );
      h.input.dispatchEvent(keyboardEvent({ key: "Enter", code: "Enter" }));
      expect(h.onData).not.toHaveBeenCalled();
      complete("pasted command");
      await Promise.resolve();
      expect(
        h.onData.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)),
      ).toEqual(["pasted command", "\r"]);
    } finally {
      h.controller.dispose();
    }
  });

  it("does not read the clipboard repeatedly while the paste shortcut is held", async () => {
    const h = clipboardInput({ isWindows: true });
    try {
      h.input.dispatchEvent(
        keyboardEvent({ key: "v", code: "KeyV", ctrlKey: true }),
      );
      for (let index = 0; index < 20; index++)
        h.input.dispatchEvent(
          keyboardEvent({
            key: "v",
            code: "KeyV",
            ctrlKey: true,
            repeat: true,
          }),
        );
      await Promise.resolve();
      expect(clipboard.read).toHaveBeenCalledOnce();
      expect(h.onData).toHaveBeenCalledOnce();
    } finally {
      h.controller.dispose();
    }
  });

  it("clears an old selection when typing so the next Ctrl+C interrupts the CLI", () => {
    let selected = true;
    const onCopy = vi.fn(() => selected);
    const setSelection = vi.fn(() => {
      selected = false;
    });
    const h = clipboardInput({
      isWindows: true,
      onCopy,
      model: {
        ...inputModel(),
        trackedSelection: () =>
          selected
            ? {
                anchor: { line: 0, column: 0 },
                focus: { line: 0, column: 4 },
                rectangular: false,
              }
            : null,
        setSelection,
        encodeKey: () => Uint8Array.of(3),
      },
    });
    try {
      h.input.dispatchEvent(
        keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true }),
      );
      expect(selected).toBe(true);
      expect(h.onData).not.toHaveBeenCalled();
      h.input.dispatchEvent(keyboardEvent({ key: "x", code: "KeyX" }));
      expect(selected).toBe(false);
      h.input.dispatchEvent(
        keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true }),
      );
      expect(h.onData).toHaveBeenLastCalledWith(Uint8Array.of(3));
      expect(h.onData).toHaveBeenCalledTimes(2);
      expect(setSelection).toHaveBeenCalledOnce();
    } finally {
      h.controller.dispose();
    }
  });

  it.each([
    { isMac: false, isWindows: true, key: "v", code: "KeyV", ctrlKey: true },
    {
      isMac: false,
      isWindows: true,
      key: "V",
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
    },
    {
      isMac: false,
      isWindows: false,
      key: "V",
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
    },
    {
      isMac: false,
      isWindows: true,
      key: "Insert",
      code: "Insert",
      shiftKey: true,
    },
    { isMac: true, isWindows: false, key: "v", code: "KeyV", metaKey: true },
  ])(
    "pastes once for $code on Windows=$isWindows macOS=$isMac",
    async (values) => {
      const h = clipboardInput(values);
      try {
        const event = keyboardEvent(values);
        h.input.dispatchEvent(event);
        await Promise.resolve();
        expect(event.defaultPrevented).toBe(true);
        expect(clipboard.read).toHaveBeenCalledOnce();
        expect(h.onData).toHaveBeenCalledOnce();
        expect(new TextDecoder().decode(h.onData.mock.calls[0][0])).toBe(
          "clipboard text",
        );
        expect(h.encodeKey).not.toHaveBeenCalled();
      } finally {
        h.controller.dispose();
      }
    },
  );

  it("keeps Linux Ctrl+V and Windows Ctrl+C without a selection available to the CLI", () => {
    for (const values of [
      { isWindows: false, key: "v", code: "KeyV" },
      { isWindows: true, key: "c", code: "KeyC" },
    ]) {
      const h = clipboardInput({ isMac: false, isWindows: values.isWindows });
      try {
        h.input.dispatchEvent(keyboardEvent({ ...values, ctrlKey: true }));
        expect(h.encodeKey).toHaveBeenCalledOnce();
        expect(clipboard.read).not.toHaveBeenCalled();
      } finally {
        h.controller.dispose();
      }
    }
  });

  it.each([
    { key: "c", code: "KeyC", ctrlKey: true },
    { key: "C", code: "KeyC", ctrlKey: true, shiftKey: true },
    { key: "Insert", code: "Insert", ctrlKey: true },
  ])(
    "copies a Windows selection with $code instead of interrupting the CLI",
    (values) => {
      const onCopy = vi.fn(() => true);
      const h = clipboardInput({ isMac: false, isWindows: true, onCopy });
      try {
        const event = keyboardEvent(values);
        h.input.dispatchEvent(event);
        expect(onCopy).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
        expect(h.onData).not.toHaveBeenCalled();
        expect(h.encodeKey).not.toHaveBeenCalled();
      } finally {
        h.controller.dispose();
      }
    },
  );

  it("reports clipboard read failures without sending empty input", async () => {
    const error = new Error("clipboard busy");
    clipboard.read.mockRejectedValue(error);
    const onClipboardError = vi.fn();
    const h = clipboardInput({ isWindows: true, onClipboardError });
    try {
      h.input.dispatchEvent(
        keyboardEvent({ key: "v", code: "KeyV", ctrlKey: true }),
      );
      await Promise.resolve();
      expect(onClipboardError).toHaveBeenCalledWith(error);
      expect(h.onData).not.toHaveBeenCalled();
    } finally {
      h.controller.dispose();
    }
  });

  it.each([false, true])(
    "ignores a late clipboard completion after disposal (reject=%s)",
    async (reject) => {
      let finish = (_text: string) => {};
      let fail = (_error: Error) => {};
      clipboard.read.mockReturnValue(
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      const onClipboardError = vi.fn();
      const h = clipboardInput({ isWindows: true, onClipboardError });
      h.input.dispatchEvent(
        keyboardEvent({ key: "v", code: "KeyV", ctrlKey: true }),
      );
      h.controller.dispose();
      if (reject) fail(new Error("closed"));
      else finish("late text");
      await Promise.resolve();
      expect(onClipboardError).not.toHaveBeenCalled();
      expect(h.onData).not.toHaveBeenCalled();
    },
  );

  it("handles a native paste once while allowing repeated identical pastes", () => {
    const h = clipboardInput();
    try {
      const paste = () =>
        h.input.dispatchEvent(
          Object.assign(new Event("paste", { cancelable: true }), {
            clipboardData: { getData: () => "text" },
          }),
        );
      paste();
      h.input.dispatchEvent(
        Object.assign(new Event("beforeinput", { cancelable: true }), {
          inputType: "insertFromPaste",
          data: "text",
          isComposing: false,
        }),
      );
      expect(h.onData).toHaveBeenCalledOnce();
      paste();
      expect(h.onData).toHaveBeenCalledTimes(2);
    } finally {
      h.controller.dispose();
    }
  });

  it("reads the native clipboard when the paste input event has no text payload", async () => {
    const h = clipboardInput();
    try {
      const event = Object.assign(
        new Event("beforeinput", { cancelable: true }),
        {
          inputType: "insertFromPaste",
          data: null,
          isComposing: false,
        },
      );
      h.input.dispatchEvent(event);
      await Promise.resolve();
      expect(event.defaultPrevented).toBe(true);
      expect(h.onData).toHaveBeenCalledOnce();
      expect(new TextDecoder().decode(h.onData.mock.calls[0][0])).toBe(
        "clipboard text",
      );
    } finally {
      h.controller.dispose();
    }
  });
});

function clipboardInput(options: Partial<GhosttyInputControllerOptions> = {}) {
  const input = new FakeTextArea();
  const onData = vi.fn();
  const encodeKey = vi.fn(() => Uint8Array.of(3));
  const controller = new GhosttyInputController({
    model: { ...inputModel(), encodeKey },
    input: input as unknown as HTMLTextAreaElement,
    pointerTarget: new FakeElement() as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    isMac: false,
    isWindows: false,
    onCopy: () => false,
    onData,
    ...options,
  });
  return { controller, input, onData, encodeKey };
}

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
  it.each([false, true])(
    "routes macOS Option arrows tagged 229 (alternate: %s)",
    (alternateScreen) => {
      const input = new FakeTextArea();
      const onData = vi.fn();
      const base = inputModel();
      const encodeKey = vi.fn<GhosttyTerminalModelApi["encodeKey"]>((event) =>
        new TextEncoder().encode(
          event.key === Key.LEFT ? "\x1b[1;3D" : "\x1b[1;3C",
        ),
      );
      const controller = new GhosttyInputController({
        model: {
          ...base,
          modes: () => ({ ...base.modes(), alternateScreen }),
          encodeKey,
        },
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac: true,
        onCopy: () => false,
        onData,
      });
      try {
        for (const [key, sequence, encodedKey, alternateSequence] of [
          ["ArrowLeft", "\x1bb", Key.LEFT, "\x1b[1;3D"],
          ["ArrowRight", "\x1bf", Key.RIGHT, "\x1b[1;3C"],
        ] as const) {
          const event = keyboardEvent({
            key,
            code: key,
            altKey: true,
            keyCode: 229,
          });
          input.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          expect(new TextDecoder().decode(onData.mock.lastCall?.[0])).toBe(
            alternateScreen ? alternateSequence : sequence,
          );
          if (alternateScreen)
            expect(encodeKey).toHaveBeenLastCalledWith(
              expect.objectContaining({ key: encodedKey, mods: Mods.ALT }),
            );
        }
        expect(encodeKey).toHaveBeenCalledTimes(alternateScreen ? 2 : 0);
        onData.mockClear();
        for (const values of [
          { key: "a", code: "KeyA" },
          { key: "Process", code: "ArrowLeft" },
          { key: "ArrowLeft", code: "ArrowLeft", isComposing: true },
        ])
          input.dispatchEvent(
            keyboardEvent({ ...values, altKey: true, keyCode: 229 }),
          );
        input.dispatchEvent(new Event("compositionstart"));
        input.dispatchEvent(
          keyboardEvent({
            key: "ArrowLeft",
            code: "ArrowLeft",
            altKey: true,
            keyCode: 229,
          }),
        );
        expect(onData).not.toHaveBeenCalled();
      } finally {
        controller.dispose();
      }
    },
  );

  it.each(["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"])(
    "encodes both Option-arrow directions with the shipped core (%s)",
    async (artifact) => {
      const bytes = await readFile(
        new URL(
          `../../../../../packages/ghostty-core/adapted/${artifact}`,
          import.meta.url,
        ),
      );
      const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
      const terminal = core.createTerminal(80, 24);
      const input = new FakeTextArea();
      const onData = vi.fn();
      const controller = new GhosttyInputController({
        model: {
          ...inputModel(),
          modes: () => terminal.modes(),
          encodeKey: (event) => terminal.encodeKey(event),
        },
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac: true,
        onCopy: () => false,
        onData,
      });
      try {
        for (const alternateScreen of [false, true]) {
          terminal.write(
            new TextEncoder().encode(
              alternateScreen ? "\x1b[?1049h" : "\x1b[?1049l",
            ),
          );
          for (const [mode, eventType] of [
            [0, ""],
            [1, ""],
            [11, ":1"],
            [31, ":1"],
          ] as const) {
            terminal.write(new TextEncoder().encode(`\x1b[=${mode}u`));
            for (const [key, normal, suffix] of [
              ["ArrowLeft", "\x1bb", "D"],
              ["ArrowRight", "\x1bf", "C"],
            ]) {
              onData.mockClear();
              const event = keyboardEvent({
                key,
                code: key,
                altKey: true,
                keyCode: 229,
              });
              input.dispatchEvent(event);
              expect(event.defaultPrevented).toBe(true);
              expect(onData).toHaveBeenCalledOnce();
              expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe(
                alternateScreen ? `\x1b[1;3${eventType}${suffix}` : normal,
              );
            }
          }
        }
      } finally {
        controller.dispose();
        terminal.dispose();
      }
    },
  );

  it.each([
    { isMac: false },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: false },
    { key: "ArrowUp", code: "ArrowUp" },
    { key: "Dead" },
    { key: "Process" },
    { isComposing: true },
  ])("retains the 229 guard for %j", ({ isMac = true, ...values }) => {
    const input = new FakeTextArea();
    const onData = vi.fn();
    const encodeKey = vi.fn(() => Uint8Array.of(27, 91, 68));
    const controller = new GhosttyInputController({
      model: { ...inputModel(), encodeKey },
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      isMac,
      onCopy: () => false,
      onData,
    });
    try {
      const event = keyboardEvent({
        key: "ArrowLeft",
        code: "ArrowLeft",
        altKey: true,
        keyCode: 229,
        ...values,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(onData).not.toHaveBeenCalled();
      expect(encodeKey).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it.each(["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"])(
    "leaves macOS Command shortcuts to the application in legacy and Kitty modes (%s)",
    async (artifact) => {
      const bytes = await readFile(
        new URL(
          `../../../../../packages/ghostty-core/adapted/${artifact}`,
          import.meta.url,
        ),
      );
      const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
      const terminal = core.createTerminal(80, 24);
      const input = new FakeTextArea();
      const onData = vi.fn();
      const encodeKey = vi.fn<GhosttyTerminalModelApi["encodeKey"]>((event) =>
        terminal.encodeKey(event),
      );
      const controller = new GhosttyInputController({
        model: { ...inputModel(), encodeKey },
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac: true,
        onCopy: () => false,
        onData,
      });
      try {
        for (const mode of [0, 1, 11, 31]) {
          terminal.write(new TextEncoder().encode(`\x1b[=${mode}u`));
          for (const values of [
            { key: "q", code: "KeyQ" },
            { key: "h", code: "KeyH" },
            { key: "m", code: "KeyM" },
            { key: "h", code: "KeyH", altKey: true },
            { key: "c", code: "KeyC" },
          ]) {
            for (const type of ["keydown", "keyup"]) {
              const event = keyboardEvent({ ...values, metaKey: true }, type);
              const stopPropagation = vi.spyOn(event, "stopPropagation");
              input.dispatchEvent(event);
              expect(event.defaultPrevented).toBe(false);
              expect(stopPropagation).not.toHaveBeenCalled();
            }
          }
        }
        expect(encodeKey).not.toHaveBeenCalled();
        expect(onData).not.toHaveBeenCalled();
      } finally {
        controller.dispose();
        terminal.dispose();
      }
    },
  );

  it("preserves explicit macOS editing shortcuts and non-macOS Super encoding", () => {
    for (const isMac of [true, false]) {
      const input = new FakeTextArea();
      const onData = vi.fn();
      const onCopy = vi.fn(() => true);
      const encodeKey = vi.fn(() => new Uint8Array([27, 113]));
      const controller = new GhosttyInputController({
        model: { ...inputModel(), encodeKey },
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac,
        onCopy,
        onData,
      });
      try {
        if (isMac) {
          const copy = keyboardEvent({ key: "c", code: "KeyC", metaKey: true });
          input.dispatchEvent(copy);
          expect(copy.defaultPrevented).toBe(true);
          expect(onCopy).toHaveBeenCalledOnce();
          expect(onData).not.toHaveBeenCalled();
          for (const [key, sequence] of [
            ["ArrowLeft", "\x01"],
            ["ArrowRight", "\x05"],
            ["Backspace", "\x15"],
          ]) {
            const event = keyboardEvent({ key, code: key, metaKey: true });
            input.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(new TextDecoder().decode(onData.mock.lastCall?.[0])).toBe(
              sequence,
            );
          }
          expect(encodeKey).not.toHaveBeenCalled();
        } else {
          const event = keyboardEvent({
            key: "q",
            code: "KeyQ",
            metaKey: true,
          });
          input.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          expect(encodeKey).toHaveBeenCalledOnce();
          expect(onData).toHaveBeenCalledWith(new Uint8Array([27, 113]));
        }
      } finally {
        controller.dispose();
      }
    }
  });

  it.each(["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"])(
    "preserves Control through Fish's Kitty keyboard mode (%s)",
    async (artifact) => {
      const bytes = await readFile(
        new URL(
          `../../../../../packages/ghostty-core/adapted/${artifact}`,
          import.meta.url,
        ),
      );
      const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
      const terminal = core.createTerminal(80, 24);
      const input = new FakeTextArea();
      const onData = vi.fn();
      const controller = new GhosttyInputController({
        model: {
          ...inputModel(),
          encodeKey: (event) => terminal.encodeKey(event),
        },
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac: true,
        onCopy: () => false,
        onData,
      });
      try {
        terminal.write(new TextEncoder().encode("\x1b[>1u"));
        input.dispatchEvent(
          keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true }),
        );
        expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe(
          "\x1b[99;5u",
        );
        terminal.write(new TextEncoder().encode("\x1b[<u"));
        input.dispatchEvent(
          keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true }),
        );
        expect(onData.mock.calls[1][0]).toEqual(new Uint8Array([3]));
        terminal.write(new TextEncoder().encode("\x1b[>11u"));
        input.dispatchEvent(keyboardEvent({ key: "x", code: "KeyX" }));
        input.dispatchEvent(
          Object.assign(new Event("keyup", { cancelable: true }), {
            key: "x",
            code: "KeyX",
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            shiftKey: false,
            getModifierState: () => false,
          }),
        );
        expect(new TextDecoder().decode(onData.mock.calls[2][0])).toBe(
          "\x1b[120u",
        );
        expect(new TextDecoder().decode(onData.mock.calls[3][0])).toBe(
          "\x1b[120;1:3u",
        );
      } finally {
        controller.dispose();
        terminal.dispose();
      }
    },
  );

  it("routes prompt paste to the command editor without also sending PTY bytes", () => {
    const model = inputModel();
    const onData = vi.fn();
    const onPaste = vi.fn(() => true);
    const controller = new GhosttyInputController({
      model,
      input: new FakeTextArea() as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      isMac: true,
      onCopy: () => false,
      onData,
      onPaste,
    });
    controller.paste("echo text");
    expect(onPaste).toHaveBeenCalledWith("echo text");
    expect(onData).not.toHaveBeenCalled();
    onPaste.mockReturnValue(false);
    controller.paste("process input");
    expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe(
      "process input",
    );
    controller.dispose();
  });

  it("routes keys and composed text back to the prompt after a native menu", () => {
    const input = new FakeTextArea();
    const onKeyDown = vi.fn(() => true);
    const onText = vi.fn(() => true);
    const onData = vi.fn();
    const controller = new GhosttyInputController({
      model: inputModel(),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      isMac: true,
      onCopy: () => false,
      onKeyDown,
      onText,
      onData,
    });
    const interrupt = keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true });
    input.dispatchEvent(interrupt);
    expect(onKeyDown).toHaveBeenCalledWith(interrupt);
    expect(interrupt.defaultPrevented).toBe(true);
    onKeyDown.mockReturnValue(false);
    input.dispatchEvent(keyboardEvent({ key: "x", code: "KeyX" }));
    expect(onText).toHaveBeenCalledWith("x");
    input.dispatchEvent(
      Object.assign(new Event("compositionend"), { data: "あ" }),
    );
    input.dispatchEvent(
      Object.assign(new Event("beforeinput", { cancelable: true }), {
        inputType: "insertText",
        data: "あ",
        isComposing: false,
      }),
    );
    expect(onText.mock.calls).toEqual([["x"], ["あ"]]);
    expect(onData).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("delivers Ctrl+C to the terminal and leaves unencoded shortcuts unconsumed", () => {
    const input = new FakeTextArea();
    const onData = vi.fn();
    const encodeKey = vi.fn(() => new Uint8Array([3]));
    const controller = new GhosttyInputController({
      model: { ...inputModel(), encodeKey },
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      isMac: true,
      onCopy: () => true,
      onData,
    });
    const interrupt = keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true });
    input.dispatchEvent(interrupt);
    expect(interrupt.defaultPrevented).toBe(true);
    expect(onData).toHaveBeenCalledWith(new Uint8Array([3]));
    encodeKey.mockReturnValue(new Uint8Array(0));
    const shortcut = keyboardEvent({ key: "p", code: "KeyP", metaKey: true });
    input.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    const handled = keyboardEvent({ key: "c", code: "KeyC", ctrlKey: true });
    handled.preventDefault();
    input.dispatchEvent(handled);
    expect(onData).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("commits IME text once and leaves dead-key composition to the webview", () => {
    const input = new FakeTextArea();
    const onData = vi.fn();
    const model = inputModel();
    const encodeKey = vi.fn(() => new Uint8Array(0));
    const controller = new GhosttyInputController({
      model: { ...model, encodeKey },
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      onData,
      onCopy: () => false,
      isMac: false,
    });
    input.dispatchEvent(keyboardEvent({ key: "Dead", code: "Quote" }));
    expect(encodeKey).not.toHaveBeenCalled();
    input.dispatchEvent(new Event("compositionstart"));
    input.dispatchEvent(
      keyboardEvent({ key: "a", code: "KeyA", isComposing: true }),
    );
    input.dispatchEvent(
      Object.assign(new Event("beforeinput"), {
        inputType: "insertCompositionText",
        data: "あ",
        isComposing: true,
      }),
    );
    expect(onData).not.toHaveBeenCalled();
    input.dispatchEvent(
      Object.assign(new Event("compositionend"), { data: "あ" }),
    );
    input.dispatchEvent(
      Object.assign(new Event("beforeinput", { cancelable: true }), {
        inputType: "insertText",
        data: "あ",
        isComposing: false,
      }),
    );
    expect(onData).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe("あ");
    controller.dispose();
  });

  it("encodes AltGr characters and keeps a duplicate beforeinput from typing twice", () => {
    const input = new FakeTextArea();
    const onData = vi.fn();
    const controller = new GhosttyInputController({
      model: inputModel(),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      onData,
      onCopy: () => false,
      isMac: false,
    });
    input.dispatchEvent(
      keyboardEvent({
        key: "@",
        code: "KeyQ",
        altKey: true,
        ctrlKey: true,
        getModifierState: (key) => key === "AltGraph",
      }),
    );
    input.dispatchEvent(
      Object.assign(new Event("beforeinput", { cancelable: true }), {
        inputType: "insertText",
        data: "@",
        isComposing: false,
      }),
    );
    expect(onData).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(onData.mock.calls[0][0])).toBe("@");
    controller.dispose();
  });

  it("does not deliver a late clipboard result after the input owner is disposed", () => {
    const model = inputModel();
    const modes = vi.fn(model.modes);
    const onData = vi.fn();
    const input = new FakeTextArea();
    const controller = new GhosttyInputController({
      model: { ...model, modes },
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      onData,
      onCopy: () => false,
      isMac: false,
    });
    controller.dispose();
    controller.paste("late clipboard");
    input.dispatchEvent(keyboardEvent({ key: "x", code: "KeyX" }));
    expect(onData).not.toHaveBeenCalled();
    expect(modes).not.toHaveBeenCalled();
  });
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

  it("reports the cell that is drawn under the pointer while the grid is shifted up", () => {
    const input = new FakeTextArea();
    const pointerTarget = new FakeElement();
    const onData = vi.fn();
    let shift = 40;
    const controller = new GhosttyInputController({
      model: inputModel((mode) => mode === 1003 || mode === 1006),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: pointerTarget as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      gridShiftY: () => shift,
      onData,
      onCopy: () => false,
      isMac: false,
    });
    const report = (clientY: number) => {
      onData.mockClear();
      pointerTarget.dispatchEvent(
        mouseEvent("mousemove", { clientX: 15, clientY }),
      );
      return new TextDecoder().decode(onData.mock.calls[0][0]);
    };
    // 25 px down with the grid moved up 40 px is 65 px into the grid: row 4 (1-based).
    expect(report(25)).toBe("\x1b[<32;2;4M");
    shift = 0;
    expect(report(31)).toBe("\x1b[<32;2;2M");
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

function keyboardEvent(
  values: Partial<KeyboardEvent>,
  type = "keydown",
): KeyboardEvent {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
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
  }) as KeyboardEvent;
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
