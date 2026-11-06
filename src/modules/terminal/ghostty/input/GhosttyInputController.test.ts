import { readFile } from "node:fs/promises";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { Key, Mods } from "@terax/ghostty-core";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeTextArea } from "./fakeTextArea";
import { GhosttyInputController } from "./GhosttyInputController";
import { terminalMouseModifiers } from "./TerminalMouse";
import { MAX_WHEEL_REPORTS_PER_EVENT } from "./terminalWheel";

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
  describe("mouse wheel", () => {
    let h: ReturnType<typeof wheelHarness>;
    const UP = "\x1b[<64;1;1M";
    const DOWN = "\x1b[<65;1;1M";

    beforeEach(async () => {
      h = wheelHarness();
      await vi.dynamicImportSettled();
    });

    afterEach(() => {
      h.controller.dispose();
    });

    it("accumulates small pixels without layout reads or input until a report is due", () => {
      for (let i = 0; i < 11; i++) {
        expect(h.wheel(5).defaultPrevented).toBe(true);
      }
      expect(h.onData).not.toHaveBeenCalled();
      expect(h.bounds).not.toHaveBeenCalled();
      h.wheel(5);
      expect(h.reports()).toEqual([DOWN]);
      expect(h.bounds).toHaveBeenCalledTimes(1);
      expect(h.scrollBy).not.toHaveBeenCalled();
    });

    it.each([
      [0, 60, 1],
      [0, 120, 2],
      [0, 170, 2],
      [1, 3, 1],
      [1, 6, 2],
      [2, 0.25, 2],
    ])(
      "reports one notch per three lines, in one write (mode %s, delta %s -> %s)",
      (mode, delta, reports) => {
        h.wheel(delta, mode);
        expect(h.reports()).toEqual([DOWN.repeat(reports)]);
        h.wheel(-delta, mode);
        expect(h.reports()).toEqual([DOWN.repeat(reports), UP.repeat(reports)]);
      },
    );

    it.each([
      [0, 2000],
      [0, Number.MAX_VALUE],
      [1, 1000],
      [2, 40],
    ])(
      "caps a runaway event (mode %s, delta %s) and queues no excess",
      (mode, delta) => {
        h.wheel(delta, mode);
        expect(h.reports()).toEqual([DOWN.repeat(MAX_WHEEL_REPORTS_PER_EVENT)]);
        h.onData.mockClear();
        h.wheel(-30);
        expect(h.onData).not.toHaveBeenCalled();
        h.wheel(-30);
        expect(h.reports()).toEqual([UP]);
      },
    );

    it("keeps the fraction between events and drops it on reversal", () => {
      h.wheel(45);
      expect(h.onData).not.toHaveBeenCalled();
      h.wheel(45);
      expect(h.reports()).toEqual([DOWN]);
      h.onData.mockClear();
      h.wheel(15);
      h.wheel(-15);
      expect(h.onData).not.toHaveBeenCalled();
      h.wheel(-45);
      expect(h.reports()).toEqual([UP]);
    });

    it("ignores zero, horizontal-only and non-finite motion without poisoning the remainder", () => {
      h.wheel(30);
      for (const delta of [0, Number.NaN, Infinity, -Infinity]) {
        expect(h.wheel(delta, 0, { deltaX: 100 }).defaultPrevented).toBe(false);
      }
      expect(h.onData).not.toHaveBeenCalled();
      expect(h.bounds).not.toHaveBeenCalled();
      h.wheel(30);
      expect(h.reports()).toEqual([DOWN]);
    });

    it("scales the distance by the scroll speed preference at once", () => {
      h.speed.value = 0.5;
      h.wheel(120);
      expect(h.reports()).toEqual([DOWN]);
      h.speed.value = 3;
      h.onData.mockClear();
      h.wheel(40);
      expect(h.reports()).toEqual([DOWN.repeat(2)]);
    });

    it.each([true, false])(
      "keeps encoding and modifiers intact (SGR: %s)",
      (sgr) => {
        h.state.sgr = sgr;
        h.wheel(60, 0, { ctrlKey: true, altKey: true });
        expect(h.reports()).toEqual([sgr ? "\x1b[<89;1;1M" : "\x1b[My!!"]);
      },
    );

    it.each(["shift", "tracking"] as const)(
      "clears the remainder when switching through %s scrollback",
      (route) => {
        const options = route === "shift" ? { shiftKey: true } : {};
        h.wheel(30);
        if (route === "tracking") h.state.mouseTracking = false;
        h.wheel(10, 0, options);
        expect(h.scrollBy).not.toHaveBeenCalled();
        h.state.mouseTracking = true;
        h.wheel(30);
        expect(h.onData).not.toHaveBeenCalled();
        if (route === "tracking") h.state.mouseTracking = false;
        h.wheel(10, 0, options);
        expect(h.scrollBy).not.toHaveBeenCalled();
        h.wheel(10, 0, options);
        expect(h.scrollBy).toHaveBeenCalledExactlyOnceWith(1);
      },
    );

    it("clears mouse motion even when the scrollback route has no history", () => {
      h.wheel(30);
      h.state.history = 0;
      h.wheel(10, 0, { shiftKey: true });
      h.wheel(30);
      expect(h.onData).not.toHaveBeenCalled();
    });

    it("preserves pixel, line and page distances in ordinary scrollback", () => {
      h.state.mouseTracking = false;
      h.wheel(40);
      h.wheel(-3, 1);
      h.wheel(1, 2);
      expect(h.scrollBy.mock.calls).toEqual([[2], [-3], [24]]);
      expect(h.onData).not.toHaveBeenCalled();
      expect(h.bounds).not.toHaveBeenCalled();
    });

    describe("alternate scroll (DEC 1007)", () => {
      beforeEach(() => {
        h.state.mouseTracking = false;
        h.state.alternateScreen = true;
        h.state.history = 0;
      });

      it("sends cursor keys, one per line, on the alternate screen", () => {
        const event = h.wheel(60);
        expect(event.defaultPrevented).toBe(true);
        h.wheel(-40);
        expect(h.reports()).toEqual(["\x1b[B".repeat(3), "\x1b[A".repeat(2)]);
        expect(h.scrollBy).not.toHaveBeenCalled();
        expect(h.bounds).not.toHaveBeenCalled();
      });

      it("honours application cursor keys", () => {
        h.state.applicationCursor = true;
        h.wheel(20);
        h.wheel(-20);
        expect(h.reports()).toEqual(["\x1bOB", "\x1bOA"]);
      });

      it("leaves the wheel alone when the application turned alternate scroll off", () => {
        h.state.alternateScroll = false;
        const event = h.wheel(60);
        expect(event.defaultPrevented).toBe(false);
        expect(h.onData).not.toHaveBeenCalled();
        expect(h.scrollBy).not.toHaveBeenCalled();
      });

      it("does not apply on the primary screen", () => {
        h.state.alternateScreen = false;
        h.state.history = 100;
        h.wheel(60);
        expect(h.onData).not.toHaveBeenCalled();
        expect(h.scrollBy).toHaveBeenCalledExactlyOnceWith(3);
      });

      it("mouse tracking wins over alternate scroll, Shift hands the wheel back", () => {
        h.state.mouseTracking = true;
        h.wheel(60);
        expect(h.reports()).toEqual([DOWN]);
        h.onData.mockClear();
        h.wheel(20, 0, { shiftKey: true });
        expect(h.reports()).toEqual(["\x1b[B"]);
      });

      it("caps the burst like mouse reports", () => {
        h.wheel(5000);
        expect(h.reports()).toEqual([
          "\x1b[B".repeat(MAX_WHEEL_REPORTS_PER_EVENT),
        ]);
      });
    });

    it("stops handling wheel input after disposal", () => {
      h.controller.dispose();
      h.wheel(100);
      expect(h.onData).not.toHaveBeenCalled();
      expect(h.bounds).not.toHaveBeenCalled();
    });
  });

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
          kittyKeyboardFlags: () => terminal.kittyKeyboardFlags(),
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
            [11, ""],
            [31, ""],
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
    { key: "Dead", code: "Quote" },
    { key: "Process", code: "ArrowLeft" },
    { isComposing: true },
    { key: "Enter", code: "Enter", altKey: false },
    { key: "Backspace", code: "Backspace", altKey: false },
    { key: "Escape", code: "Escape", altKey: false },
    { key: "a", code: "KeyA", altKey: false },
    { key: " ", code: "Space", altKey: false },
  ])("retains the 229 guard for %j", ({ ...values }) => {
    const input = new FakeTextArea();
    const onData = vi.fn();
    const encodeKey = vi.fn(() => Uint8Array.of(27, 91, 68));
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

  it("deletes a word for Option+Backspace even when WebKit tags it 229", () => {
    const input = new FakeTextArea();
    const onData = vi.fn();
    const controller = new GhosttyInputController({
      model: inputModel(),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: new FakeElement() as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      isMac: true,
      onCopy: () => false,
      onData,
    });
    try {
      const event = keyboardEvent({
        key: "Backspace",
        code: "Backspace",
        altKey: true,
        keyCode: 229,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(new TextDecoder().decode(onData.mock.lastCall?.[0])).toBe("\x17");
    } finally {
      controller.dispose();
    }
  });

  it.each([
    { isMac: false, altKey: false, key: "ArrowUp", code: "ArrowUp" },
    { isMac: false, altKey: false, key: "ArrowDown", code: "ArrowDown" },
    { isMac: false, altKey: false, key: "Home", code: "Home" },
    { isMac: false, ctrlKey: true, key: "ArrowRight", code: "ArrowRight" },
    { isMac: true, altKey: true, key: "ArrowUp", code: "ArrowUp" },
    { isMac: true, altKey: false, key: "End", code: "End" },
    { isMac: false, altKey: false, key: "F5", code: "F5" },
    { isMac: false, altKey: false, key: "PageDown", code: "PageDown" },
  ])(
    "delivers navigation keys an IME tagged 229 when nothing is composed (%j)",
    ({ isMac, ...values }) => {
      const input = new FakeTextArea();
      const onData = vi.fn();
      const encodeKey = vi.fn(() => Uint8Array.of(27, 91, 65));
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
        const event = keyboardEvent({ keyCode: 229, ...values });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(onData).toHaveBeenCalledWith(Uint8Array.of(27, 91, 65));
        input.dispatchEvent(new Event("compositionstart"));
        onData.mockClear();
        input.dispatchEvent(keyboardEvent({ keyCode: 229, ...values }));
        expect(onData).not.toHaveBeenCalled();
      } finally {
        controller.dispose();
      }
    },
  );

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
          kittyKeyboardFlags: () => terminal.kittyKeyboardFlags(),
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

  it.each(["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"])(
    "types the shifted character under Kitty flags 3 (%s)",
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
          kittyKeyboardFlags: () => terminal.kittyKeyboardFlags(),
        },
        input: input as unknown as HTMLTextAreaElement,
        pointerTarget: new FakeElement() as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        isMac: true,
        onCopy: () => false,
        onData,
      });
      try {
        // Disambiguate escape codes + report event types, as Neovim pushes.
        terminal.write(new TextEncoder().encode("\x1b[>3u"));
        const sent = (values: Partial<KeyboardEvent>): string => {
          onData.mockClear();
          input.dispatchEvent(keyboardEvent(values));
          return new TextDecoder().decode(onData.mock.calls[0]?.[0]);
        };
        expect(sent({ key: ":", code: "Semicolon", shiftKey: true })).toBe(":");
        expect(sent({ key: "!", code: "Digit1", shiftKey: true })).toBe("!");
        expect(sent({ key: "A", code: "KeyA", shiftKey: true })).toBe("A");
        expect(sent({ key: "a", code: "KeyA" })).toBe("a");
        expect(
          sent({ key: "A", code: "KeyA", shiftKey: true, ctrlKey: true }),
        ).toBe("\x1b[97;6u");
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

  it.each([
    [0, [27, 91, 77, 32, 128, 128]],
    [1005, [27, 91, 77, 32, 194, 128, 194, 128]],
    [1006, Array.from(new TextEncoder().encode("\x1b[<0;96;96M"))],
  ])(
    "preserves the mouse wire encoding for mode %s",
    async (mode, expected) => {
      const pointerTarget = new FakeElement();
      const onData = vi.fn();
      const controller = new GhosttyInputController({
        model: {
          ...inputModel((value) => value === mode),
          cols: 300,
          rows: 300,
        },
        input: new FakeTextArea() as unknown as HTMLTextAreaElement,
        pointerTarget: pointerTarget as unknown as HTMLElement,
        cellSize: () => ({ width: 10, height: 20 }),
        onData,
        onCopy: () => false,
        isMac: false,
      });
      await vi.dynamicImportSettled();
      pointerTarget.dispatchEvent(
        mouseEvent("mousedown", { clientX: 955, clientY: 1910 }),
      );
      expect(Array.from(onData.mock.calls[0][0] as Uint8Array)).toEqual(
        expected,
      );
      controller.dispose();
    },
  );

  it("reports the cell that is drawn under the pointer while the grid is shifted up", async () => {
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
    await vi.dynamicImportSettled();
    const report = (clientY: number) => {
      onData.mockClear();
      pointerTarget.dispatchEvent(
        mouseEvent("mousemove", { clientX: 15, clientY }),
      );
      return new TextDecoder().decode(onData.mock.calls[0][0]);
    };
    // 25 px down with the grid moved up 40 px is 65 px into the grid: row 4 (1-based).
    expect(report(25)).toBe("\x1b[<35;2;4M");
    shift = 0;
    expect(report(31)).toBe("\x1b[<35;2;2M");
    controller.dispose();
  });

  it("deduplicates identical mouse-motion reports within a cell", async () => {
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
    await vi.dynamicImportSettled();

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
      "\x1b[<35;2;2M",
    );
    controller.dispose();
  });

  it("ends the press when the button is released with Shift held, so later motion is not a drag", async () => {
    const input = new FakeTextArea();
    const pointerTarget = new FakeElement();
    const onData = vi.fn();
    const controller = new GhosttyInputController({
      model: inputModel((mode) => mode === 1002 || mode === 1006),
      input: input as unknown as HTMLTextAreaElement,
      pointerTarget: pointerTarget as unknown as HTMLElement,
      cellSize: () => ({ width: 10, height: 20 }),
      onData,
      onCopy: () => false,
      isMac: false,
    });
    await vi.dynamicImportSettled();
    const at = { clientX: 15, clientY: 25 };
    pointerTarget.dispatchEvent(mouseEvent("mousedown", at));
    pointerTarget.dispatchEvent(
      mouseEvent("mouseup", { ...at, shiftKey: true }),
    );
    expect(
      onData.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)),
    ).toEqual(["\x1b[<0;2;2M", "\x1b[<4;2;2m"]);
    onData.mockClear();
    pointerTarget.dispatchEvent(
      mouseEvent("mousemove", { clientX: 35, clientY: 45 }),
    );
    expect(onData).not.toHaveBeenCalled();
    controller.dispose();
  });
});

function wheelHarness() {
  const state = {
    mouseTracking: true,
    history: 100,
    sgr: true,
    alternateScreen: false,
    alternateScroll: true,
    applicationCursor: false,
  };
  const speed = { value: 1 };
  const pointer = new FakeElement();
  const bounds = vi.spyOn(pointer, "getBoundingClientRect");
  const onData = vi.fn<(bytes: Uint8Array) => void>();
  const scrollBy = vi.fn(() => true);
  const base = inputModel((mode) => {
    if (mode === 1006) return state.sgr;
    if (mode === 1007) return state.alternateScroll;
    if (mode === 1) return state.applicationCursor;
    return false;
  });
  const controller = new GhosttyInputController({
    model: {
      ...base,
      modes: () => ({
        ...base.modes(),
        mouseTracking: state.mouseTracking,
        alternateScreen: state.alternateScreen,
      }),
      scrollPosition: () => ({ offset: 0, history: state.history }),
      scrollBy,
    },
    input: new FakeTextArea() as unknown as HTMLTextAreaElement,
    pointerTarget: pointer as unknown as HTMLElement,
    cellSize: () => ({ width: 10, height: 20 }),
    isMac: true,
    onCopy: () => false,
    onData,
    scrollSpeed: () => speed.value,
  });
  return {
    state,
    speed,
    controller,
    onData,
    scrollBy,
    bounds,
    reports: () =>
      onData.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)),
    wheel(deltaY: number, deltaMode = 0, options: Partial<WheelEvent> = {}) {
      const event = Object.assign(new Event("wheel", { cancelable: true }), {
        deltaY,
        deltaMode,
        clientX: 5,
        clientY: 5,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        ...options,
      });
      pointer.dispatchEvent(event);
      return event;
    },
  };
}

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
    cursor: () => ({
      x: 4,
      y: 2,
      visible: true,
      blinking: false,
      style: "block",
    }),
    encodeKey: () => new Uint8Array(0),
    kittyKeyboardFlags: () => 0,
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
