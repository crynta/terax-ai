import { create } from "zustand";
import { sshProfileList, sshProfileSave, sshProfileDelete, sshConnect, sshDisconnect } from "./commands";
import type { SshProfile } from "./types";

type ConnState = "disconnected" | "connecting" | "connected" | "error";

type State = {
  profiles: SshProfile[];
  connState: Record<string, ConnState>;
  loadProfiles: () => Promise<void>;
  saveProfile: (profile: Omit<SshProfile, "id"> & { id?: string }) => Promise<SshProfile>;
  deleteProfile: (id: string) => Promise<void>;
  connect: (profileId: string) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  setConnState: (profileId: string, state: ConnState) => void;
};

export const useSshStore = create<State>((set) => ({
  profiles: [],
  connState: {},

  loadProfiles: async () => {
    try {
      const profiles = await sshProfileList();
      set({ profiles });
    } catch (e) {
      // Non-fatal — store stays at last known state
      console.warn("ssh: failed to load profiles", e);
    }
  },

  saveProfile: async (profile) => {
    const toSave: SshProfile = { ...profile, id: profile.id ?? crypto.randomUUID() };
    const saved = await sshProfileSave(toSave);
    set((s) => {
      const exists = s.profiles.some((p) => p.id === saved.id);
      return {
        profiles: exists
          ? s.profiles.map((p) => (p.id === saved.id ? saved : p))
          : [...s.profiles, saved],
      };
    });
    return saved;
  },

  deleteProfile: async (id) => {
    await sshProfileDelete(id);
    set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) }));
  },

  connect: async (profileId) => {
    set((s) => ({ connState: { ...s.connState, [profileId]: "connecting" } }));
    try {
      await sshConnect(profileId);
      set((s) => ({ connState: { ...s.connState, [profileId]: "connected" } }));
    } catch (e) {
      set((s) => ({ connState: { ...s.connState, [profileId]: "error" } }));
      throw e;
    }
  },

  disconnect: async (profileId) => {
    await sshDisconnect(profileId);
    set((s) => ({ connState: { ...s.connState, [profileId]: "disconnected" } }));
  },

  setConnState: (profileId, state) =>
    set((s) => ({ connState: { ...s.connState, [profileId]: state } })),
}));
