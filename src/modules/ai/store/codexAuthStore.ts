import { create } from "zustand";
import {
  CODEX_DISCONNECTED_STATUS,
  cancelCodexDeviceLogin,
  getCodexAuthStatus,
  logoutCodex,
  pollCodexDeviceLogin,
  startCodexDeviceLogin,
  type CodexAuthStatus,
  type CodexDeviceStart,
  type CodexPollResult,
} from "../lib/codexAuth";

type CodexAuthState = {
  status: CodexAuthStatus;
  pending: CodexDeviceStart | null;
  loading: boolean;
  error: string | null;
  refreshStatus: () => Promise<CodexAuthStatus>;
  startDeviceLogin: () => Promise<CodexDeviceStart>;
  pollDeviceLogin: () => Promise<CodexPollResult | null>;
  cancelDeviceLogin: () => Promise<void>;
  logout: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useCodexAuthStore = create<CodexAuthState>((set, get) => ({
  status: CODEX_DISCONNECTED_STATUS,
  pending: null,
  loading: false,
  error: null,

  refreshStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await getCodexAuthStatus();
      set({ status, loading: false });
      return status;
    } catch (error) {
      const message = errorMessage(error);
      const status = { ...CODEX_DISCONNECTED_STATUS, message };
      set({ status, loading: false, error: message });
      return status;
    }
  },

  startDeviceLogin: async () => {
    set({ loading: true, error: null });
    try {
      const pending = await startCodexDeviceLogin();
      set({ pending, loading: false });
      return pending;
    } catch (error) {
      const message = errorMessage(error);
      set({ loading: false, error: message });
      throw error;
    }
  },

  pollDeviceLogin: async () => {
    const pending = get().pending;
    if (!pending) return null;
    try {
      const result = await pollCodexDeviceLogin(pending.loginId);
      if (result.status === "complete" && result.auth) {
        set({ status: result.auth, pending: null, error: null });
      } else if (result.status === "expired" || result.status === "error") {
        set({
          pending: null,
          error: result.message ?? "Codex sign-in did not complete.",
        });
      }
      return result;
    } catch (error) {
      const message = errorMessage(error);
      set({ error: message });
      throw error;
    }
  },

  cancelDeviceLogin: async () => {
    const pending = get().pending;
    if (pending) await cancelCodexDeviceLogin(pending.loginId);
    set({ pending: null });
  },

  logout: async () => {
    set({ loading: true, error: null });
    try {
      await logoutCodex();
      set({
        status: CODEX_DISCONNECTED_STATUS,
        pending: null,
        loading: false,
      });
    } catch (error) {
      const message = errorMessage(error);
      set({ loading: false, error: message });
      throw error;
    }
  },
}));
