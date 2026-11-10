import type { AgentHookEvent } from "@/modules/agents/model";

/** A Claude session id: only these name a transcript file. */
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Claude session a structured hook event reports for its pane, or null.
 * The legacy agent signals no longer carry it, so this is how a pane is
 * linked to its transcript (a resumed session reports the resumed id).
 */
export function claudeSessionOf(
  event: Pick<AgentHookEvent, "agent" | "sessionId">,
): string | null {
  if (event.agent !== "claude" || !event.sessionId) return null;
  return SESSION_ID.test(event.sessionId) ? event.sessionId : null;
}
