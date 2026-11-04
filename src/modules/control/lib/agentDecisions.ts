import type { AgentModelEvent } from "@/modules/agents/model";
import { invoke } from "@tauri-apps/api/core";
import {
  agentEventsReady,
  hookEventToModelEvent,
  subscribeAgentEvents,
} from "./agentEvents";
import { createReadinessQueue } from "./readiness";

/** The UI's answer to an agent's permission request. */
export type AgentDecision =
  | {
      behavior: "allow";
      /** Index of the request's suggestion to apply as an "always allow". */
      remember?: number;
    }
  | { behavior: "deny"; message?: string; interrupt?: boolean }
  /** Hand the question back to the agent's own prompt. */
  | { behavior: "ask" };

const setDecisionsReady = createReadinessQueue((ready) =>
  invoke("agent_decisions_ready", { ready }),
);

/**
 * Answers a pending permission request. False when it already ended (the
 * agent was answered in its own terminal, closed, or timed out).
 */
export function resolveAgentDecision(
  requestId: string,
  decision: AgentDecision,
): Promise<boolean> {
  return invoke<boolean>("agent_decision_respond", { requestId, decision });
}

/**
 * Feeds hook events to `dispatch` and, when `decisions` is set, tells the
 * native side that this window shows permission requests. Agents are only
 * made to wait while that is true; the returned function withdraws it, which
 * hands every waiting agent back to its own prompt.
 */
export function connectAgentEvents(
  dispatch: (event: AgentModelEvent) => void,
  options: { decisions: boolean },
): () => void {
  const stop = subscribeAgentEvents((event) =>
    dispatch(hookEventToModelEvent(event)),
  );
  let disposed = false;
  if (options.decisions) {
    // Agents wait only once the listener can receive their request.
    void agentEventsReady()
      .then(() => (disposed ? undefined : setDecisionsReady(true)))
      .catch((error) => {
        console.error("[terax] could not enable agent decisions:", error);
      });
  }
  return () => {
    disposed = true;
    stop();
    if (options.decisions) {
      void setDecisionsReady(false).catch((error) => {
        console.error("[terax] could not withdraw agent decisions:", error);
      });
    }
  };
}
