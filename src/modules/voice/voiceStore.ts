import { create } from "zustand";
import {
  holdTimeoutMs,
  initialHoldState,
  reduceHold,
  type HoldEvent,
  type HoldState,
} from "./holdIntent";

export type VoiceStatus = "idle" | "arming" | "recording" | "transcribing";

type VoiceImpl = {
  start: () => void;
  stop: () => void;
  cancel: () => void;
  supported: boolean;
  hasKey: boolean;
};

const NOOP_IMPL: VoiceImpl = {
  start: () => {},
  stop: () => {},
  cancel: () => {},
  supported: false,
  hasKey: false,
};

type VoiceStore = {
  status: VoiceStatus;
  supported: boolean;
  hasKey: boolean;
  hold: HoldState;
  impl: VoiceImpl;
  dispatchHold: (event: HoldEvent) => void;
  toggle: () => void;
  requestStop: () => void;
  requestCancel: () => void;
  bindImpl: (impl: VoiceImpl) => void;
  setStatus: (status: VoiceStatus) => void;
};

let safetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearSafetyTimer() {
  if (safetyTimer === null) return;
  clearTimeout(safetyTimer);
  safetyTimer = null;
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  status: "idle",
  supported: false,
  hasKey: false,
  hold: initialHoldState,
  impl: NOOP_IMPL,

  dispatchHold: (event) => {
    const { hold, impl } = get();
    const { state, effect } = reduceHold(hold, event);
    if (effect === "start" && (!impl.supported || !impl.hasKey)) return;

    if (state !== hold) set({ hold: state });

    if (effect === "start") impl.start();
    else if (effect === "stop") impl.stop();
    else if (effect === "cancel") impl.cancel();

    clearSafetyTimer();
    const limit = holdTimeoutMs(state.phase);
    if (limit !== null) {
      safetyTimer = setTimeout(() => {
        get().dispatchHold({ type: "stop" });
      }, limit);
    }
  },

  toggle: () => get().dispatchHold({ type: "toggle" }),
  requestStop: () => get().dispatchHold({ type: "stop" }),
  requestCancel: () => get().dispatchHold({ type: "cancel" }),

  bindImpl: (impl) =>
    set({ impl, supported: impl.supported, hasKey: impl.hasKey }),

  setStatus: (status) => {
    if (status === "idle") {
      clearSafetyTimer();
      set({ status, hold: initialHoldState });
      return;
    }
    set({ status });
  },
}));
