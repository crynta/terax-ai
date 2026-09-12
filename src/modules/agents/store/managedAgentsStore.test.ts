import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_ROUNDS, useManagedAgentsStore } from "./managedAgentsStore";

function reset() {
  useManagedAgentsStore.setState({ agents: {} });
}

describe("managed agents store", () => {
  beforeEach(reset);

  it("registers an agent with defaults and explicit max rounds", () => {
    useManagedAgentsStore.getState().register({
      leafId: 7,
      tabId: 3,
      sessionId: "s1",
      task: "fix flake",
      cwd: "/repo",
    });
    useManagedAgentsStore.getState().register({
      leafId: 8,
      tabId: 4,
      sessionId: "s2",
      task: "other",
      cwd: null,
      maxRounds: 5,
    });

    const a = useManagedAgentsStore.getState().get(7);
    expect(a).toMatchObject({
      leafId: 7,
      tabId: 3,
      sessionId: "s1",
      rounds: 0,
      maxRounds: DEFAULT_MAX_ROUNDS,
      phase: "spawning",
      reviewedAtRound: -1,
      pendingReview: false,
    });
    expect(useManagedAgentsStore.getState().get(8)?.maxRounds).toBe(5);
  });

  it("setPhase ignores unknown leaves and identical phases", () => {
    expect(
      useManagedAgentsStore.getState().setPhase(42, "working"),
    ).toBeUndefined();

    useManagedAgentsStore
      .getState()
      .register({ leafId: 7, tabId: 1, sessionId: "s", task: "t", cwd: null });
    const before = useManagedAgentsStore.getState().get(7);

    useManagedAgentsStore.getState().setPhase(7, "spawning");

    expect(useManagedAgentsStore.getState().get(7)).toBe(before);
  });

  it("markReviewed stamps the current round and clears pendingReview", () => {
    const store = useManagedAgentsStore.getState();
    store.register({
      leafId: 7,
      tabId: 1,
      sessionId: "s",
      task: "t",
      cwd: null,
    });
    store.bumpRound(7);
    store.setPendingReview(7, true);
    store.markReviewed(7);

    const a = useManagedAgentsStore.getState().get(7);
    expect(a).toBeDefined();
    expect(a!.reviewedAtRound).toBe(1);
    expect(a!.pendingReview).toBe(false);
  });

  it("bumpRound increments rounds and returns the agent to working", () => {
    const store = useManagedAgentsStore.getState();
    store.register({
      leafId: 7,
      tabId: 1,
      sessionId: "s",
      task: "t",
      cwd: null,
    });
    store.setPhase(7, "reviewing");
    store.bumpRound(7);

    const a = useManagedAgentsStore.getState().get(7);
    expect(a).toBeDefined();
    expect(a!.rounds).toBe(1);
    expect(a!.phase).toBe("working");
  });

  it("remove drops the agent entirely", () => {
    const store = useManagedAgentsStore.getState();
    store.register({
      leafId: 7,
      tabId: 1,
      sessionId: "s",
      task: "t",
      cwd: null,
    });
    store.remove(7);

    expect(useManagedAgentsStore.getState().get(7)).toBeUndefined();
  });

  it("getBySessionId finds the agent bound to a chat session", () => {
    const store = useManagedAgentsStore.getState();
    store.register({
      leafId: 7,
      tabId: 1,
      sessionId: "session-a",
      task: "t",
      cwd: null,
    });
    store.register({
      leafId: 9,
      tabId: 2,
      sessionId: "session-b",
      task: "u",
      cwd: null,
    });

    expect(useManagedAgentsStore.getState().getBySessionId("session-b")?.leafId).toBe(
      9,
    );
    expect(
      useManagedAgentsStore.getState().getBySessionId("missing"),
    ).toBeUndefined();
  });
});
