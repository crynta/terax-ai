import { describe, expect, it } from "vitest";
import {
  HOLD_MAX_MS,
  holdTimeoutMs,
  initialHoldState,
  LATCH_MAX_MS,
  reduceHold,
  TAP_THRESHOLD_MS,
  type HoldEvent,
  type HoldState,
} from "./holdIntent";

function run(events: HoldEvent[], from: HoldState = initialHoldState) {
  const effects: string[] = [];
  let state = from;
  for (const event of events) {
    const next = reduceHold(state, event);
    state = next.state;
    effects.push(next.effect);
  }
  return { state, effects };
}

describe("reduceHold", () => {
  it("starts on the first press", () => {
    const { state, effects } = run([{ type: "down", at: 0 }]);
    expect(effects).toEqual(["start"]);
    expect(state.phase).toBe("holding");
  });

  it("stops on release once the hold passes the tap threshold", () => {
    const { state, effects } = run([
      { type: "down", at: 0 },
      { type: "up", at: TAP_THRESHOLD_MS },
    ]);
    expect(effects).toEqual(["start", "stop"]);
    expect(state.phase).toBe("idle");
  });

  it("latches instead of stopping when the press is a short tap", () => {
    const { state, effects } = run([
      { type: "down", at: 0 },
      { type: "up", at: TAP_THRESHOLD_MS - 1 },
    ]);
    expect(effects).toEqual(["start", "none"]);
    expect(state.phase).toBe("latched");
  });

  it("stops a latched recording on the next tap and swallows its release", () => {
    const { state, effects } = run([
      { type: "down", at: 0 },
      { type: "up", at: 10 },
      { type: "down", at: 5_000 },
      { type: "up", at: 5_050 },
    ]);
    expect(effects).toEqual(["start", "none", "stop", "none"]);
    expect(state.phase).toBe("idle");
  });

  it("never emits a second start for a tap that is still arming", () => {
    const { effects } = run([
      { type: "down", at: 0 },
      { type: "up", at: 20 },
      { type: "down", at: 40 },
      { type: "up", at: 60 },
    ]);
    expect(effects.filter((e) => e === "start")).toHaveLength(1);
  });

  it("ignores auto-repeat presses while holding", () => {
    const { state, effects } = run([
      { type: "down", at: 0 },
      { type: "down", at: 30 },
      { type: "down", at: 60 },
    ]);
    expect(effects).toEqual(["start", "none", "none"]);
    expect(state.downAt).toBe(0);
  });

  it("cancels and discards from every active phase", () => {
    for (const phase of ["holding", "latched", "stopping"] as const) {
      const { state, effect } = reduceHold(
        { phase, downAt: 0 },
        { type: "cancel" },
      );
      expect(effect).toBe("cancel");
      expect(state.phase).toBe("idle");
    }
  });

  it("does nothing when cancelling while idle", () => {
    const { state, effect } = reduceHold(initialHoldState, { type: "cancel" });
    expect(effect).toBe("none");
    expect(state).toBe(initialHoldState);
  });

  it("stops a hold when focus is lost so a missed keyup cannot strand it", () => {
    const { state, effects } = run([
      { type: "down", at: 0 },
      { type: "blur" },
      { type: "up", at: 9_000 },
    ]);
    expect(effects).toEqual(["start", "stop", "none"]);
    expect(state.phase).toBe("idle");
  });

  it("keeps a latched recording across focus loss", () => {
    const { state, effects } = run([
      { type: "down", at: 0 },
      { type: "up", at: 10 },
      { type: "blur" },
    ]);
    expect(effects).toEqual(["start", "none", "none"]);
    expect(state.phase).toBe("latched");
  });

  it("toggles straight into latched mode and back out", () => {
    const on = reduceHold(initialHoldState, { type: "toggle" });
    expect(on.effect).toBe("start");
    expect(on.state.phase).toBe("latched");
    const off = reduceHold(on.state, { type: "toggle" });
    expect(off.effect).toBe("stop");
    expect(off.state.phase).toBe("idle");
  });

  it("returns the same state object when nothing changes", () => {
    const { state } = reduceHold(initialHoldState, { type: "up", at: 5 });
    expect(state).toBe(initialHoldState);
  });
});

describe("holdTimeoutMs", () => {
  it("bounds a physical hold more tightly than an explicit latch", () => {
    expect(holdTimeoutMs("holding")).toBe(HOLD_MAX_MS);
    expect(holdTimeoutMs("latched")).toBe(LATCH_MAX_MS);
    expect(HOLD_MAX_MS).toBeLessThan(LATCH_MAX_MS);
  });

  it("arms no timer while idle or stopping", () => {
    expect(holdTimeoutMs("idle")).toBeNull();
    expect(holdTimeoutMs("stopping")).toBeNull();
  });
});
