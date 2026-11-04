import { Key } from "@terax/ghostty-core/protocol";

/** Physical key (`KeyboardEvent.code`) to the Ghostty key it encodes as. */
export const KEY_MAP: Readonly<Record<string, Key>> = {
  KeyA: Key.A,
  KeyB: Key.B,
  KeyC: Key.C,
  KeyD: Key.D,
  KeyE: Key.E,
  KeyF: Key.F,
  KeyG: Key.G,
  KeyH: Key.H,
  KeyI: Key.I,
  KeyJ: Key.J,
  KeyK: Key.K,
  KeyL: Key.L,
  KeyM: Key.M,
  KeyN: Key.N,
  KeyO: Key.O,
  KeyP: Key.P,
  KeyQ: Key.Q,
  KeyR: Key.R,
  KeyS: Key.S,
  KeyT: Key.T,
  KeyU: Key.U,
  KeyV: Key.V,
  KeyW: Key.W,
  KeyX: Key.X,
  KeyY: Key.Y,
  KeyZ: Key.Z,
  Digit0: Key.ZERO,
  Digit1: Key.ONE,
  Digit2: Key.TWO,
  Digit3: Key.THREE,
  Digit4: Key.FOUR,
  Digit5: Key.FIVE,
  Digit6: Key.SIX,
  Digit7: Key.SEVEN,
  Digit8: Key.EIGHT,
  Digit9: Key.NINE,
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
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,
  F13: Key.F13,
  F14: Key.F14,
  F15: Key.F15,
  F16: Key.F16,
  F17: Key.F17,
  F18: Key.F18,
  F19: Key.F19,
  F20: Key.F20,
  F21: Key.F21,
  F22: Key.F22,
  F23: Key.F23,
  F24: Key.F24,
  Numpad0: Key.KP_0,
  Numpad1: Key.KP_1,
  Numpad2: Key.KP_2,
  Numpad3: Key.KP_3,
  Numpad4: Key.KP_4,
  Numpad5: Key.KP_5,
  Numpad6: Key.KP_6,
  Numpad7: Key.KP_7,
  Numpad8: Key.KP_8,
  Numpad9: Key.KP_9,
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
};

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
