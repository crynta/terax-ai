/**
 * Claude panes open in the Reader's chat view when they start. Only a fresh
 * launch does it, so switching back to the terminal sticks for that session.
 */
export function shouldOpenInChat(
  agent: string | null,
  enabled: boolean,
  alreadyTracked: boolean,
): boolean {
  return enabled && !alreadyTracked && agent === "claude";
}
