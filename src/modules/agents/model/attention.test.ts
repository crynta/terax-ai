import { describe, expect, it } from "vitest";
import {
  attentionOrder,
  needsAttention,
  nextAttentionAgent,
  subagentCounts,
} from "./attention";
import type { Agent, AgentRegistry, AgentState } from "./types";

function agent(
  ptyId: number,
  state: AgentState,
  attentionSince: number | null,
  extra: Partial<Agent> = {},
): Agent {
  return {
    ptyId,
    paneId: ptyId,
    agent: "claude",
    state,
    waitingReason: null,
    sessionId: null,
    transcriptPath: null,
    cwd: null,
    lastMessage: null,
    lastPrompt: null,
    currentTool: null,
    runningTools: {},
    subagents: {},
    pendingPermission: null,
    turn: 0,
    provenance: "hook",
    startedAt: 0,
    updatedAt: attentionSince ?? 0,
    stateSince: 0,
    attentionSince,
    ...extra,
  };
}

function registryOf(...agents: Agent[]): AgentRegistry {
  return Object.fromEntries(agents.map((entry) => [entry.ptyId, entry]));
}

const ids = (agents: Agent[]) => agents.map((entry) => entry.ptyId);

describe("attentionOrder", () => {
  it("lists agents that need the user, oldest first", () => {
    const registry = registryOf(
      agent(1, "working", null),
      agent(2, "needs-input", 300),
      agent(3, "needs-approval", 100),
      agent(4, "done", 200),
      agent(5, "error", 50),
      agent(6, "idle", null),
      agent(7, "exited", null),
      agent(8, "starting", null),
    );
    expect(ids(attentionOrder(registry))).toEqual([5, 3, 4, 2]);
  });

  it("can leave out finished turns", () => {
    const registry = registryOf(
      agent(1, "done", 10),
      agent(2, "needs-approval", 20),
    );
    expect(ids(attentionOrder(registry, { includeDone: false }))).toEqual([2]);
  });

  it("breaks ties by urgency, then terminal", () => {
    const registry = registryOf(
      agent(9, "done", 100),
      agent(5, "needs-input", 100),
      agent(7, "needs-approval", 100),
      agent(3, "needs-approval", 100),
    );
    expect(ids(attentionOrder(registry))).toEqual([3, 7, 5, 9]);
  });

  it("is empty when nothing needs the user", () => {
    expect(attentionOrder({})).toEqual([]);
    expect(attentionOrder(registryOf(agent(1, "working", null)))).toEqual([]);
  });
});

describe("nextAttentionAgent", () => {
  const registry = registryOf(
    agent(1, "needs-input", 10),
    agent(2, "needs-approval", 20),
    agent(3, "done", 30),
  );

  it("starts at the oldest and cycles", () => {
    expect(nextAttentionAgent(registry, null)?.ptyId).toBe(1);
    expect(nextAttentionAgent(registry, 1)?.ptyId).toBe(2);
    expect(nextAttentionAgent(registry, 2)?.ptyId).toBe(3);
    expect(nextAttentionAgent(registry, 3)?.ptyId).toBe(1);
  });

  it("starts at the oldest when the current terminal is not waiting", () => {
    expect(nextAttentionAgent(registry, 99)?.ptyId).toBe(1);
  });

  it("returns null when nothing waits", () => {
    expect(nextAttentionAgent({}, 1)).toBeNull();
  });
});

describe("helpers", () => {
  it("knows which states need the user", () => {
    const table: [AgentState, boolean][] = [
      ["starting", false],
      ["working", false],
      ["needs-input", true],
      ["needs-approval", true],
      ["done", true],
      ["error", true],
      ["idle", false],
      ["exited", false],
    ];
    for (const [state, expected] of table) {
      expect(needsAttention(agent(1, state, 1)), state).toBe(expected);
    }
  });

  it("counts subagents", () => {
    const counts = subagentCounts(
      agent(1, "working", null, {
        subagents: {
          a: {
            id: "a",
            type: "x",
            state: "running",
            startedAt: 0,
            endedAt: null,
            message: null,
          },
          b: {
            id: "b",
            type: "x",
            state: "done",
            startedAt: 0,
            endedAt: 1,
            message: null,
          },
        },
      }),
    );
    expect(counts).toEqual({ running: 1, done: 1, total: 2 });
    expect(subagentCounts(agent(2, "idle", null))).toEqual({
      running: 0,
      done: 0,
      total: 0,
    });
  });
});
