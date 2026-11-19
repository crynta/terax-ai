import { enqueueTerminalInput } from "../ghostty/input/terminalInputEncoding";

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
 * it as its own input. Native foreground checks cannot detect a shell builtin
 * reading stdin, so both prompt and command-start markers are required.
 */
export function shellAcceptsInjectedCommand(state: ShellInputState): boolean {
  if (state.alternateScreen || state.agentActive) return false;
  if (!state.integrated || !state.commandTracked) return false;
  return !state.commandRunning;
}

/** What a terminal session shows about the shell behind it. */
export type InjectionTarget = {
  readonly shellExited: boolean;
  readonly disposed: boolean;
  readonly promptIntegrated: boolean;
  readonly commandRunning: boolean;
  commandTracked: boolean;
  readonly model: {
    modes(): { readonly alternateScreen: boolean };
  } | null;
  readonly pty: { readonly id: number } | null;
  readonly writer: { enqueue(bytes: Uint8Array): boolean };
};

/**
 * Types a shell command on the user's behalf only when the shell will read it:
 * never into a running command, a full-screen program or a coding agent.
 */
export function writeAtShellPrompt(
  session: InjectionTarget,
  data: string,
  agentActive: () => boolean,
): boolean {
  if (session.shellExited || session.disposed || !session.pty || !session.model)
    return false;
  const accepts = shellAcceptsInjectedCommand({
    integrated: session.promptIntegrated,
    commandRunning: session.commandRunning,
    commandTracked: session.commandTracked,
    alternateScreen: session.model?.modes().alternateScreen ?? false,
    agentActive: agentActive(),
  });
  if (!accepts) return false;
  return enqueueTerminalInput(session, new TextEncoder().encode(data));
}
