import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateAgentPhases,
  phaseForSignal,
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

describe("aggregateAgentPhases", () => {
  it("returns null top for no matching ptys", () => {
    expect(aggregateAgentPhases({}, [])).toEqual({ top: null, count: 0 });
    expect(aggregateAgentPhases({ 1: "idle" }, [1])).toEqual({
      top: null,
      count: 0,
    });
  });

  it("counts only agents in the winning phase", () => {
    const phases = { 1: "working", 2: "working", 3: "attention" } as const;
    // attention outranks working; count reflects the single attention agent.
    expect(aggregateAgentPhases(phases, [1, 2, 3])).toEqual({
      top: "attention",
      count: 1,
    });
  });

  it("orders attention > working > finished", () => {
    expect(
      aggregateAgentPhases({ 1: "working", 2: "finished" }, [1, 2]),
    ).toEqual({ top: "working", count: 1 });
    expect(aggregateAgentPhases({ 1: "finished", 2: "finished" }, [1, 2])).toEqual(
      { top: "finished", count: 2 },
    );
  });

  it("only considers the given ptyIds", () => {
    const phases = { 1: "attention", 2: "working" } as const;
    expect(aggregateAgentPhases(phases, [2])).toEqual({
      top: "working",
      count: 1,
    });
  });
});

describe("useAgentActivityStore", () => {
  beforeEach(() => useAgentActivityStore.setState({ phases: {} }));

  it("keeps a stable reference when the phase is unchanged", () => {
    const { setPhase } = useAgentActivityStore.getState();
    setPhase(1, "working");
    const first = useAgentActivityStore.getState().phases;
    setPhase(1, "working");
    // No churn on repeated identical signals, so subscribers do not re-render.
    expect(useAgentActivityStore.getState().phases).toBe(first);
  });

  it("drops a pty on clear", () => {
    const { setPhase, clear } = useAgentActivityStore.getState();
    setPhase(1, "attention");
    clear(1);
    expect(1 in useAgentActivityStore.getState().phases).toBe(false);
  });
});
