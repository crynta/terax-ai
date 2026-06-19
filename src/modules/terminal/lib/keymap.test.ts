import { describe, expect, it } from "vitest";

import {
  terminalClipboardIntent,
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
  type TerminalKeyEvent,
} from "./keymap";

const evt = (partial: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: "",
  code: "",
  ...partial,
});

describe("terminalWordNavigationSequence", () => {
  it("maps Option+Left to readline word-left", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBe("\x1bb");
  });

  it("maps Option+Right to readline word-right", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ altKey: true, key: "ArrowRight", code: "ArrowRight" }),
      ),
    ).toBe("\x1bf");
  });

  it("does not remap plain arrows", () => {
    expect(
      terminalWordNavigationSequence(
        evt({ key: "ArrowLeft", code: "ArrowLeft" }),
      ),
    ).toBeNull();
  });
});

describe("terminalLineNavigationSequence", () => {
  it("maps Cmd+Left to readline line-start on macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: true },
      ),
    ).toBe("\x01");
  });

  it("maps Cmd+Right to readline line-end on macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowRight", code: "ArrowRight" }),
        { isMac: true },
      ),
    ).toBe("\x05");
  });

  it("does not remap Cmd+Arrow off macOS", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: false },
      ),
    ).toBeNull();
  });

  it("does not remap Cmd+Option+Arrow (selection-style combos pass through)", () => {
    expect(
      terminalLineNavigationSequence(
        evt({ metaKey: true, altKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe("terminalDeleteSequence", () => {
  it("maps Cmd+Backspace to kill-to-line-start on macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBe("\x15");
  });

  it("maps Option+Backspace to kill-word-backward on macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ altKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBe("\x17");
  });

  it("maps Ctrl+Backspace to kill-word-backward off macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: false },
      ),
    ).toBe("\x17");
  });

  it("does not remap Ctrl+Backspace on macOS (reserved for native readline binding)", () => {
    expect(
      terminalDeleteSequence(
        evt({ ctrlKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBeNull();
  });

  it("does not remap Cmd+Backspace off macOS", () => {
    expect(
      terminalDeleteSequence(
        evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
        { isMac: false },
      ),
    ).toBeNull();
  });

  it("does not remap plain Backspace", () => {
    expect(
      terminalDeleteSequence(
        evt({ key: "Backspace", code: "Backspace" }),
        { isMac: true },
      ),
    ).toBeNull();
  });
});

describe("terminalClipboardIntent", () => {
  const opts = (over: Partial<Parameters<typeof terminalClipboardIntent>[1]>) => ({
    isMac: false,
    smartCopyPaste: true,
    hasSelection: false,
    ...over,
  });

  it("copies on Ctrl+Shift+C regardless of smart mode", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, shiftKey: true, code: "KeyC", key: "c" }),
        opts({ smartCopyPaste: false }),
      ),
    ).toBe("copy");
  });

  it("pastes on Ctrl+Shift+V regardless of smart mode", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, shiftKey: true, code: "KeyV", key: "v" }),
        opts({ smartCopyPaste: false }),
      ),
    ).toBe("paste");
  });

  it("smart Ctrl+C copies when there is a selection", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyC", key: "c" }),
        opts({ hasSelection: true }),
      ),
    ).toBe("copy");
  });

  it("smart Ctrl+C passes through (SIGINT) with no selection", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyC", key: "c" }),
        opts({ hasSelection: false }),
      ),
    ).toBeNull();
  });

  it("smart Ctrl+V pastes", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyV", key: "v" }),
        opts({}),
      ),
    ).toBe("paste");
  });

  it("does not intercept Ctrl+C when smart mode is off", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyC", key: "c" }),
        opts({ smartCopyPaste: false, hasSelection: true }),
      ),
    ).toBeNull();
  });

  it("does not intercept Ctrl+V when smart mode is off", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyV", key: "v" }),
        opts({ smartCopyPaste: false }),
      ),
    ).toBeNull();
  });

  it("never intercepts on macOS (Ctrl+C stays SIGINT)", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, shiftKey: true, code: "KeyC", key: "c" }),
        opts({ isMac: true, hasSelection: true }),
      ),
    ).toBeNull();
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyC", key: "c" }),
        opts({ isMac: true, hasSelection: true }),
      ),
    ).toBeNull();
  });

  it("matches the uppercase key form (Shift/CapsLock report 'C'/'V')", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, key: "C" }),
        opts({ hasSelection: true }),
      ),
    ).toBe("copy");
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, key: "V" }), opts({})),
    ).toBe("paste");
  });

  it("keys off physical position so Ctrl+C/V work on non-Latin layouts", () => {
    // Russian layout: the physical C/V keys report code KeyC/KeyV but produce
    // key "с"/"м" (Cyrillic). event.code is what keeps the shortcuts working.
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyC", key: "с" }),
        opts({ hasSelection: true }),
      ),
    ).toBe("copy");
    expect(
      terminalClipboardIntent(evt({ ctrlKey: true, code: "KeyV", key: "м" }), opts({})),
    ).toBe("paste");
  });

  it("ignores Ctrl+Alt combos (AltGr) and other keys", () => {
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, altKey: true, code: "KeyC", key: "c" }),
        opts({ hasSelection: true }),
      ),
    ).toBeNull();
    expect(
      terminalClipboardIntent(
        evt({ ctrlKey: true, code: "KeyX", key: "x" }),
        opts({ hasSelection: true }),
      ),
    ).toBeNull();
  });
});
