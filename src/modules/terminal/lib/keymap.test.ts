import { describe, expect, it } from "vitest";

import {
  type ImeGuardEvent,
  isImeCompositionKey,
  terminalDeleteSequence,
  terminalLineNavigationSequence,
  terminalReadlineSequence,
  terminalWordNavigationSequence,
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

describe("isImeCompositionKey", () => {
  const ime = (partial: Partial<ImeGuardEvent>): ImeGuardEvent => ({
    isComposing: false,
    keyCode: 0,
    key: "",
    ...partial,
  });

  it("guards an active composition regardless of key", () => {
    expect(
      isImeCompositionKey(ime({ isComposing: true, key: "ArrowLeft" })),
    ).toBe(true);
    expect(isImeCompositionKey(ime({ isComposing: true, key: "Enter" }))).toBe(
      true,
    );
  });

  it("guards the first keystroke of a session, before isComposing is set", () => {
    expect(isImeCompositionKey(ime({ keyCode: 229, key: "Process" }))).toBe(
      true,
    );
    expect(isImeCompositionKey(ime({ keyCode: 229, key: "a" }))).toBe(true);
  });

  // macOS stamps 229 on every Option+key event because Option is a dead-key
  // modifier. Bailing on that killed the word-navigation shortcuts outright.
  it.each([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ])("lets Option-tagged %s through", (key) => {
    expect(isImeCompositionKey(ime({ keyCode: 229, key }))).toBe(false);
  });

  it("still guards navigation keys once composition is actually active", () => {
    expect(
      isImeCompositionKey(
        ime({ isComposing: true, keyCode: 229, key: "ArrowLeft" }),
      ),
    ).toBe(true);
  });

  it("ignores ordinary keys", () => {
    expect(isImeCompositionKey(ime({ keyCode: 13, key: "Enter" }))).toBe(false);
    expect(isImeCompositionKey(ime({ keyCode: 37, key: "ArrowLeft" }))).toBe(
      false,
    );
  });
});
