import { terminalReadlineSequence } from "@/modules/terminal/lib/keymap";
import {
  type Key,
  type KeyAction,
  type KeyEvent,
  Mods,
} from "@terax/ghostty-core/protocol";
import { baseTextForCode, KEY_MAP, unshiftedCodepoint } from "./keyTable";

/** Kitty keyboard protocol flag bits (progressive enhancement). */
export const KITTY_REPORT_EVENT_TYPES = 0x2;
const KITTY_REPORT_ALL_KEYS = 0x8;

export type KeyboardLike = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "keyCode"
  | "shiftKey"
  | "ctrlKey"
  | "altKey"
  | "metaKey"
  | "repeat"
  | "isComposing"
  | "defaultPrevented"
  | "getModifierState"
>;

export type KeyContext = {
  readonly isMac: boolean;
  readonly isWindows: boolean;
  /** Option acts as Meta for the key being pressed (the setting and the side held). */
  readonly optionIsMeta: () => boolean;
  /** An IME composition is in progress on the input element. */
  readonly composing: () => boolean;
  readonly alternateScreen: () => boolean;
  /** Active Kitty keyboard flags; zero outside the protocol. */
  readonly kittyFlags: () => number;
};

export type KeyRoute =
  /** Not ours: the webview, the IME or the native menu keeps the event. */
  | { readonly kind: "ignore" }
  | { readonly kind: "paste"; readonly forwardKeyWhenEmpty: boolean }
  | { readonly kind: "copy" }
  /** Fixed bytes, already in their final form. */
  | { readonly kind: "bytes"; readonly text: string }
  /** Typed text; `key` is set when the text is also a key for Kitty reporting. */
  | {
      readonly kind: "text";
      readonly text: string;
      readonly key: Key | null;
    }
  /** A key for the encoder; `utf8` overrides the text derived from the event. */
  | { readonly kind: "key"; readonly key: Key; readonly utf8?: string };

const IGNORE: KeyRoute = { kind: "ignore" };
const COPY: KeyRoute = { kind: "copy" };
const PASTE: KeyRoute = { kind: "paste", forwardKeyWhenEmpty: false };
const PASTE_OR_KEY: KeyRoute = { kind: "paste", forwardKeyWhenEmpty: true };
const ESC_CR: KeyRoute = { kind: "bytes", text: "\x1b\r" };

/**
 * Chords the encoder escape-codes in every mode, though a legacy application
 * can only read the C0 byte (xterm): Ctrl+I is Tab, Ctrl+M is Enter, Ctrl+[ is
 * Escape (vim users type it for Esc) and Ctrl+- is readline's undo.
 */
const LEGACY_CONTROL: Readonly<Record<string, string>> = {
  i: "\t",
  m: "\r",
  "[": "\x1b",
  "-": "\x1f",
};

/**
 * Keys an IME can never end a composition with. WebKit tags Option combinations
 * (and some Windows IMEs tag everything while enabled) with keyCode 229 even
 * when nothing is being composed, so a 229 only means "IME" for the keys that
 * commit or edit text: Enter, Space, Tab, plain Backspace, Escape and characters.
 */
const IME_SAFE_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
]);

function isOptionMeta(event: KeyboardLike, ctx: KeyContext): boolean {
  return (
    ctx.isMac &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    ctx.optionIsMeta()
  );
}

/**
 * The event belongs to the IME, the webview or an earlier handler. Dead keys
 * and `Process` are the IME's; keyCode 229 is the IME's only for the keys that
 * can commit or edit text (see {@link IME_SAFE_KEYS}).
 */
export function ignoredForIme(event: KeyboardLike, ctx: KeyContext): boolean {
  if (event.defaultPrevented || ctx.composing() || event.isComposing)
    return true;
  const { key } = event;
  if (key === "Process" || key === "Unidentified") return true;
  if (isOptionMeta(event, ctx)) return false;
  if (key === "Dead") return true;
  if (event.keyCode !== 229) return false;
  // Backspace edits a preedit, but Option/Ctrl/Command+Backspace never does.
  const wordDelete =
    key === "Backspace" && (event.altKey || event.ctrlKey || event.metaKey);
  return !IME_SAFE_KEYS.has(key) && !wordDelete;
}

/** Classifies a key press the IME guard let through. */
export function routeKeyDown(
  event: KeyboardLike,
  ctx: KeyContext,
  skipCopy = false,
): KeyRoute {
  const { key } = event;
  const optionMeta = isOptionMeta(event, ctx);

  if (isPasteShortcut(event, ctx))
    return ctx.isWindows &&
      event.ctrlKey &&
      !event.shiftKey &&
      isLayoutKey(event, "v")
      ? PASTE_OR_KEY
      : PASTE;
  if (!skipCopy && isCopyShortcut(event, ctx)) return COPY;

  const readline = terminalReadlineSequence(event, {
    isMac: ctx.isMac,
    isAlternateScreen: ctx.alternateScreen(),
    kittyKeys: () => ctx.kittyFlags() !== 0,
  });
  if (readline) return { kind: "bytes", text: readline };

  // Unclaimed Command shortcuts belong to the native menu, even in Kitty mode.
  if (ctx.isMac && event.metaKey) return IGNORE;

  if (
    key === "Enter" &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    ctx.kittyFlags() === 0
  )
    return ESC_CR;

  if (
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    key.length === 1
  ) {
    const control = LEGACY_CONTROL[key.toLowerCase()];
    if (control !== undefined && ctx.kittyFlags() === 0)
      return { kind: "bytes", text: control };
  }

  // xterm sends the control byte for Ctrl+Shift+letter; the encoder's CSI u
  // form would arrive as typed text in an application that never asked for it.
  if (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    ctx.kittyFlags() === 0
  ) {
    const letter = layoutLetter(event);
    if (letter !== null)
      return isCopyShortcut(event, ctx)
        ? IGNORE
        : {
            kind: "bytes",
            text: String.fromCharCode(letter.charCodeAt(0) & 0x1f),
          };
  }

  if (optionMeta) {
    const text = baseTextForCode(event.code, event.shiftKey);
    const mapped = KEY_MAP[event.code];
    if (text !== null && mapped !== undefined)
      return { kind: "key", key: mapped, utf8: text };
  }

  const printable =
    key.length === 1 &&
    !event.metaKey &&
    ((!event.ctrlKey && !event.altKey) ||
      event.getModifierState("AltGraph") ||
      (ctx.isMac && event.altKey && !event.ctrlKey && !optionMeta));
  if (printable) {
    const mapped = KEY_MAP[event.code];
    return {
      kind: "text",
      text: key,
      key: !event.altKey && mapped !== undefined ? mapped : null,
    };
  }

  const mapped = KEY_MAP[event.code];
  return mapped === undefined ? IGNORE : { kind: "key", key: mapped };
}

/**
 * Builds the encoder input for a key press. The Kitty base key (the unshifted
 * character) is only supplied where the protocol asks for an escape code: with
 * Ctrl, Alt or Super held, or when the application requested every key as an
 * escape code. Supplying it for Shift-only text makes the encoder escape-code
 * ordinary typing, and for plain text it adds release events the protocol only
 * reports to applications that asked for all keys.
 */
export function buildKeyEvent(
  event: KeyboardLike,
  key: Key,
  action: KeyAction,
  kittyFlags: number,
  utf8?: string,
): KeyEvent {
  const needsBase =
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (kittyFlags & KITTY_REPORT_ALL_KEYS) !== 0;
  return {
    action,
    key,
    mods: keyModifiers(event, kittyFlags),
    utf8: utf8 ?? (event.key.length === 1 ? event.key : undefined),
    unshiftedCodepoint: needsBase
      ? unshiftedCodepoint(
          utf8 === undefined
            ? event
            : { key: utf8, code: event.code, shiftKey: event.shiftKey },
        )
      : 0,
  };
}

/**
 * Lock modifiers belong to Kitty's "report all keys" level. Below it, every
 * escape-coded key of a Num Lock keyboard (Windows desktops, many Linux ones)
 * would carry modifier 129, and applications that match arrows, Home or Escape
 * by their exact sequence stop seeing them. Outside the protocol the encoder
 * needs Num Lock for the keypad.
 */
export function keyModifiers(event: KeyboardLike, kittyFlags: number): Mods {
  let result = Mods.NONE;
  if (event.shiftKey) result |= Mods.SHIFT;
  if (event.ctrlKey) result |= Mods.CTRL;
  if (event.altKey) result |= Mods.ALT;
  if (event.metaKey) result |= Mods.SUPER;
  if (kittyFlags !== 0 && (kittyFlags & KITTY_REPORT_ALL_KEYS) === 0)
    return result;
  if (event.getModifierState("CapsLock")) result |= Mods.CAPSLOCK;
  if (event.getModifierState("NumLock")) result |= Mods.NUMLOCK;
  return result;
}

/**
 * `CSI 1;1:1 A` and `CSI 1;2:1 A` are valid spellings of an arrow press, but
 * the protocol's own spelling omits the default event type (`CSI A`,
 * `CSI 1;2 A`). Parsers that predate sub-parameters, and the Windows console
 * input layer, only know that form.
 */
export function canonicalKittyPress(bytes: Uint8Array): Uint8Array {
  const length = bytes.byteLength;
  if (length < 7 || length > 16 || bytes[0] !== 0x1b || bytes[1] !== 0x5b)
    return bytes;
  if (bytes[length - 2] !== 0x31 || bytes[length - 3] !== 0x3a) return bytes;
  const final = bytes[length - 1];
  const isLetter = (final >= 0x41 && final <= 0x5a) || final === 0x7e;
  if (!isLetter) return bytes;
  let separator = -1;
  for (let index = 2; index < length - 3; index++) {
    const byte = bytes[index];
    if (byte === 0x3b) {
      if (separator !== -1) return bytes;
      separator = index;
    } else if (byte < 0x30 || byte > 0x39) return bytes;
  }
  if (separator === -1 || separator === length - 4) return bytes;
  const modifiersAreDefault =
    separator === length - 5 && bytes[separator + 1] === 0x31;
  const keyIsDefault = separator === 3 && bytes[2] === 0x31;
  const out: number[] = [0x1b, 0x5b];
  if (!(modifiersAreDefault && keyIsDefault && final !== 0x7e)) {
    for (let index = 2; index < separator; index++) out.push(bytes[index]);
    if (!modifiersAreDefault) {
      out.push(0x3b);
      for (let index = separator + 1; index < length - 3; index++)
        out.push(bytes[index]);
    }
  }
  out.push(final);
  return Uint8Array.from(out);
}

/**
 * Whether the key is the Latin letter, by what the layout types (Dvorak and
 * Workman move letters around, so the physical code is the wrong question).
 * Layouts without Latin letters type something else on the key and are matched
 * by position.
 */
function isLayoutKey(
  event: Pick<KeyboardEvent, "key" | "code">,
  letter: string,
): boolean {
  return layoutLetter(event) === letter;
}

/** The Latin letter a key stands for under Ctrl, or null. */
function layoutLetter(
  event: Pick<KeyboardEvent, "key" | "code">,
): string | null {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  if (key.length >= 1 && /^\p{L}$/u.test(key) && /^Key[A-Z]$/.test(event.code))
    return event.code.slice(3).toLowerCase();
  return null;
}

const isInsert = (event: Pick<KeyboardEvent, "key" | "code">): boolean =>
  event.key === "Insert" || event.code === "Insert";

export function isPasteShortcut(
  event: Pick<
    KeyboardEvent,
    "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "key" | "code"
  >,
  platform: Pick<KeyContext, "isMac" | "isWindows">,
): boolean {
  if (platform.isMac) {
    return (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      isLayoutKey(event, "v")
    );
  }
  if (event.altKey || event.metaKey) return false;
  if (isInsert(event)) return event.shiftKey && !event.ctrlKey;
  if (!event.ctrlKey || !isLayoutKey(event, "v")) return false;
  return platform.isWindows || event.shiftKey;
}

export function isCopyShortcut(
  event: Pick<
    KeyboardEvent,
    "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "key" | "code"
  >,
  platform: Pick<KeyContext, "isMac">,
): boolean {
  if (platform.isMac) {
    return (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      isLayoutKey(event, "c")
    );
  }
  if (event.altKey || event.metaKey || !event.ctrlKey) return false;
  if (isInsert(event)) return !event.shiftKey;
  return event.shiftKey && isLayoutKey(event, "c");
}
