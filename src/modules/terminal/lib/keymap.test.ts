import { describe, expect, it } from "vitest";

import {
  shouldTerminalPaste,
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalPasteKind,
  terminalReadlineSequence,
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

describe("terminalReadlineSequence", () => {
  const remaps = [
    [
      "line navigation",
      evt({ metaKey: true, key: "ArrowLeft", code: "ArrowLeft" }),
      "\x01",
    ],
    [
      "word navigation",
      evt({ altKey: true, key: "ArrowRight", code: "ArrowRight" }),
      "\x1bf",
    ],
    [
      "deletion",
      evt({ metaKey: true, key: "Backspace", code: "Backspace" }),
      "\x15",
    ],
  ] as const;

  it.each(remaps)(
    "applies %s on the normal screen",
    (_name, event, sequence) => {
      expect(
        terminalReadlineSequence(event, {
          isMac: true,
          isAlternateScreen: false,
        }),
      ).toBe(sequence);
    },
  );

  it.each(remaps)("suppresses %s on the alternate screen", (_name, event) => {
    expect(
      terminalReadlineSequence(event, {
        isMac: true,
        isAlternateScreen: true,
      }),
    ).toBeNull();
  });
});

describe("terminalPasteKind", () => {
  const plainCtrlV = evt({ ctrlKey: true, key: "v", code: "KeyV" });
  const ctrlShiftV = evt({
    ctrlKey: true,
    shiftKey: true,
    key: "V",
    code: "KeyV",
  });

  const windows = { isMac: false, isWindows: true };
  const linux = { isMac: false, isWindows: false };
  const mac = { isMac: true, isWindows: false };

  it("classifies plain Ctrl+V as a paste on Windows only", () => {
    expect(terminalPasteKind(plainCtrlV, windows)).toBe("plain");
    expect(terminalPasteKind(plainCtrlV, linux)).toBeNull();
    expect(terminalPasteKind(plainCtrlV, mac)).toBeNull();
  });

  it("classifies Ctrl+Shift+V as a paste on Windows and Linux", () => {
    expect(terminalPasteKind(ctrlShiftV, windows)).toBe("classic");
    expect(terminalPasteKind(ctrlShiftV, linux)).toBe("classic");
    expect(terminalPasteKind(ctrlShiftV, mac)).toBeNull();
  });

  it("ignores Ctrl+V with extra modifiers", () => {
    expect(
      terminalPasteKind(
        evt({ ctrlKey: true, altKey: true, key: "v", code: "KeyV" }),
        windows,
      ),
    ).toBeNull();
    expect(
      terminalPasteKind(
        evt({ ctrlKey: true, metaKey: true, key: "v", code: "KeyV" }),
        windows,
      ),
    ).toBeNull();
  });
});

describe("shouldTerminalPaste", () => {
  it("pastes plain Ctrl+V only outside the alternate screen", () => {
    expect(shouldTerminalPaste("plain", false)).toBe(true);
    expect(shouldTerminalPaste("plain", true)).toBe(false);
  });

  it("pastes Ctrl+Shift+V regardless of alternate-screen state", () => {
    expect(shouldTerminalPaste("classic", false)).toBe(true);
    expect(shouldTerminalPaste("classic", true)).toBe(true);
  });

  it("blocks plain Ctrl+V when the alt screen engages after the async clipboard read", () => {
    expect(shouldTerminalPaste("plain", false)).toBe(true);
    expect(shouldTerminalPaste("plain", true)).toBe(false);
  });
});
