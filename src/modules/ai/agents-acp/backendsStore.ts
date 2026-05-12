/**
 * Zustand store for the External Agents detection list.
 *
 * Hydrated once at startup from the Rust `agent_backends_list` command, then
 * re-fetched on demand (e.g. after the user installs a CLI without restarting
 * the app). The Settings UI reads from this store; the ACP transport reads it
 * to confirm a backend is installed before trying to spawn.
 */

import { create } from "zustand";

import { listBackends } from "./client";
import type { BackendStatus } from "./types";

type BackendsState = {
  backends: BackendStatus[];
  hydrated: boolean;
  hydrating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export const useBackendsStore = create<BackendsState>((set, get) => ({
  backends: [],
  hydrated: false,
  hydrating: false,
  error: null,
  refresh: async () => {
    if (get().hydrating) return;
    set({ hydrating: true, error: null });
    try {
      const backends = await listBackends();
      set({ backends, hydrated: true, hydrating: false });
    } catch (e) {
      set({
        hydrating: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
}));

export function getBackend(id: string): BackendStatus | undefined {
  return useBackendsStore.getState().backends.find((b) => b.id === id);
}
