export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "key" | "code"
>;

export type PlatformOpts = { isMac: boolean };

export function terminalWordNavigationSequence(
  event: TerminalKeyEvent,
): string | null {
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
 *   Other  Ctrl+Backspace   → Ctrl+W (kill-word-backward), unless the
 *          application enabled the Kitty protocol: it gets `CSI 127;5u`
 */
export function terminalDeleteSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts & { kittyKeys?: () => boolean },
): string | null {
  if (event.key !== "Backspace" && event.code !== "Backspace") return null;
  if (opts.isMac) {
    if (event.metaKey && !event.altKey && !event.ctrlKey) return "\x15";
    if (event.altKey && !event.metaKey && !event.ctrlKey) return "\x17";
    return null;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey)
    return opts.kittyKeys?.() ? null : "\x17";
  return null;
}

/**
 * Command-key editing (line start/end, kill line) has no terminal encoding, so
 * it is the same readline control character on either screen. Option and Ctrl
 * word motion is a real key on the alternate screen (`CSI 1;3D`): a full-screen
 * application gets the key, not a shell binding.
 */
export function terminalReadlineSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts & {
    isAlternateScreen: boolean;
    kittyKeys?: () => boolean;
  },
): string | null {
  const command =
    terminalLineNavigationSequence(event, opts) ??
    (event.metaKey ? terminalDeleteSequence(event, opts) : null);
  if (command || opts.isAlternateScreen) return command;
  return (
    terminalWordNavigationSequence(event) ?? terminalDeleteSequence(event, opts)
  );
}
