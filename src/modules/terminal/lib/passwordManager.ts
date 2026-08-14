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
    secret: draft.secret === undefined ? null : draft.secret.trim(),
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

export const useTerminalPasswordStore = create<StoreState>((set, get) => ({
  hydrated: false,
  entries: [],
  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    set({ entries: await loadEntries(), hydrated: true });
    void listen(CHANGED_EVENT, async () => {
      set({ entries: await loadEntries() });
    });
  },
  upsert: async (draft) => {
    const normalized = normalizeDraft(draft);
    requireLabel(normalized.label);
    const list = get().entries;
    const existing = list.find((entry) => entry.id === normalized.id);
    if (!existing && !normalized.secret) {
      throw new Error("Password is required for new entries.");
    }
    if (normalized.secret) {
      await invoke("secrets_set", {
        service: KEYRING_SERVICE,
        account: secretAccount(normalized.id),
        password: normalized.secret,
      });
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
    const idx = list.findIndex((entry) => entry.id === normalized.id);
    const next =
      idx === -1
        ? [...list, nextEntry]
        : list.map((entry) => (entry.id === normalized.id ? nextEntry : entry));
    const sorted = [...next].sort((a, b) => a.label.localeCompare(b.label));
    set({ entries: sorted });
    await saveEntries(sorted);
    await emitChanged();
  },
  remove: async (id) => {
    const clean = toText(id);
    if (!clean) return;
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: secretAccount(clean),
    });
    const next = get().entries.filter((entry) => entry.id !== clean);
    set({ entries: next });
    await saveEntries(next);
    await emitChanged();
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
