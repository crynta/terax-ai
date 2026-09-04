import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedAgent } from "../store/managedAgentsStore";

const managedAgents = vi.hoisted(() => {
  const state = {
    agents: {} as Record<number, ManagedAgent>,
    markReviewed: vi.fn(),
    setPhase: vi.fn(),
    setPendingReview: vi.fn(),
  };
  const useManagedAgentsStore = {
    getState: () => ({
      get: (leafId: number) => state.agents[leafId],
      getBySessionId: (sessionId: string) =>
        Object.values(state.agents).find((a) => a.sessionId === sessionId),
      markReviewed: state.markReviewed,
      setPhase: state.setPhase,
      setPendingReview: state.setPendingReview,
    }),
  };
  return { useManagedAgentsStore, state };
});

vi.mock("../store/managedAgentsStore", () => managedAgents);

const chatStore = vi.hoisted(() => ({
  useChatStore: { getState: () => ({ activeSessionId: "session-1" }) },
}));

vi.mock("@/modules/ai/store/chatStore", () => chatStore);

const chatRuntime = vi.hoisted(() => {
  const sendMessage = vi.fn();
  return { getOrCreateChat: vi.fn(() => ({ sendMessage })), sendMessage };
});

vi.mock("@/modules/ai/store/chatRuntime", () => chatRuntime);

import { firePendingReviewForSession, maybeTriggerManagedReview } from "./review";

function agent(partial: Partial<ManagedAgent>): ManagedAgent {
  return {
    leafId: 7,
    tabId: 1,
    sessionId: "session-1",
    task: "fix the flake",
    cwd: "/repo",
    rounds: 0,
    maxRounds: 3,
    phase: "working",
    reviewedAtRound: -1,
    pendingReview: false,
    ...partial,
  };
}

function setAgent(a: ManagedAgent) {
  managedAgents.state.agents = { [a.leafId]: a };
}

async function sentDirective(): Promise<string> {
  await vi.waitFor(() => expect(chatRuntime.sendMessage).toHaveBeenCalled());
  const calls = chatRuntime.sendMessage.mock.calls;
  const call = calls[calls.length - 1]?.[0] as {
    parts: { text: string }[];
  };
  return call.parts[0].text;
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe("managed agent review gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managedAgents.state.agents = {};
  });

  it("ignores unknown leaves", () => {
    maybeTriggerManagedReview(7);

    expect(managedAgents.state.markReviewed).not.toHaveBeenCalled();
    expect(chatRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses spent agents before firing anything", async () => {
    setAgent(agent({ phase: "done" }));
    maybeTriggerManagedReview(7);
    setAgent(agent({ rounds: 3, maxRounds: 3 }));
    maybeTriggerManagedReview(7);
    setAgent(agent({ rounds: 2, reviewedAtRound: 2 }));
    maybeTriggerManagedReview(7);
    await flush();

    expect(managedAgents.state.markReviewed).not.toHaveBeenCalled();
    expect(chatRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("fires an immediate review for the active session", async () => {
    setAgent(agent({}));
    maybeTriggerManagedReview(7);
    const text = await sentDirective();

    expect(managedAgents.state.markReviewed).toHaveBeenCalledWith(7);
    expect(managedAgents.state.setPhase).toHaveBeenCalledWith(7, "reviewing");
    expect(chatRuntime.getOrCreateChat).toHaveBeenCalledWith("session-1");
    expect(text).toContain("fix the flake");
    expect(text).toContain("read_agent_output");
  });

  it("flags the last automatic round in the directive", async () => {
    setAgent(agent({ rounds: 2, maxRounds: 3 }));
    maybeTriggerManagedReview(7);
    const text = await sentDirective();

    expect(text).toContain("last automatic review round");
  });

  it("omits the last-round flag when rounds remain", async () => {
    setAgent(agent({ rounds: 0, maxRounds: 3 }));
    maybeTriggerManagedReview(7);
    const text = await sentDirective();

    expect(text).not.toContain("last automatic review round");
  });

  it("queues the review when another session is active", async () => {
    setAgent(agent({ sessionId: "session-2" }));
    maybeTriggerManagedReview(7);
    await flush();

    expect(managedAgents.state.setPendingReview).toHaveBeenCalledWith(7, true);
    expect(managedAgents.state.markReviewed).not.toHaveBeenCalled();
    expect(chatRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("fires a pending review on session switch", async () => {
    setAgent(agent({ sessionId: "session-2", pendingReview: true }));
    firePendingReviewForSession("session-2");
    const text = await sentDirective();

    expect(managedAgents.state.markReviewed).toHaveBeenCalledWith(7);
    expect(chatRuntime.getOrCreateChat).toHaveBeenCalledWith("session-2");
    expect(text).toContain("fix the flake");
  });

  it("clears a stale pending flag instead of firing past the round cap", async () => {
    setAgent(
      agent({
        sessionId: "session-2",
        pendingReview: true,
        rounds: 3,
        maxRounds: 3,
      }),
    );
    firePendingReviewForSession("session-2");
    await flush();

    expect(managedAgents.state.setPendingReview).toHaveBeenCalledWith(7, false);
    expect(chatRuntime.sendMessage).not.toHaveBeenCalled();
  });
});
