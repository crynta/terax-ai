import { Chat, type UIMessage } from "@ai-sdk/react";
import type { ChatTransport } from "ai";
import { create } from "zustand";
import { createTeraxAgent, createTeraxTransport } from "./agent";
import type { ToolContext } from "./tools";

type Live = {
  getCwd: () => string | null;
  getTerminalContext: () => string | null;
};

type StoreState = {
  live: Live;
  setLive: (live: Live) => void;
  apiKey: string | null;
  setApiKey: (key: string | null) => void;
  chats: Map<number, Chat<UIMessage>>;
  drop: (tabId: number) => void;
  resetAll: () => void;
};

export const useChatStore = create<StoreState>((set, get) => ({
  live: { getCwd: () => null, getTerminalContext: () => null },
  apiKey: null,
  chats: new Map(),
  setLive: (live) => set({ live }),
  setApiKey: (key) => {
    if (get().apiKey !== key) {
      set({ apiKey: key, chats: new Map() });
    }
  },
  drop: (tabId) => {
    const next = new Map(get().chats);
    next.delete(tabId);
    set({ chats: next });
  },
  resetAll: () => set({ chats: new Map() }),
}));

export function getOrCreateChat(
  tabId: number,
  apiKey: string,
): Chat<UIMessage> {
  const existing = useChatStore.getState().chats.get(tabId);
  if (existing) return existing;

  // Tools read live getters at call-time so tab-switching is automatic.
  const toolContext: ToolContext = {
    getCwd: () => useChatStore.getState().live.getCwd(),
    getTerminalContext: () => useChatStore.getState().live.getTerminalContext(),
  };

  const agent = createTeraxAgent({ apiKey, toolContext });
  const transport = createTeraxTransport(
    agent,
  ) as unknown as ChatTransport<UIMessage>;

  const chat = new Chat<UIMessage>({ id: `tab-${tabId}`, transport });

  const next = new Map(useChatStore.getState().chats);
  next.set(tabId, chat);
  useChatStore.setState({ chats: next });
  return chat;
}

/**
 * Dispatch a user message to a tab's chat. Returns true if sent;
 * returns false when no API key is configured (caller should show the
 * key dialog).
 */
export async function sendToTab(tabId: number, text: string): Promise<boolean> {
  const apiKey = useChatStore.getState().apiKey;
  if (!apiKey) return false;
  const chat = getOrCreateChat(tabId, apiKey);
  await chat.sendMessage({ text });
  return true;
}

/** Stop streaming for a given tab (no-op if no chat yet). */
export function stopTab(tabId: number): void {
  const chat = useChatStore.getState().chats.get(tabId);
  void chat?.stop();
}
