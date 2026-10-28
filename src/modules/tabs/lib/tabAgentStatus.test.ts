import { shallow } from "zustand/shallow";
import { beforeEach, describe, expect, it } from "vitest";
import { useAgentActivityStore } from "@/modules/terminal/lib/agentActivity";
import { NO_AGENT_STATUS, selectTabAgentStatus } from "./tabAgentStatus";

const select = (ptyIds: readonly number[]) =>
  selectTabAgentStatus(useAgentActivityStore.getState(), ptyIds);

beforeEach(() => {
  useAgentActivityStore.setState({ phases: {}, agents: {} });
});

describe("selectTabAgentStatus", () => {
  it("returns the shared empty status without scanning for tabs with no ptys", () => {
    expect(select([])).toBe(NO_AGENT_STATUS);
  });

  it("reflects only the tab's own ptys", () => {
    const store = useAgentActivityStore.getState();
    store.setPhase(2, "working");
    store.setAgent(2, "claude");
    expect(select([1])).toEqual({ state: null, agent: null });
    expect(select([1, 2])).toEqual({ state: "working", agent: "claude" });
  });

  it("stays shallow-equal when an unrelated pty changes, so the tab skips re-rendering", () => {
    const store = useAgentActivityStore.getState();
    store.setPhase(1, "working");
    store.setAgent(1, "codex");
    const before = select([1]);

    store.setPhase(2, "attention");
    store.setAgent(2, "claude");
    store.setPhase(3, "finished");
    store.clear(3);

    expect(shallow(before, select([1]))).toBe(true);
  });

  it("changes when the tab's own pty changes phase", () => {
    const store = useAgentActivityStore.getState();
    store.setPhase(1, "working");
    const before = select([1]);
    store.setPhase(1, "attention");
    expect(shallow(before, select([1]))).toBe(false);
  });
});
