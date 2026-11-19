import { needsYou } from "./reducer";
import type { Agent, AgentRegistry, AgentState } from "./types";

/** Tie-break when two agents began needing the user in the same instant. */
const URGENCY: Partial<Record<AgentState, number>> = {
  "needs-approval": 0,
  "needs-input": 1,
  error: 2,
  done: 3,
};

export function needsAttention(agent: Agent): boolean {
  return needsYou(agent.state);
}

/** Agents that need the user, the one waiting longest first. */
export function attentionOrder(
  registry: AgentRegistry,
  options: { includeDone?: boolean } = {},
): Agent[] {
  const includeDone = options.includeDone ?? true;
  return Object.values(registry)
    .filter(
      (agent) =>
        needsAttention(agent) && (includeDone || agent.state !== "done"),
    )
    .sort(
      (a, b) =>
        (a.attentionSince ?? a.updatedAt) - (b.attentionSince ?? b.updatedAt) ||
        (URGENCY[a.state] ?? 9) - (URGENCY[b.state] ?? 9) ||
        a.ptyId - b.ptyId,
    );
}

/** The next agent to visit after `currentPtyId`, wrapping around. */
export function nextAttentionAgent(
  registry: AgentRegistry,
  currentPtyId: number | null,
  options: { includeDone?: boolean } = {},
): Agent | null {
  const queue = attentionOrder(registry, options);
  if (queue.length === 0) return null;
  const index = queue.findIndex((agent) => agent.ptyId === currentPtyId);
  return queue[index === -1 ? 0 : (index + 1) % queue.length] ?? null;
}

export type SubagentCounts = { running: number; done: number; total: number };

export function subagentCounts(agent: Agent): SubagentCounts {
  const counts = { running: 0, done: 0, total: 0 };
  for (const subagent of Object.values(agent.subagents)) {
    counts.total += 1;
    if (subagent.state === "running") counts.running += 1;
    else counts.done += 1;
  }
  return counts;
}
