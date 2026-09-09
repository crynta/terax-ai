import { create } from "zustand";
import {
  holdTimeoutMs,
  initialHoldState,
  reduceHold,
  type HoldEffect,
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

type PendingEffect = Exclude<HoldEffect, "none">;

type VoiceStore = {
  status: VoiceStatus;
  supported: boolean;
  hasKey: boolean;
  armed: boolean;
  hold: HoldState;
  impl: VoiceImpl | null;
  pending: PendingEffect | null;
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

function applyEffect(impl: VoiceImpl, effect: PendingEffect) {
  if (effect === "start") impl.start();
  else if (effect === "stop") impl.stop();
  else impl.cancel();
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  status: "idle",
  supported: false,
  hasKey: false,
  armed: false,
  hold: initialHoldState,
  impl: null,
  pending: null,

  dispatchHold: (event) => {
    const { hold, impl, armed, pending } = get();
    const { state, effect } = reduceHold(hold, event);
    if (effect === "start" && impl && (!impl.supported || !impl.hasKey)) return;

    const nextArmed = armed || effect === "start";
    const nextPending = impl || effect === "none" ? pending : effect;
    if (state !== hold || nextArmed !== armed || nextPending !== pending) {
      set({ hold: state, armed: nextArmed, pending: nextPending });
    }

    if (impl && effect !== "none") applyEffect(impl, effect);

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

  bindImpl: (impl) => {
    const { pending } = get();
    set({
      impl,
      supported: impl.supported,
      hasKey: impl.hasKey,
      pending: null,
    });
    if (!pending) return;
    if (pending === "start" && (!impl.supported || !impl.hasKey)) {
      clearSafetyTimer();
      set({ hold: initialHoldState });
      return;
    }
    applyEffect(impl, pending);
  },

  setStatus: (status) => {
    if (status === "idle" && !get().pending) {
      clearSafetyTimer();
      set({ status, hold: initialHoldState });
      return;
    }
    set({ status });
  },
}));
