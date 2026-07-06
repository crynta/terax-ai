import { describe, expect, it } from "vitest";

import {
  terminalDeleteSequence,
  terminalImeKeyDecision,
  terminalLineNavigationSequence,
  terminalWordNavigationSequence,
  type TerminalImeKeyEvent,
  type TerminalKeyEvent,
} from "./keymap";

const evt = (partial: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
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

describe("terminalImeKeyDecision", () => {
  const ime = (partial: Partial<TerminalImeKeyEvent>): TerminalImeKeyEvent => ({
    type: "keydown",
    isComposing: false,
    keyCode: 0,
    ...partial,
  });

  it("blocks keydowns fired during an active composition", () => {
    // The Enter that commits an IME candidate arrives as a keydown with
    // isComposing set; forwarding it would run the shell command (#158).
    expect(
      terminalImeKeyDecision(ime({ isComposing: true, keyCode: 13 })),
    ).toBe("block");
    expect(
      terminalImeKeyDecision(ime({ isComposing: true, keyCode: 229 })),
    ).toBe("block");
  });

  it("forwards Process (229) keydowns outside a composition to xterm", () => {
    // IME-committed text (dead keys, ibus accents) arrives as keyCode 229
    // with no isComposing flag. xterm's CompositionHelper must see the
    // keydown to run its textarea-diff bookkeeping, otherwise committed
    // accents accumulate and re-send cumulatively (#850, #927).
    expect(terminalImeKeyDecision(ime({ keyCode: 229 }))).toBe("forward");
  });

  it("forwards IME keyups and keypresses to xterm", () => {
    expect(
      terminalImeKeyDecision(ime({ type: "keyup", keyCode: 229 })),
    ).toBe("forward");
    expect(
      terminalImeKeyDecision(ime({ type: "keyup", isComposing: true })),
    ).toBe("forward");
    expect(
      terminalImeKeyDecision(ime({ type: "keypress", isComposing: true })),
    ).toBe("forward");
  });

  it("leaves non-IME keys to the regular shortcut handling", () => {
    expect(terminalImeKeyDecision(ime({ keyCode: 65 }))).toBeNull();
    expect(
      terminalImeKeyDecision(ime({ type: "keyup", keyCode: 13 })),
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
