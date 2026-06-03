import { create } from "zustand";
import type { CodexAuthStatus } from "@/modules/ai/lib/native";

type State = {
  status: CodexAuthStatus | null;
  setStatus: (status: CodexAuthStatus) => void;
};

export const useCodexAuthStore = create<State>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));
