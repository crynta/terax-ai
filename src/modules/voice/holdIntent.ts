export const TAP_THRESHOLD_MS = 400;
export const HOLD_MAX_MS = 90_000;
export const LATCH_MAX_MS = 600_000;

export type HoldPhase = "idle" | "holding" | "latched" | "stopping";

export type HoldState = {
  phase: HoldPhase;
  downAt: number;
};

export type HoldEvent =
  | { type: "down"; at: number }
  | { type: "up"; at: number }
  | { type: "toggle" }
  | { type: "stop" }
  | { type: "cancel" }
  | { type: "blur" };

export type HoldEffect = "start" | "stop" | "cancel" | "none";

export type HoldTransition = {
  state: HoldState;
  effect: HoldEffect;
};

export const initialHoldState: HoldState = { phase: "idle", downAt: 0 };

const stay = (state: HoldState): HoldTransition => ({ state, effect: "none" });

const go = (
  phase: HoldPhase,
  effect: HoldEffect,
  downAt = 0,
): HoldTransition => ({ state: { phase, downAt }, effect });

export function reduceHold(
  state: HoldState,
  event: HoldEvent,
  tapThresholdMs: number = TAP_THRESHOLD_MS,
): HoldTransition {
  if (event.type === "cancel") {
    return state.phase === "idle" ? stay(state) : go("idle", "cancel");
  }

  switch (state.phase) {
    case "idle":
      if (event.type === "down") return go("holding", "start", event.at);
      if (event.type === "toggle") return go("latched", "start");
      return stay(state);

    case "holding":
      if (event.type === "up") {
        return event.at - state.downAt >= tapThresholdMs
          ? go("idle", "stop")
          : go("latched", "none");
      }
      if (event.type === "stop" || event.type === "toggle") {
        return go("idle", "stop");
      }
      if (event.type === "blur") return go("idle", "stop");
      return stay(state);

    case "latched":
      if (event.type === "down") return go("stopping", "stop");
      if (event.type === "stop" || event.type === "toggle") {
        return go("idle", "stop");
      }
      return stay(state);

    case "stopping":
      if (event.type === "up" || event.type === "blur") return go("idle", "none");
      if (event.type === "stop" || event.type === "toggle") {
        return go("idle", "none");
      }
      return stay(state);
  }
}

export function holdTimeoutMs(
  phase: HoldPhase,
  holdMaxMs: number = HOLD_MAX_MS,
  latchMaxMs: number = LATCH_MAX_MS,
): number | null {
  if (phase === "holding") return holdMaxMs;
  if (phase === "latched") return latchMaxMs;
  return null;
}
