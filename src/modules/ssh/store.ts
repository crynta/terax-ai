import { create } from "zustand";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { sshProfileList, sshProfileSave, sshProfileDelete, sshConnect, sshDisconnect } from "./commands";
import { getLastSshProfileId, setLastSshProfileId } from "@/modules/settings/store";
import type { SshProfile } from "./types";

const SSH_PROFILES_CHANGED_EVENT = "terax://ssh-profiles-changed";
let loadProfilesRequestSeq = 0;
let inFlightLoadProfiles: Promise<void> | null = null;
let queuedLoadProfiles = false;

type ConnState = "disconnected" | "connecting" | "connected" | "error";

type State = {
  profiles: SshProfile[];
  profilesLoaded: boolean;
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
  profilesLoaded: false,
  connState: {},

  loadProfiles: async () => {
    if (inFlightLoadProfiles) {
      queuedLoadProfiles = true;
      await inFlightLoadProfiles;
      return;
    }

    do {
      queuedLoadProfiles = false;
      const requestSeq = ++loadProfilesRequestSeq;
      const request = (async () => {
        try {
          const profiles = await sshProfileList();
          if (requestSeq !== loadProfilesRequestSeq) return;
          set({ profiles, profilesLoaded: true });
        } catch (e) {
          if (requestSeq !== loadProfilesRequestSeq) return;
          // Non-fatal — store stays at last known state
          console.warn("ssh: failed to load profiles", e);
        }
      })();

      inFlightLoadProfiles = request;
      try {
        await request;
      } finally {
        if (inFlightLoadProfiles === request) {
          inFlightLoadProfiles = null;
        }
      }
    } while (queuedLoadProfiles);
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
    void emitSshProfilesChanged();
    return saved;
  },

  deleteProfile: async (id) => {
    await sshDisconnect(id).catch(() => {});
    await sshProfileDelete(id);
    set((s) => ({
      profiles: s.profiles.filter((p) => p.id !== id),
      connState: { ...s.connState, [id]: "disconnected" },
    }));
    const currentLastSshProfileId = await getLastSshProfileId();
    if (currentLastSshProfileId === id) {
      void setLastSshProfileId(null);
    }
    void emitSshProfilesChanged();
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

export async function emitSshProfilesChanged(): Promise<void> {
  await emit(SSH_PROFILES_CHANGED_EVENT);
}

export function onSshProfilesChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(SSH_PROFILES_CHANGED_EVENT, () => cb());
}
