import { describe, expect, it } from "vitest";

import {
  initialModeState,
  type ModeEvent,
  modeOf,
  reduceMode,
} from "./modeMachine";

function run(events: ModeEvent[]) {
  return events.reduce(reduceMode, initialModeState());
}

const osc = (marker: "A" | "B" | "C" | "D"): ModeEvent => ({
  type: "osc133",
  marker,
});
const alt = (active: boolean): ModeEvent => ({ type: "altScreen", active });

describe("modeMachine", () => {
  it("starts at the prompt", () => {
    expect(modeOf(initialModeState())).toBe("prompt");
  });

  it("enters running on command exec (OSC 133 C)", () => {
    expect(modeOf(run([osc("A"), osc("B"), osc("C")]))).toBe("running");
  });

  it("returns to the prompt when the command ends (OSC 133 D)", () => {
    expect(modeOf(run([osc("C"), osc("D")]))).toBe("prompt");
    expect(modeOf(run([osc("C"), osc("D"), osc("A")]))).toBe("prompt");
  });

  it("alt-screen takes visual precedence over the shell phase", () => {
    expect(modeOf(run([osc("C"), alt(true)]))).toBe("alt");
    expect(modeOf(run([alt(true), osc("A")]))).toBe("alt");
  });

  it("leaving alt-screen restores the underlying phase", () => {
    // vim launched from a command: still running underneath until OSC 133 D.
    expect(modeOf(run([osc("C"), alt(true), alt(false)]))).toBe("running");
    expect(modeOf(run([osc("C"), alt(true), alt(false), osc("D")]))).toBe(
      "prompt",
    );
  });

  it("is idempotent for repeated markers and unchanged alt-screen", () => {
    const a = run([osc("C"), osc("C")]);
    const b = run([osc("C")]);
    expect(a).toEqual(b);
    const before = run([alt(true)]);
    expect(reduceMode(before, alt(true))).toBe(before);
  });
});
