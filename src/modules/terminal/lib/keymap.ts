export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "key" | "code"
>;

export type PlatformOpts = { isMac: boolean };

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

export type TerminalClipboardIntent = "copy" | "paste";

export type ClipboardOpts = {
  isMac: boolean;
  /** Windows-Terminal-style no-Shift copy/paste (default on, toggleable). */
  smartCopyPaste: boolean;
  hasSelection: boolean;
};

/**
 * Decide whether a key event is a terminal clipboard action.
 *
 * Ctrl+Shift+C / Ctrl+Shift+V always copy/paste; those combos never collide
 * with the shell, so they work regardless of the smart-mode preference.
 *
 * Smart mode (Windows-Terminal style, on by default):
 *   Ctrl+C → "copy" only when text is selected; with no selection it returns
 *            null so the SIGINT (\x03) reaches the shell unchanged.
 *   Ctrl+V → "paste".
 *
 * macOS owns Cmd+C/Cmd+V natively and keeps Ctrl+C as SIGINT, so this returns
 * null there and never shadows the interrupt.
 */
export function terminalClipboardIntent(
  event: TerminalKeyEvent,
  opts: ClipboardOpts,
): TerminalClipboardIntent | null {
  if (opts.isMac) return null;
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  // Match physical position (event.code) as well as the character so Ctrl+C/V
  // work on non-Latin layouts (e.g. Cyrillic) where event.key is not "c"/"v".
  const isC = event.code === "KeyC" || event.key.toLowerCase() === "c";
  const isV = event.code === "KeyV" || event.key.toLowerCase() === "v";
  if (!isC && !isV) return null;

  if (event.shiftKey) return isC ? "copy" : "paste";

  if (!opts.smartCopyPaste) return null;
  if (isV) return "paste";
  return opts.hasSelection ? "copy" : null;
}
