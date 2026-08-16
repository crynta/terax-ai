import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";

const STORE_PATH = "terax-terminal-passwords.json";
const KEY_ENTRIES = "entries";
const KEYRING_SERVICE = "terax-terminal-passwords";
const CHANGED_EVENT = "terax://terminal-passwords-changed";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type TerminalPasswordEntry = {
  id: string;
  label: string;
  username: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type TerminalPasswordDraft = {
  id?: string;
  label: string;
  username?: string;
  notes?: string;
  secret?: string;
};

type StoreState = {
  hydrated: boolean;
  entries: TerminalPasswordEntry[];
  hydrate: () => Promise<void>;
  upsert: (draft: TerminalPasswordDraft) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reveal: (id: string) => Promise<string | null>;
};

let initialized = false;
let listenerAttached = false;
let mutationQueue: Promise<void> = Promise.resolve();

function secretAccount(id: string): string {
  return `entry:${id}`;
}

function toText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function newTerminalPasswordId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeTerminalPasswordEntries(raw: unknown): TerminalPasswordEntry[] {
  if (!Array.isArray(raw)) return [];
  const next: TerminalPasswordEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = toText((item as { id?: unknown }).id);
    const label = toText((item as { label?: unknown }).label);
    if (!id || !label) continue;
    const username = toText((item as { username?: unknown }).username);
    const notes = toText((item as { notes?: unknown }).notes);
    const createdAt = Number((item as { createdAt?: unknown }).createdAt);
    const updatedAt = Number((item as { updatedAt?: unknown }).updatedAt);
    const now = Date.now();
    next.push({
      id,
      label,
      username,
      notes,
      createdAt: Number.isFinite(createdAt) ? createdAt : now,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now,
    });
  }
  return next.sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeDraft(draft: TerminalPasswordDraft): {
  id: string;
  label: string;
  username: string;
  notes: string;
  secret: string | null;
} {
  return {
    id: toText(draft.id) || newTerminalPasswordId(),
    label: toText(draft.label),
    username: toText(draft.username),
    notes: toText(draft.notes),
    secret: draft.secret === undefined ? null : draft.secret,
  };
}

function requireLabel(label: string): void {
  if (!label) throw new Error("Label is required.");
}

async function loadEntries(): Promise<TerminalPasswordEntry[]> {
  const raw = await store.get(KEY_ENTRIES);
  return sanitizeTerminalPasswordEntries(raw);
}

async function saveEntries(entries: TerminalPasswordEntry[]): Promise<void> {
  await store.set(KEY_ENTRIES, entries);
  await store.save();
}

async function emitChanged(): Promise<void> {
  await emit(CHANGED_EVENT);
}

function mergeEntry(
  list: TerminalPasswordEntry[],
  nextEntry: TerminalPasswordEntry,
): TerminalPasswordEntry[] {
  const idx = list.findIndex((entry) => entry.id === nextEntry.id);
  const next =
    idx === -1
      ? [...list, nextEntry]
      : list.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry));
  return [...next].sort((a, b) => a.label.localeCompare(b.label));
}

async function withMutationLock<T>(run: () => Promise<T>): Promise<T> {
  if (
    typeof navigator !== "undefined" &&
    "locks" in navigator &&
    navigator.locks
  ) {
    return navigator.locks.request(
      "terax-terminal-passwords-mutation",
      { mode: "exclusive" },
      run,
    );
  }
  const task = mutationQueue.then(run, run);
  mutationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export const useTerminalPasswordStore = create<StoreState>((set) => ({
  hydrated: false,
  entries: [],
  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    try {
      const entries = await loadEntries();
      set({ entries, hydrated: true });
      if (!listenerAttached) {
        listenerAttached = true;
        void listen(CHANGED_EVENT, async () => {
          set({ entries: await loadEntries() });
        });
      }
    } catch (error) {
      initialized = false;
      throw error;
    }
  },
  upsert: async (draft) => {
    const normalized = normalizeDraft(draft);
    requireLabel(normalized.label);
    if (normalized.secret !== null && normalized.secret.length === 0) {
      throw new Error("Password is required for new entries.");
    }

    await withMutationLock(async () => {
      const list = await loadEntries();
      const existing = list.find((entry) => entry.id === normalized.id);
      if (!existing && normalized.secret === null) {
        throw new Error("Password is required for new entries.");
      }

      const account = secretAccount(normalized.id);
      let rollbackSecret: (() => Promise<void>) | null = null;
      if (normalized.secret !== null) {
        const previousSecret = existing
          ? await invoke<string | null>("secrets_get", {
              service: KEYRING_SERVICE,
              account,
            })
          : null;
        await invoke("secrets_set", {
          service: KEYRING_SERVICE,
          account,
          password: normalized.secret,
        });
        rollbackSecret = async () => {
          if (previousSecret === null) {
            await invoke("secrets_delete", {
              service: KEYRING_SERVICE,
              account,
            });
            return;
          }
          await invoke("secrets_set", {
            service: KEYRING_SERVICE,
            account,
            password: previousSecret,
          });
        };
      }

      const now = Date.now();
      const nextEntry: TerminalPasswordEntry = {
        id: normalized.id,
        label: normalized.label,
        username: normalized.username,
        notes: normalized.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const sorted = mergeEntry(list, nextEntry);

      try {
        await saveEntries(sorted);
      } catch (error) {
        if (rollbackSecret) {
          await rollbackSecret();
        }
        throw error;
      }

      set({ entries: sorted });
      await emitChanged();
    });
  },
  remove: async (id) => {
    const clean = toText(id);
    if (!clean) return;

    await withMutationLock(async () => {
      const list = await loadEntries();
      const existing = list.find((entry) => entry.id === clean);
      if (!existing) {
        set({ entries: list });
        return;
      }

      const account = secretAccount(clean);
      const previousSecret = await invoke<string | null>("secrets_get", {
        service: KEYRING_SERVICE,
        account,
      });

      await invoke("secrets_delete", {
        service: KEYRING_SERVICE,
        account,
      });

      const next = list.filter((entry) => entry.id !== clean);
      try {
        await saveEntries(next);
      } catch (error) {
        if (previousSecret !== null) {
          await invoke("secrets_set", {
            service: KEYRING_SERVICE,
            account,
            password: previousSecret,
          });
        }
        throw error;
      }

      set({ entries: next });
      await emitChanged();
    });
  },
  reveal: async (id) => {
    const clean = toText(id);
    if (!clean) return null;
    return invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: secretAccount(clean),
    });
  },
}));
