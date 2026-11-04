export type ShellInputState = {
  /** The shell has reported OSC 133 at least once. */
  readonly integrated: boolean;
  /** Between a command starting (C) and finishing (D). */
  readonly commandRunning: boolean;
  /** A full-screen program owns the screen. */
  readonly alternateScreen: boolean;
  /** A terminal coding agent is running in this PTY. */
  readonly agentActive: boolean;
};

/**
 * Whether text typed on the user's behalf (a breadcrumb `cd`) would reach the
 * shell. Anything else that owns the foreground, a TUI or an agent, would take
 * it as its own input. A shell without integration cannot say, so it is given
 * the benefit of the doubt unless the screen shows a full-screen program.
 */
export function shellAcceptsInjectedCommand(state: ShellInputState): boolean {
  if (state.alternateScreen || state.agentActive) return false;
  return !(state.integrated && state.commandRunning);
}
