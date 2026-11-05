export type ShellInputState = {
  /** The shell has reported OSC 133 at least once. */
  readonly integrated: boolean;
  /** Between a command starting (C) and finishing (D). */
  readonly commandRunning: boolean;
  /** The shell reports that commands start (Bash before 4.4 has no PS0). */
  readonly commandTracked: boolean;
  /** A full-screen program owns the screen. */
  readonly alternateScreen: boolean;
  /** A terminal coding agent is running in this PTY. */
  readonly agentActive: boolean;
};

/**
 * Whether text typed on the user's behalf (a breadcrumb `cd`) would reach the
 * shell. Anything else that owns the foreground, a TUI or an agent, would take
 * it as its own input. A shell without integration cannot say, so it is given
 * the benefit of the doubt unless the screen shows a full-screen program. A
 * shell that reports prompts but not command starts leaves a running command
 * invisible to the markers, so the operating system is asked instead.
 */
export async function shellAcceptsInjectedCommand(
  state: ShellInputState,
  hasForegroundJob: () => Promise<boolean>,
): Promise<boolean> {
  if (state.alternateScreen || state.agentActive) return false;
  if (!state.integrated) return true;
  if (!state.commandTracked) return !(await hasForegroundJob());
  return !state.commandRunning;
}
