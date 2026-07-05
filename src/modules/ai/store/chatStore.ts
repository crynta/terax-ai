import type { Chat, UIMessage } from "@ai-sdk/react";
import { create } from "zustand";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getModel,
  isCompatModelId,
  providerNeedsKey,
  type ModelId,
  type ProviderId,
} from "../config";
import { useTodosStore } from "./todoStore";
import type { AgentUsage } from "../lib/agent";
import { EMPTY_PROVIDER_KEYS, type ProviderKeys, type CustomEndpointKeys } from "../lib/keyring";
import {
  deleteSessionData,
  deriveTitle,
  loadAll,
  loadMessages,
  newSessionId,
  saveActiveId,
  saveMessages,
  saveSessionsList,
  type SessionMeta,
} from "../lib/sessions";
import { pushRecentModel } from "../lib/modelPrefs";

export type Live = {
  getCwd: () => string | null;
  getTerminalContext: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  injectIntoActivePty: (text: string) => boolean;
  getWorkspaceRoot: () => string | null;
  getActiveFile: () => string | null;
  openPreview: (url: string) => boolean;
  spawnManagedAgent: (
    prompt: string,
    sessionId: string,
  ) => { tabId: number; leafId: number } | null;
  readLeafBuffer: (leafId: number) => string | null;
};

export type AgentRunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "awaiting-approval"
  | "error";

export type AgentMeta = {
  status: AgentRunStatus;
  step: string | null;
  approvalsPending: number;
  error: string | null;
  tokens: AgentUsage;
  lastInputTokens: number;
  lastCachedTokens: number;
  hitStepCap: boolean;
  compactionNotice: { droppedCount: number; at: number } | null;
};

const ZERO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

const IDLE_META: AgentMeta = {
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  tokens: ZERO_USAGE,
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  compactionNotice: null,
};

export type MiniState = {
  open: boolean;
};

export type PendingSelection = {
  id: string;
  text: string;
  source: "terminal" | "editor";
};

export type ApprovalResponder = (
  approvalId: string,
  approved: boolean,
) => void;

type StoreState = {
  live: Live;
  setLive: (live: Live) => void;

  /**
   * Set by AgentRunBridge each render. Lets surfaces outside the chat hook
   * tree (e.g. the AI diff tab in the editor area) resolve a pending tool
   * approval through the active session's `addToolApprovalResponse`.
   */
  approvalResponder: ApprovalResponder | null;
  setApprovalResponder: (fn: ApprovalResponder | null) => void;
  respondToApproval: (approvalId: string, approved: boolean) => void;

  apiKeys: ProviderKeys;
  setApiKeys: (keys: ProviderKeys) => void;
  setApiKey: (provider: ProviderId, key: string | null) => void;

  customEndpointKeys: CustomEndpointKeys;
  setCustomEndpointKeys: (keys: CustomEndpointKeys) => void;

  selectedModelId: string;
  setSelectedModelId: (id: string) => void;

  mini: MiniState;
  openMini: () => void;
  closeMini: () => void;
  toggleMini: () => void;

  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  focusSignal: number;
  pendingPrefill: string | null;
  focusInput: (prefill?: string | null) => void;
  consumePrefill: () => string | null;

  pendingSelections: PendingSelection[];
  attachSelection: (text: string, source: "terminal" | "editor") => void;
  consumeSelections: () => PendingSelection[];

  agentMeta: AgentMeta;
  patchAgentMeta: (patch: Partial<AgentMeta>) => void;
  resetAgentMeta: () => void;

  // Sessions
  sessionsHydrated: boolean;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  hydrateSessions: () => Promise<void>;
  newSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Persist messages of a session and bump its updatedAt + auto-title. */
  persistMessages: (id: string, messages: UIMessage[]) => void;
};

const NOOP_LIVE: Live = {
  getCwd: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  getWorkspaceRoot: () => null,
  getActiveFile: () => null,
  openPreview: () => false,
  spawnManagedAgent: () => null,
  readLeafBuffer: () => null,
};

const CHATS_LRU_CAP = 8;
export const chats = new Map<string, Chat<UIMessage>>();

export function touchChat(id: string, c: Chat<UIMessage>) {
  if (chats.has(id)) chats.delete(id);
  chats.set(id, c);
  while (chats.size > CHATS_LRU_CAP) {
    const oldest = chats.keys().next().value;
    if (!oldest || oldest === id) break;
    if (useChatStore.getState().activeSessionId === oldest) break;
    flushPersistEntry(oldest);
    void chats.get(oldest)?.stop();
    chats.delete(oldest);
  }
}
// Initial messages for a session, populated at hydration time and consumed
// when the matching Chat is constructed.
export const seedMessages = new Map<string, UIMessage[]>();

// Trailing debounce for per-token message persistence. Streaming fires
// `persistMessages` on every token; without this we'd JSON-serialize the
// full message array and round-trip to the store plugin per token, which
// stalls the UI. Flush on idle (status transition) via `flushPersist`.
const PERSIST_DEBOUNCE_MS = 300;
const pendingPersist = new Map<
  string,
  { latest: UIMessage[]; timer: ReturnType<typeof setTimeout> }
>();

function flushPersistEntry(id: string) {
  const entry = pendingPersist.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingPersist.delete(id);
  void saveMessages(id, entry.latest);
}

export function flushPersist(id?: string): void {
  if (id) {
    flushPersistEntry(id);
    return;
  }
  for (const key of Array.from(pendingPersist.keys())) flushPersistEntry(key);
}

export const useChatStore = create<StoreState>((set, get) => ({
  live: NOOP_LIVE,
  setLive: (live) => set({ live }),

  approvalResponder: null,
  setApprovalResponder: (fn) => set({ approvalResponder: fn }),
  respondToApproval: (approvalId, approved) => {
    const fn = get().approvalResponder;
    if (fn) fn(approvalId, approved);
  },

  apiKeys: { ...EMPTY_PROVIDER_KEYS },
  setApiKeys: (keys) => set({ apiKeys: keys }),
  setApiKey: (provider, key) => {
    set({ apiKeys: { ...get().apiKeys, [provider]: key } });
  },

  customEndpointKeys: {},
  setCustomEndpointKeys: (keys) => set({ customEndpointKeys: keys }),

  selectedModelId: DEFAULT_MODEL_ID,
  setSelectedModelId: (id) => {
    set({ selectedModelId: id });
    void pushRecentModel(id);
  },

  mini: { open: false },
  openMini: () => set({ mini: { open: true } }),
  closeMini: () => set({ mini: { open: false } }),
  toggleMini: () => set((s) => ({ mini: { open: !s.mini.open } })),

  panelOpen: false,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  focusSignal: 0,
  pendingPrefill: null,
  focusInput: (prefill = null) =>
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingPrefill: prefill ?? null,
    })),
  consumePrefill: () => {
    const v = get().pendingPrefill;
    if (v != null) set({ pendingPrefill: null });
    return v;
  },

  pendingSelections: [],
  attachSelection: (text, source) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingSelections: [...s.pendingSelections, { id, text: trimmed, source }],
    }));
  },
  consumeSelections: () => {
    const v = get().pendingSelections;
    if (v.length > 0) set({ pendingSelections: [] });
    return v;
  },

  agentMeta: IDLE_META,
  patchAgentMeta: (patch) =>
    set((s) => ({ agentMeta: { ...s.agentMeta, ...patch } })),
  resetAgentMeta: () => set({ agentMeta: IDLE_META }),

  sessionsHydrated: false,
  sessions: [],
  activeSessionId: null,

  hydrateSessions: async () => {
    if (get().sessionsHydrated) return;
    const { sessions } = await loadAll();

    // Reuse the most recent untitled "New chat" session if one exists from
    // the previous run — no point stacking empty placeholder sessions every
    // launch. Otherwise prepend a fresh one.
    const reusable = sessions[0]?.title === "New chat" ? sessions[0] : null;
    let nextSessions: SessionMeta[];
    let freshId: string;
    if (reusable) {
      nextSessions = sessions;
      freshId = reusable.id;
    } else {
      freshId = newSessionId();
      const fresh: SessionMeta = {
        id: freshId,
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      nextSessions = [fresh, ...sessions];
      void saveSessionsList(nextSessions);
    }
    void saveActiveId(freshId);

    set({
      sessions: nextSessions,
      activeSessionId: freshId,
      sessionsHydrated: true,
    });
  },

  newSession: () => {
    const id = newSessionId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [meta, ...get().sessions];
    set({ sessions: next, activeSessionId: id, agentMeta: IDLE_META });
    void saveSessionsList(next);
    void saveActiveId(id);
    return id;
  },

  switchSession: (id) => {
    if (get().activeSessionId === id) return;
    if (!get().sessions.some((s) => s.id === id)) return;

    // Lazily seed the chat with persisted messages the first time we open
    // this session. Subsequent switches reuse the cached Chat instance.
    const flip = () => {
      set({ activeSessionId: id, agentMeta: IDLE_META });
      void saveActiveId(id);
    };
    if (chats.has(id) || seedMessages.has(id)) {
      flip();
      return;
    }
    void loadMessages(id).then((m) => {
      if (m && m.length > 0 && !chats.has(id)) seedMessages.set(id, m);
      flip();
    });
  },

  deleteSession: (id) => {
    const remaining = get().sessions.filter((s) => s.id !== id);
    chats.get(id)?.stop();
    chats.delete(id);
    seedMessages.delete(id);
    const pend = pendingPersist.get(id);
    if (pend) {
      clearTimeout(pend.timer);
      pendingPersist.delete(id);
    }
    void deleteSessionData(id);
    void useTodosStore.getState().clearSession(id);

    if (remaining.length === 0) {
      const fresh: SessionMeta = {
        id: newSessionId(),
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set({ sessions: [fresh], activeSessionId: fresh.id });
      void saveSessionsList([fresh]);
      void saveActiveId(fresh.id);
      return;
    }

    const wasActive = get().activeSessionId === id;
    const nextActive = wasActive ? remaining[0].id : get().activeSessionId;
    set({ sessions: remaining, activeSessionId: nextActive });
    void saveSessionsList(remaining);
    if (wasActive) void saveActiveId(nextActive);
  },

  renameSession: (id, title) => {
    const next = get().sessions.map((s) =>
      s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },

  persistMessages: (id, messages) => {
    // Debounce the message-blob write so streaming doesn't pound the store.
    const existing = pendingPersist.get(id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const entry = pendingPersist.get(id);
      if (!entry) return;
      pendingPersist.delete(id);
      void saveMessages(id, entry.latest);
    }, PERSIST_DEBOUNCE_MS);
    pendingPersist.set(id, { latest: messages, timer });

    // Update zustand session list only when the derived title actually
    // changes — otherwise we'd rewrite the sessions array (and trigger
    // re-renders + a store write) on every token.
    const sessions = get().sessions;
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const isUntitled = !meta.title || meta.title === "New chat";
    if (!isUntitled) return;
    const nextTitle = deriveTitle(messages);
    if (nextTitle === meta.title) return;
    const next = sessions.map((s) =>
      s.id === id ? { ...s, title: nextTitle, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },
}));

export function getAgentMeta(): AgentMeta {
  return useChatStore.getState().agentMeta;
}

export function getActiveProviderKey(): string | null {
  const { selectedModelId, apiKeys, customEndpointKeys } = useChatStore.getState();
  if (isCompatModelId(selectedModelId)) {
    const eid = endpointIdFromCompatModel(selectedModelId);
    return customEndpointKeys[eid] ?? null;
  }
  return apiKeys[getModel(selectedModelId as ModelId).provider] ?? null;
}

export function hasKeyForModel(modelId: string): boolean {
  const { apiKeys } = useChatStore.getState();
  if (isCompatModelId(modelId)) {
    return true;
  }
  const provider = getModel(modelId as ModelId).provider;
  return providerNeedsKey(provider) ? !!apiKeys[provider] : true;
}

export function getChat(sessionId?: string): Chat<UIMessage> | undefined {
  if (sessionId) return chats.get(sessionId);
  const id = useChatStore.getState().activeSessionId;
  return id ? chats.get(id) : undefined;
}

export function stop(): void {
  const id = useChatStore.getState().activeSessionId;
  if (!id) return;
  void chats.get(id)?.stop();
}
