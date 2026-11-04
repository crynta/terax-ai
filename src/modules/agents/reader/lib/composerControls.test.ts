import { describe, expect, it } from "vitest";
import {
  choiceForModel,
  MODE_CYCLE_MAX_PRESSES,
  modeChoicesFor,
  modelCommand,
  nextCycleStep,
} from "./composerControls";

describe("model picker", () => {
  it("builds /model commands only for single-word aliases", () => {
    expect(modelCommand("opus")).toBe("/model opus");
    expect(modelCommand(" sonnet[1m] ")).toBe("/model sonnet[1m]");
    expect(modelCommand("")).toBeNull();
    expect(modelCommand("opus; rm -rf")).toBeNull();
  });

  it("maps friendly model names to choices", () => {
    expect(choiceForModel("Opus 5.5")?.alias).toBe("opus");
    expect(choiceForModel("Sonnet 4.5 (1M)")?.alias).toBe("sonnet[1m]");
    expect(choiceForModel("claude-haiku-5-5")?.alias).toBe("haiku");
    expect(choiceForModel("GPT")).toBeNull();
    expect(choiceForModel(null)).toBeNull();
  });
});

describe("mode cycling", () => {
  it("presses until the target shows, then stops", () => {
    expect(
      nextCycleStep({
        target: "plan",
        observed: "default",
        presses: 0,
        misses: 0,
      }),
    ).toEqual({ kind: "press" });
    expect(
      nextCycleStep({
        target: "plan",
        observed: "plan",
        presses: 2,
        misses: 0,
      }),
    ).toEqual({ kind: "done" });
  });

  it("waits on an unreadable footer and gives up after three misses", () => {
    expect(
      nextCycleStep({ target: "plan", observed: null, presses: 1, misses: 1 }),
    ).toEqual({ kind: "wait" });
    expect(
      nextCycleStep({ target: "plan", observed: null, presses: 1, misses: 3 })
        .kind,
    ).toBe("fail");
  });

  it("fails after the press budget", () => {
    const step = nextCycleStep({
      target: "auto",
      observed: "default",
      presses: MODE_CYCLE_MAX_PRESSES,
      misses: 0,
    });
    expect(step.kind).toBe("fail");
    expect(step.kind === "fail" && step.reason).toContain("Auto");
  });

  it("offers bypass only while it is active", () => {
    expect(modeChoicesFor("default").map((c) => c.mode)).not.toContain(
      "bypass",
    );
    expect(modeChoicesFor("bypass").map((c) => c.mode)).toContain("bypass");
  });
});
