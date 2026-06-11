import { describe, expect, it } from "vitest";
import {
  type AgentRunPhase,
  chatMetaToAgentRun,
  chatStatusToPhase,
  isAgentBusy,
  piSessionToAgentRun,
  piStatusToPhase,
} from "./agentRun";

describe("agentRun contract", () => {
  it("maps chat statuses onto the unified phase", () => {
    expect(chatStatusToPhase("idle")).toBe("idle");
    expect(chatStatusToPhase("thinking")).toBe("preparing");
    expect(chatStatusToPhase("streaming")).toBe("streaming");
    expect(chatStatusToPhase("awaiting-approval")).toBe("awaiting-approval");
    expect(chatStatusToPhase("error")).toBe("error");
  });

  it("maps pi session statuses onto the unified phase", () => {
    expect(piStatusToPhase("idle")).toBe("idle");
    expect(piStatusToPhase("stopped")).toBe("idle");
    expect(piStatusToPhase("running")).toBe("streaming");
    expect(piStatusToPhase("error")).toBe("error");
  });

  it("treats only idle and error as not-busy", () => {
    const busyPhases: AgentRunPhase[] = [
      "preparing",
      "streaming",
      "awaiting-approval",
    ];
    for (const phase of busyPhases) expect(isAgentBusy(phase)).toBe(true);
    expect(isAgentBusy("idle")).toBe(false);
    expect(isAgentBusy("error")).toBe(false);
  });

  it("preserves the pre-existing source-control busy semantics", () => {
    // Old check was: status !== "idle" && status !== "error".
    const cases: Array<[Parameters<typeof chatStatusToPhase>[0], boolean]> = [
      ["idle", false],
      ["thinking", true],
      ["streaming", true],
      ["awaiting-approval", true],
      ["error", false],
    ];
    for (const [status, expected] of cases) {
      expect(isAgentBusy(chatStatusToPhase(status))).toBe(expected);
    }
  });

  it("builds a full AgentRun from chat meta, carrying usage/step/error", () => {
    const run = chatMetaToAgentRun({
      status: "streaming",
      step: "writing file",
      error: null,
      tokens: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 },
    });
    expect(run.phase).toBe("streaming");
    expect(run.busy).toBe(true);
    expect(run.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 2,
    });
    expect(run.step).toBe("writing file");
    expect(run.error).toBeNull();
  });

  it("builds an AgentRun from a pi session, surfacing error only when failed", () => {
    expect(piSessionToAgentRun({ status: "running" })).toMatchObject({
      phase: "streaming",
      busy: true,
      usage: null,
    });
    expect(piSessionToAgentRun({ status: "error", error: "boom" }).error).toBe(
      "boom",
    );
    expect(
      piSessionToAgentRun({ status: "idle", error: "stale" }).error,
    ).toBeNull();
  });
});
