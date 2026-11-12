/** A shell that dies sooner than this is failing, not finished: no respawn. */
export const RESPAWN_MIN_LIFETIME_MS = 2_000;

export type ExitAction = "close-window" | "close" | "respawn" | "keep";

/**
 * What an exited shell's tab does. The window's only terminal quits the app;
 * any other tab closes, except the last tab of a project's main task, which
 * cannot close: it respawns a shell, unless the shell died at once (a broken
 * distro, `exit` in an rc file), where respawning would loop — then it stays
 * to show why, with a manual restart.
 */
export function exitAction(input: {
  onlyTabInWindow: boolean;
  mustStay: boolean;
  livedMs: number;
}): ExitAction {
  if (input.onlyTabInWindow) return "close-window";
  if (!input.mustStay) return "close";
  return input.livedMs >= RESPAWN_MIN_LIFETIME_MS ? "respawn" : "keep";
}
