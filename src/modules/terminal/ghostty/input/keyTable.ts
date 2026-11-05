import { Key } from "@terax/ghostty-core/protocol";

/**
 * Physical key (`KeyboardEvent.code`) to the Ghostty key it encodes as. Most
 * codes are the enum name in camel case (`PageDown` is `PAGE_DOWN`); the few
 * that are not are spelled out, and the runs follow the enum's order (A to Z,
 * ZERO to NINE, KP_0 to KP_9, F1 to F24). keyTable.test.ts pins every entry.
 */
export const KEY_MAP: Readonly<Record<string, Key>> = (() => {
  const named = Key as unknown as Record<string, Key>;
  const keys: Record<string, Key> = {
    Backquote: Key.GRAVE,
    ArrowDown: Key.DOWN,
    ArrowLeft: Key.LEFT,
    ArrowRight: Key.RIGHT,
    ArrowUp: Key.UP,
    NumpadAdd: Key.KP_PLUS,
    NumpadDecimal: Key.KP_PERIOD,
    NumpadSubtract: Key.KP_MINUS,
  };
  for (const code of `Backslash BracketLeft BracketRight Comma Equal IntlBackslash Minus Period Quote Semicolon Slash Backspace Enter Space Tab Delete End Home Insert PageDown PageUp Escape AltLeft AltRight ControlLeft ControlRight MetaLeft MetaRight ShiftLeft ShiftRight NumpadDivide NumpadEnter NumpadEqual NumpadMultiply`.split(
    " ",
  ))
    keys[code] =
      named[
        code
          .replace("Numpad", "KP_")
          .replace(/([a-z])([A-Z])/g, "$1_$2")
          .toUpperCase()
      ];
  for (let i = 0; i < 26; i++)
    keys[`Key${String.fromCharCode(65 + i)}`] = (Key.A + i) as Key;
  for (let i = 0; i < 10; i++) {
    keys[`Digit${i}`] = (Key.ZERO + i) as Key;
    keys[`Numpad${i}`] = (Key.KP_0 + i) as Key;
  }
  for (let i = 0; i < 24; i++) keys[`F${i + 1}`] = (Key.F1 + i) as Key;
  return keys;
})();

/** US-layout `[unshifted, shifted]` characters of the punctuation keys. */
const SYMBOL_PAIRS: Readonly<Record<string, string>> = {
  Backquote: "`~",
  Backslash: "\\|",
  BracketLeft: "[{",
  BracketRight: "]}",
  Comma: ",<",
  Equal: "=+",
  IntlBackslash: "\\|",
  Minus: "-_",
  Period: ".>",
  Quote: "'\"",
  Semicolon: ";:",
  Slash: "/?",
};

const SHIFTED_DIGITS = ")!@#$%^&*(";

/**
 * Kitty's key code for a text key: the character the key types with no
 * modifier. Only `event.key` and the physical code are known here, so
 * punctuation and digits are recovered for US-layout pairs and everything else
 * falls back to the lower-cased character itself.
 */
export function unshiftedCodepoint(
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey">,
): number {
  const character = event.key.toLowerCase().codePointAt(0) ?? 0;
  if (event.key.length === 1 && character >= 32 && character !== 127) {
    if (event.shiftKey) {
      const pair = SYMBOL_PAIRS[event.code];
      if (pair?.[1] === event.key) return pair.charCodeAt(0);
      if (event.code.startsWith("Digit") && event.code.length === 6) {
        const digit = event.code.charCodeAt(5) - 48;
        if (SHIFTED_DIGITS[digit] === event.key) return digit + 48;
      }
    }
    return character;
  }
  return event.code.startsWith("Key") && event.code.length === 4
    ? event.code.toLowerCase().charCodeAt(3)
    : 0;
}

/**
 * The text a key types on a US layout with Option acting as Meta: macOS
 * rewrites `event.key` for Option (`å`, `∫`, dead keys), the physical code
 * survives.
 */
export function baseTextForCode(
  code: string,
  shiftKey: boolean,
): string | null {
  if (code.length === 4 && code.startsWith("Key")) {
    const letter = code[3].toLowerCase();
    return shiftKey ? letter.toUpperCase() : letter;
  }
  if (code.length === 6 && code.startsWith("Digit")) {
    const digit = code.charCodeAt(5) - 48;
    return shiftKey ? SHIFTED_DIGITS[digit] : code[5];
  }
  if (code === "Space") return " ";
  const pair = SYMBOL_PAIRS[code];
  return pair ? pair[shiftKey ? 1 : 0] : null;
}
