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

export function terminalReadlineSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts & { isAlternateScreen: boolean },
): string | null {
  if (opts.isAlternateScreen) return null;
  return (
    terminalLineNavigationSequence(event, opts) ??
    terminalWordNavigationSequence(event) ??
    terminalDeleteSequence(event, opts)
  );
}

export type TerminalPasteKind = "classic" | "plain";

/** Paste chord classification:
 *   non-macOS  Ctrl+Shift+V → "classic" (always pastes, even on the alt screen)
 *   Windows    Ctrl+V       → "plain"   (pastes only outside the alt screen.
 *                             On Linux Ctrl+V is a native readline shortcut,
 *                             On macOS Cmd+V is handled natively)
 */
export function terminalPasteKind(
  event: TerminalKeyEvent,
  opts: PlatformOpts & { isWindows: boolean },
): TerminalPasteKind | null {
  const isV = event.code === "KeyV" || event.key === "v" || event.key === "V";
  if (!isV || !event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.shiftKey) return opts.isMac ? null : "classic";
  return opts.isWindows ? "plain" : null;
}

/** Plain Ctrl+V must not paste into alt-screen TUIs (vim, htop, ...), where
 * Ctrl+V has its own meaning. Called both on keydown and again after the
 * asynchronous clipboard read, since the screen state may change in between. */
export function shouldTerminalPaste(
  kind: TerminalPasteKind,
  isAlternateScreen: boolean,
): boolean {
  return kind === "classic" || !isAlternateScreen;
}
