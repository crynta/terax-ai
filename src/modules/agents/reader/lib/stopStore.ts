import { writeToSession } from "@/modules/terminal/lib/terminalSessionApi";
import { create } from "zustand";
import { pressStop, STOP_IDLE, type StopState, tickStop } from "./stopControl";

type StopStoreState = {
  /** Each pane's Stop button state. */
  states: Record<number, StopState>;
  /** Counts manual stops per pane; the composer pauses its queue on a change. */
  stops: Record<number, number>;
  set: (leafId: number, state: StopState) => void;
};

export const useStopStore = create<StopStoreState>((set) => ({
  states: {},
  stops: {},
  set: (leafId, state) =>
    set((s) =>
      s.states[leafId] === state
        ? s
        : { states: { ...s.states, [leafId]: state } },
    ),
}));

/** Stop (or Force stop) for `leafId`: sends Esc when the state machine says so. */
export function pressStopFor(leafId: number): void {
  const store = useStopStore.getState();
  const { state, sendEsc } = pressStop(
    store.states[leafId] ?? STOP_IDLE,
    Date.now(),
  );
  if (sendEsc) writeToSession(leafId, "\x1b");
  useStopStore.setState((s) => ({
    states: { ...s.states, [leafId]: state },
    stops: sendEsc
      ? { ...s.stops, [leafId]: (s.stops[leafId] ?? 0) + 1 }
      : s.stops,
  }));
}

/** A new turn starts: Stop goes back to plain "Stop", whatever happened last turn. */
export function resetStopFor(leafId: number): void {
  const store = useStopStore.getState();
  if ((store.states[leafId] ?? STOP_IDLE).kind !== "idle") {
    store.set(leafId, STOP_IDLE);
  }
}

/** Advances `leafId`'s Stop state against Claude's working signal. */
export function tickStopFor(leafId: number, working: boolean): void {
  const store = useStopStore.getState();
  const current = store.states[leafId] ?? STOP_IDLE;
  const next = tickStop(current, Date.now(), working);
  if (next !== current) store.set(leafId, next);
}

export function useStopState(leafId: number): StopState {
  return useStopStore((s) => s.states[leafId] ?? STOP_IDLE);
}
