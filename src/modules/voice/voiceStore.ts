import { create } from "zustand";

export type VoiceStatus = "idle" | "recording" | "transcribing";

type VoiceImpl = {
  start: () => void;
  stop: () => void;
  supported: boolean;
  hasKey: boolean;
};

type VoiceStore = {
  status: VoiceStatus;
  supported: boolean;
  hasKey: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  bindImpl: (impl: VoiceImpl) => void;
  setStatus: (status: VoiceStatus) => void;
};

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  status: "idle",
  supported: false,
  hasKey: false,
  start: () => {},
  stop: () => {},
  toggle: () => {
    const s = get();
    if (s.status === "recording") s.stop();
    else if (s.status === "idle") s.start();
  },
  bindImpl: (impl) =>
    set({
      start: impl.start,
      stop: impl.stop,
      supported: impl.supported,
      hasKey: impl.hasKey,
    }),
  setStatus: (status) => set({ status }),
}));
