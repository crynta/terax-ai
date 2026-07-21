export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "key" | "code"
>;

export type PlatformOpts = { isMac: boolean };

export type TerminalImeKeyEvent = Pick<
  KeyboardEvent,
  "type" | "isComposing" | "keyCode"
>;

export type ImeKeyDecision = "block" | "forward" | null;

/** How the custom key handler should treat IME-related events.
 *
 * "block"   — drop the event entirely. Only raw keydowns fired during an
 *             active composition: the Enter that commits an IME candidate
 *             must not reach the PTY as a real Enter, and xterm's own
 *             pipeline would finalize-then-forward it.
 * "forward" — hand the event straight to xterm and skip Terax shortcuts.
 *             keyCode 229 ("Process") keydowns must reach xterm's
 *             CompositionHelper: it never forwards them raw, and its
 *             textarea-diff bookkeeping is what emits IME-committed text
 *             (dead keys, ibus accents like ñ/ö) exactly once. Blocking
 *             them starves that bookkeeping, so each committed accent
 *             re-sends the whole accumulated textarea value.
 * null      — not IME-related; continue with Terax's shortcut handling.
 */
export function terminalImeKeyDecision(
  event: TerminalImeKeyEvent,
): ImeKeyDecision {
  if (event.type === "keydown" && event.isComposing) return "block";
  if (event.isComposing || event.keyCode === 229) return "forward";
  return null;
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
