/**
 * The Stop button's states. Stop sends Esc once; if Claude still works after
 * `FORCE_AFTER_MS`, the button offers "Force stop", which sends Esc again
 * (some states need a double Esc). Never Ctrl+C.
 */
export const FORCE_AFTER_MS = 1500;
/** How long "Stopped" stays before the button resets. */
export const STOPPED_SHOW_MS = 2000;

export type StopState =
  | { kind: "idle" }
  | { kind: "stopping"; at: number; presses: number }
  | { kind: "force"; at: number; presses: number }
  | { kind: "stopped"; at: number };

export const STOP_IDLE: StopState = { kind: "idle" };

/** A press of Stop: the next state and whether to send Esc. */
export function pressStop(
  state: StopState,
  now: number,
): { state: StopState; sendEsc: boolean } {
  if (state.kind === "idle" || state.kind === "stopped") {
    return { state: { kind: "stopping", at: now, presses: 1 }, sendEsc: true };
  }
  if (state.kind === "force") {
    return {
      state: { kind: "stopping", at: now, presses: state.presses + 1 },
      sendEsc: true,
    };
  }
  // Already stopping: wait for the force offer instead of stacking Escs.
  return { state, sendEsc: false };
}

/** Advances on time and Claude's working signal. */
export function tickStop(
  state: StopState,
  now: number,
  working: boolean,
): StopState {
  if (state.kind === "stopping" || state.kind === "force") {
    if (!working) return { kind: "stopped", at: now };
    if (state.kind === "stopping" && now - state.at >= FORCE_AFTER_MS) {
      return { kind: "force", at: now, presses: state.presses };
    }
    return state;
  }
  if (state.kind === "stopped" && now - state.at >= STOPPED_SHOW_MS) {
    return STOP_IDLE;
  }
  return state;
}

export function stopLabel(state: StopState): string {
  switch (state.kind) {
    case "stopping":
      return "Stopping…";
    case "force":
      return "Force stop";
    case "stopped":
      return "Stopped";
    default:
      return "Stop";
  }
}

/**
 * Whether Claude is working, read off its screen when it can be: a spinner
 * line means working, a finished line or an input box without a spinner
 * means idle. An interrupt fires no hook, so the hook phase alone would stay
 * "working" (and Stop at "Force stop") until the next turn.
 */
export function liveWorking(
  phase: string | undefined,
  activity: { done: boolean } | null,
  footerVisible: boolean,
): boolean {
  if (activity) return !activity.done;
  if (footerVisible) return false;
  return phase === "working";
}
