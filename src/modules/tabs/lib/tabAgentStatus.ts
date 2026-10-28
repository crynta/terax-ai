import {
  type AgentTabStatus,
  tabAgentStatus,
  type useAgentActivityStore,
} from "@/modules/terminal/lib/agentActivity";

type ActivityState = Pick<
  ReturnType<typeof useAgentActivityStore.getState>,
  "phases" | "agents"
>;

/** Shared result for tabs with no agent state (and for non-terminal tabs). */
export const NO_AGENT_STATUS: AgentTabStatus = Object.freeze({
  state: null,
  agent: null,
});

/**
 * One tab's agent status, derived from the global activity maps.
 *
 * Meant to be used as a store selector wrapped in `useShallow`: the maps change
 * whenever *any* pty changes phase, but a tab's `{ state, agent }` pair is two
 * primitives, so shallow equality keeps every other tab from re-rendering.
 * Subscribing to `phases`/`agents` directly would re-render all tabs on every
 * agent signal.
 */
export function selectTabAgentStatus(
  state: ActivityState,
  ptyIds: readonly number[],
): AgentTabStatus {
  if (ptyIds.length === 0) return NO_AGENT_STATUS;
  return tabAgentStatus(state.phases, state.agents, ptyIds);
}
