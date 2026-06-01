export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "shiftKey" | "metaKey" | "key" | "code"
> & {
  getModifierState?: KeyboardEvent["getModifierState"];
};

export type PlatformOpts = { isMac: boolean };

const SHIFT_ENTER_CSI_U = "\x1b[13;2u";

export function terminalEditorNewlineSequence(
  event: TerminalKeyEvent,
): string | null {
  const isEnter =
    event.key === "Enter" ||
    event.code === "Enter" ||
    event.code === "NumpadEnter";
  if (!isEnter || event.altKey || event.metaKey) return null;

  // xterm.js collapses Shift+Enter and Ctrl+Enter to a plain carriage return.
  // Emit an unambiguous CSI-u Shift+Enter sequence that Pi's editor treats as
  // its newline action. Ctrl+Enter is intentionally translated to the same
  // action for Windows users and terminals that do not expose Shift+Enter well.
  if (event.shiftKey || event.ctrlKey) return SHIFT_ENTER_CSI_U;
  return null;
}

export function terminalGsdShortcutSequence(
  event: TerminalKeyEvent,
): string | null {
  if (event.metaKey || hasAltGraphModifier(event)) return null;
  if (event.ctrlKey && event.altKey && !event.shiftKey) {
    const ctrl = ctrlCharForEvent(event, new Set(["b", "g", "n", "p", "v", "]"]));
    return ctrl ? `\x1b${ctrl}` : null;
  }
  if (event.ctrlKey && event.shiftKey && !event.altKey) {
    const key = normalizedKey(event);
    if (key !== "g" && key !== "n") return null;
    return `\x1b[${key.charCodeAt(0)};5u`;
  }
  return null;
}

function hasAltGraphModifier(event: TerminalKeyEvent): boolean {
  return event.getModifierState?.("AltGraph") ?? false;
}

function ctrlCharForEvent(
  event: TerminalKeyEvent,
  allowed: ReadonlySet<string>,
): string | null {
  const key = normalizedKey(event);
  if (!allowed.has(key)) return null;
  if (key === "]") return "\x1d";
  const code = key.charCodeAt(0) - 96;
  if (code < 1 || code > 26) return null;
  return String.fromCharCode(code);
}

function normalizedKey(event: TerminalKeyEvent): string {
  if (event.code.startsWith("Key") && event.code.length === 4) {
    return event.code.slice(3).toLowerCase();
  }
  if (event.code === "BracketRight") return "]";
  return event.key.toLowerCase();
}

export function terminalWordNavigationSequence(event: TerminalKeyEvent): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x1bb";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x1bf";
  return null;
}

/** Cmd+Left/Right → readline line-start (Ctrl+A) / line-end (Ctrl+E).
 * macOS-only — Cmd doesn't exist as a navigation modifier elsewhere. */
export function terminalLineNavigationSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): string | null {
  if (!opts.isMac) return null;
  if (!event.metaKey || event.altKey || event.ctrlKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x01";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x05";
  return null;
}

/** Modifier+Backspace deletion:
 *   macOS  Cmd+Backspace    → Ctrl+U (kill-to-line-start)
 *   macOS  Option+Backspace → Ctrl+W (kill-word-backward)
 *   Other  Ctrl+Backspace   → Ctrl+W (kill-word-backward)
 */
export function terminalDeleteSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): string | null {
  if (event.key !== "Backspace" && event.code !== "Backspace") return null;
  if (opts.isMac) {
    if (event.metaKey && !event.altKey && !event.ctrlKey) return "\x15";
    if (event.altKey && !event.metaKey && !event.ctrlKey) return "\x17";
    return null;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey) return "\x17";
  return null;
}
