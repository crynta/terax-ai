/**
 * Lets panels deep in the tree (the Session Reader, its history list) open a
 * new agent tab without threading callbacks through the pane view. App
 * registers the handler; it opens a tab in `cwd`, waits for the shell, and
 * types `command`.
 */
export type AgentCommandLaunch = {
  cwd: string | null;
  title: string;
  command: string;
};

export type AgentCommandLaunched = {
  leafId: number;
  /** Resolves once the command has been typed into the new pane. */
  started: Promise<boolean>;
};

type Handler = (request: AgentCommandLaunch) => AgentCommandLaunched | null;

let handler: Handler | null = null;

/** Registers App's launcher; returns the unregister function. */
export function setAgentCommandLauncher(next: Handler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Opens a new agent tab running `command`; null when no launcher is registered. */
export function launchAgentCommand(
  request: AgentCommandLaunch,
): AgentCommandLaunched | null {
  return handler?.(request) ?? null;
}

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * `base --resume <id>` (plus `--fork-session` for a fork), or null for an id
 * that isn't a session UUID or a base command that isn't one plain line.
 */
export function claudeResumeCommand(
  base: string,
  sessionId: string,
  fork = false,
): string | null {
  const command = base.trim();
  if (!command || /[\u0000-\u001f\u007f]/u.test(command)) return null;
  if (!SESSION_ID.test(sessionId)) return null;
  return `${command} --resume ${sessionId}${fork ? " --fork-session" : ""}`;
}
