import { describe, expect, it } from "vitest";

import {
  terminalDeleteSequence,
  terminalEditorNewlineSequence,
  terminalGsdShortcutSequence,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
  type TerminalKeyEvent,
} from "./keymap";

const evt = (partial: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  key: "",
  code: "",
  getModifierState: () => false,
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

describe("terminalEditorNewlineSequence", () => {
  it.each([
    ["Shift+Enter", { shiftKey: true }],
    ["Ctrl+Enter", { ctrlKey: true }],
  ])("maps %s to Pi's newline shortcut sequence", (_label, partial) => {
    expect(
      terminalEditorNewlineSequence(
        evt({ ...partial, key: "Enter", code: "Enter" }),
      ),
    ).toBe("\x1b[13;2u");
  });

  it("also maps NumpadEnter", () => {
    expect(
      terminalEditorNewlineSequence(
        evt({ shiftKey: true, key: "Enter", code: "NumpadEnter" }),
      ),
    ).toBe("\x1b[13;2u");
  });

  it("does not map plain Enter", () => {
    expect(
      terminalEditorNewlineSequence(evt({ key: "Enter", code: "Enter" })),
    ).toBeNull();
  });

  it("leaves Alt+Enter untouched", () => {
    expect(
      terminalEditorNewlineSequence(
        evt({ altKey: true, key: "Enter", code: "Enter" }),
      ),
    ).toBeNull();
  });
});

describe("terminalGsdShortcutSequence", () => {
  it.each([
    ["b", "KeyB", "\x1b\x02"],
    ["g", "KeyG", "\x1b\x07"],
    ["n", "KeyN", "\x1b\x0e"],
    ["p", "KeyP", "\x1b\x10"],
    ["v", "KeyV", "\x1b\x16"],
    ["]", "BracketRight", "\x1b\x1d"],
  ])("maps Ctrl+Alt+%s to GSD's terminal sequence", (key, code, seq) => {
    expect(
      terminalGsdShortcutSequence(
        evt({ ctrlKey: true, altKey: true, key, code }),
      ),
    ).toBe(seq);
  });

  it.each([
    ["g", "KeyG", "\x1b[103;5u"],
    ["n", "KeyN", "\x1b[110;5u"],
  ])("maps Ctrl+Shift+%s fallback to a CSI-u sequence", (key, code, seq) => {
    expect(
      terminalGsdShortcutSequence(
        evt({ ctrlKey: true, shiftKey: true, key: key.toUpperCase(), code }),
      ),
    ).toBe(seq);
  });

  it("does not map plain Ctrl+N", () => {
    expect(
      terminalGsdShortcutSequence(
        evt({ ctrlKey: true, key: "n", code: "KeyN" }),
      ),
    ).toBeNull();
  });

  it("does not map arbitrary Ctrl+Alt letters", () => {
    expect(
      terminalGsdShortcutSequence(
        evt({ ctrlKey: true, altKey: true, key: "x", code: "KeyX" }),
      ),
    ).toBeNull();
  });

  it("does not map AltGraph printable input as a Ctrl+Alt shortcut", () => {
    expect(
      terminalGsdShortcutSequence(
        evt({
          ctrlKey: true,
          altKey: true,
          key: "ń",
          code: "KeyN",
          getModifierState: (modifier) => modifier === "AltGraph",
        }),
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
