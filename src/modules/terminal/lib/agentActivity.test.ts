import { beforeEach, describe, expect, it } from "vitest";
import {
  isAgentActivePty,
  phaseForSignal,
  tabAgentStatus,
  useAgentActivityStore,
} from "./agentActivity";

describe("phaseForSignal", () => {
  it("maps lifecycle kinds to phases", () => {
    expect(phaseForSignal("started")).toBe("working");
    expect(phaseForSignal("working")).toBe("working");
    expect(phaseForSignal("attention")).toBe("attention");
    expect(phaseForSignal("finished")).toBe("finished");
    expect(phaseForSignal("exited")).toBe("exited");
  });

  it("ignores unknown kinds", () => {
    expect(phaseForSignal("bogus")).toBeNull();
    expect(phaseForSignal("")).toBeNull();
  });
});

describe("tabAgentStatus", () => {
  it("returns null state for no matching ptys", () => {
    expect(tabAgentStatus({}, {}, [])).toEqual({ state: null, agent: null });
    expect(tabAgentStatus({ 1: "idle" }, {}, [1])).toEqual({
      state: null,
      agent: null,
    });
    expect(tabAgentStatus({ 1: "idle" }, { 1: "codex" }, [1])).toEqual({
      state: "idle",
      agent: "codex",
    });
  });

  it("orders attention > working > finished", () => {
    const phases = { 1: "working", 2: "finished", 3: "attention" } as const;
    expect(tabAgentStatus(phases, {}, [1, 2, 3])).toEqual({
      state: "attention",
      agent: null,
    });
    expect(tabAgentStatus({ 1: "working", 2: "finished" }, {}, [1, 2])).toEqual({
      state: "working",
      agent: null,
    });
    expect(tabAgentStatus({ 1: "finished" }, {}, [1])).toEqual({
      state: "finished",
      agent: null,
    });
  });

  it("surfaces the working agent name for its icon", () => {
    const phases = { 7: "working" } as const;
    expect(tabAgentStatus(phases, { 7: "claude" }, [7])).toEqual({
      state: "working",
      agent: "claude",
    });
  });

  it("surfaces the acknowledged agent name for its icon", () => {
    const phases = { 7: "idle" } as const;
    expect(tabAgentStatus(phases, { 7: "gemini" }, [7])).toEqual({
      state: "idle",
      agent: "gemini",
    });
  });

  it("only considers the given ptyIds", () => {
    const phases = { 1: "attention", 2: "working" } as const;
    expect(tabAgentStatus(phases, { 2: "codex" }, [2])).toEqual({
      state: "working",
      agent: "codex",
    });
  });
});

describe("useAgentActivityStore", () => {
  beforeEach(() => useAgentActivityStore.setState({ phases: {}, agents: {} }));

  it("keeps a stable reference when the phase is unchanged", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "working");
    const first = useAgentActivityStore.getState().phases;
    setPhase(1, "working");
    // No churn on repeated identical signals, so subscribers do not re-render.
    expect(useAgentActivityStore.getState().phases).toBe(first);
  });

  it("drops a pty's phase and agent on clear", () => {
    const { setPhase, setAgent, clear } = useAgentActivityStore.getState();
    setPhase(1, "attention");
    setAgent(1, "gemini");
    clear(1);
    const state = useAgentActivityStore.getState();
    expect(1 in state.phases).toBe(false);
    expect(1 in state.agents).toBe(false);
  });

  it("acknowledges attention without losing active agent state", () => {
    const { setPhase, setAgent, acknowledgeAttention } =
      useAgentActivityStore.getState();
    setPhase(1, "attention");
    setAgent(1, "gemini");
    setPhase(2, "working");
    const agents = useAgentActivityStore.getState().agents;

    acknowledgeAttention([1, 2, 3]);

    const state = useAgentActivityStore.getState();
    expect(state.phases).toEqual({ 1: "idle", 2: "working" });
    expect(state.agents).toBe(agents);
    expect(isAgentActivePty(1)).toBe(true);
    expect(tabAgentStatus(state.phases, state.agents, [1])).toEqual({
      state: "idle",
      agent: "gemini",
    });
  });
});
