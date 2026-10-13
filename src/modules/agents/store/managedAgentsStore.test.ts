import { beforeEach, describe, expect, it } from "vitest";
import { useManagedAgentsStore } from "./managedAgentsStore";

function register(leafId: number, tabId: number): void {
  useManagedAgentsStore.getState().register({
    leafId,
    tabId,
    sessionId: `s${leafId}`,
    task: "task",
    cwd: null,
  });
}

describe("managed agents store", () => {
  beforeEach(() => {
    useManagedAgentsStore.setState({ agents: {} });
  });

  it("moveLeafToTab retargets only the moved leaf", () => {
    register(7, 3);
    register(8, 3);

    useManagedAgentsStore.getState().moveLeafToTab(7, 5);

    const { agents } = useManagedAgentsStore.getState();
    expect(agents[7]).toMatchObject({ leafId: 7, tabId: 5, sessionId: "s7" });
    expect(agents[8].tabId).toBe(3);
  });

  it("moveLeafToTab skips the write for unknown or unchanged leaves", () => {
    register(8, 3);
    const before = useManagedAgentsStore.getState().agents;

    useManagedAgentsStore.getState().moveLeafToTab(7, 5);
    useManagedAgentsStore.getState().moveLeafToTab(8, 3);

    expect(useManagedAgentsStore.getState().agents).toBe(before);
  });
});
