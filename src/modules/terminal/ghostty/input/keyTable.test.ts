import { Key } from "@terax/ghostty-core/protocol";
import { describe, expect, it } from "vitest";
import { baseTextForCode, KEY_MAP, unshiftedCodepoint } from "./keyTable";

describe("KEY_MAP", () => {
  it("maps the generated runs to the keys of the same name", () => {
    const named = Key as unknown as Record<string, Key>;
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
      expect(KEY_MAP[`Key${letter}`], letter).toBe(named[letter]);
    const digits = "ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE".split(
      " ",
    );
    digits.forEach((name, digit) => {
      expect(KEY_MAP[`Digit${digit}`], name).toBe(named[name]);
      expect(KEY_MAP[`Numpad${digit}`], `KP_${digit}`).toBe(
        named[`KP_${digit}`],
      );
    });
    for (let n = 1; n <= 24; n++) expect(KEY_MAP[`F${n}`]).toBe(named[`F${n}`]);
  });

  it("maps every named key to the key it has always encoded as", () => {
    expect(
      Object.fromEntries(
        Object.entries(KEY_MAP).filter(
          ([code]) => !/^(Key[A-Z]|Digit\d|Numpad\d|F\d+)$/.test(code),
        ),
      ),
    ).toEqual({
      Backquote: Key.GRAVE,
      Backslash: Key.BACKSLASH,
      BracketLeft: Key.BRACKET_LEFT,
      BracketRight: Key.BRACKET_RIGHT,
      Comma: Key.COMMA,
      Equal: Key.EQUAL,
      IntlBackslash: Key.INTL_BACKSLASH,
      Minus: Key.MINUS,
      Period: Key.PERIOD,
      Quote: Key.QUOTE,
      Semicolon: Key.SEMICOLON,
      Slash: Key.SLASH,
      Backspace: Key.BACKSPACE,
      Enter: Key.ENTER,
      Space: Key.SPACE,
      Tab: Key.TAB,
      Delete: Key.DELETE,
      End: Key.END,
      Home: Key.HOME,
      Insert: Key.INSERT,
      PageDown: Key.PAGE_DOWN,
      PageUp: Key.PAGE_UP,
      ArrowDown: Key.DOWN,
      ArrowLeft: Key.LEFT,
      ArrowRight: Key.RIGHT,
      ArrowUp: Key.UP,
      Escape: Key.ESCAPE,
      NumpadAdd: Key.KP_PLUS,
      NumpadDecimal: Key.KP_PERIOD,
      NumpadDivide: Key.KP_DIVIDE,
      NumpadEnter: Key.KP_ENTER,
      NumpadEqual: Key.KP_EQUAL,
      NumpadMultiply: Key.KP_MULTIPLY,
      NumpadSubtract: Key.KP_MINUS,
      AltLeft: Key.ALT_LEFT,
      AltRight: Key.ALT_RIGHT,
      ControlLeft: Key.CONTROL_LEFT,
      ControlRight: Key.CONTROL_RIGHT,
      MetaLeft: Key.META_LEFT,
      MetaRight: Key.META_RIGHT,
      ShiftLeft: Key.SHIFT_LEFT,
      ShiftRight: Key.SHIFT_RIGHT,
    });
  });

  it("maps the named keys", () => {
    expect(KEY_MAP.ArrowUp).toBe(Key.UP);
    expect(KEY_MAP.PageDown).toBe(Key.PAGE_DOWN);
    expect(KEY_MAP.Backquote).toBe(Key.GRAVE);
    expect(KEY_MAP.NumpadAdd).toBe(Key.KP_PLUS);
    expect(KEY_MAP.ShiftRight).toBe(Key.SHIFT_RIGHT);
    expect(KEY_MAP.CapsLock).toBeUndefined();
  });
});

describe("unshiftedCodepoint", () => {
  const press = (key: string, code: string, shiftKey = false) => ({
    key,
    code,
    shiftKey,
  });

  it.each([
    [press("a", "KeyA"), 97],
    [press("A", "KeyA", true), 97],
    [press(":", "Semicolon", true), 59],
    [press("!", "Digit1", true), 49],
    [press("_", "Minus", true), 45],
    [press("ä", "Quote"), 228],
    [press("Enter", "Enter"), 0],
    [press("Dead", "KeyE"), 101],
  ])("%j -> %s", (event, expected) => {
    expect(unshiftedCodepoint(event)).toBe(expected);
  });
});

describe("baseTextForCode", () => {
  it.each([
    ["KeyB", false, "b"],
    ["KeyB", true, "B"],
    ["Digit2", false, "2"],
    ["Digit2", true, "@"],
    ["Period", false, "."],
    ["Period", true, ">"],
    ["Space", false, " "],
    ["Enter", false, null],
    ["ArrowLeft", false, null],
  ])("%s (shift %s) -> %s", (code, shift, expected) => {
    expect(baseTextForCode(code, shift)).toBe(expected);
  });
});
