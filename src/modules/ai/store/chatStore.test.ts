import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, UIMessage } from "@ai-sdk/react";

const pluginStore = vi.hoisted(() => {
  const instances: {
    data: Map<string, unknown>;
  }[] = [];
  class LazyStore {
    data = new Map<string, unknown>();
    async get(key: string) {
      return this.data.get(key);
    }
    async set(key: string, value: unknown) {
      this.data.set(key, value);
    }
    async delete(key: string) {
      this.data.delete(key);
    }
    async entries() {
      return [...this.data.entries()];
    }
    constructor() {
      instances.push(this);
    }
  }
  return { instances, LazyStore };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: pluginStore.LazyStore,
}));

const todoStore = vi.hoisted(() => {
  const clearSession = vi.fn(async () => undefined);
  return {
    spies: { clearSession },
    useTodosStore: {
      getState: () => ({ clearSession }),
    },
  };
});

vi.mock("./todoStore", () => todoStore);

const modelPrefs = vi.hoisted(() => ({
  pushRecentModel: vi.fn(),
}));

vi.mock("../lib/modelPrefs", () => modelPrefs);

import {
  chats,
  flushPersist,
  getActiveProviderKey,
  getChat,
  hasKeyForModel,
  seedMessages,
  stop,
  touchChat,
  useChatStore,
} from "./chatStore";

function fakeChat() {
  return { stop: vi.fn() } as unknown as Chat<UIMessage>;
}

function userMsg(text: string): UIMessage {
  return { id: "m", role: "user", parts: [{ type: "text", text }] };
}

function clearTransient() {
  chats.clear();
  seedMessages.clear();
}

describe("chat LRU", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTransient();
    useChatStore.setState({ activeSessionId: null });
  });

  it("evicts the least recently used chat past the cap of eight", () => {
    const made = Array.from({ length: 9 }, (_, i) => {
      const id = `s${i}`;
      const c = fakeChat();
      touchChat(id, c);
      return [id, c] as const;
    });

    expect(chats.has("s0")).toBe(false);
    expect(chats.size).toBe(8);
    expect(made[8][1].stop).not.toHaveBeenCalled();
  });

  it("never evicts the active session and stops the evicted chat after flush", () => {
    useChatStore.setState({ activeSessionId: "keep" });
    const keep = fakeChat();
    touchChat("keep", keep);
    const pads = Array.from({ length: 8 }, (_, i) => {
      const c = fakeChat();
      touchChat(`pad${i}`, c);
      return c;
    });

    // keep was inserted first so it is the oldest key while still active.
    // Eviction must skip it and stop the next-oldest pad instead of breaking
    // out of the loop and letting the Map exceed the cap.
    expect(chats.has("keep")).toBe(true);
    expect(chats.size).toBe(8);
    expect(pads[0].stop).toHaveBeenCalledTimes(1);
    expect(pads[1].stop).not.toHaveBeenCalled();
  });

  it("touching an existing chat moves it to the newest slot without stopping it", () => {
    const a = fakeChat();
    touchChat("a", a);
    for (let i = 0; i < 7; i++) touchChat(`p${i}`, fakeChat());

    touchChat("a", a);
    touchChat("overflow", fakeChat());

    expect(chats.has("a")).toBe(true);
    expect(a.stop).not.toHaveBeenCalled();
  });
});

describe("session lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTransient();
    pluginStore.instances.forEach((i) => i.data.clear());
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      sessionsHydrated: false,
      agentMeta: useChatStore.getState().agentMeta,
    });
  });

  it("hydrateSessions reuses the leading New chat instead of stacking one", async () => {
    const store = pluginStore.instances[0];
    store.data.set("sessions", [
      { id: "old-1", title: "New chat", createdAt: 1, updatedAt: 2 },
    ]);

    await useChatStore.getState().hydrateSessions();
    await useChatStore.getState().hydrateSessions();

    expect(useChatStore.getState().activeSessionId).toBe("old-1");
    expect(useChatStore.getState().sessions.map((s) => s.id)).toEqual(["old-1"]);
    expect(useChatStore.getState().sessionsHydrated).toBe(true);
  });

  it("hydrateSessions prepends a fresh session when none is reusable", async () => {
    const store = pluginStore.instances[0];
    store.data.set("sessions", [
      { id: "old-1", title: "Real work", createdAt: 1, updatedAt: 2 },
    ]);

    await useChatStore.getState().hydrateSessions();

    const sessions = useChatStore.getState().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title).toBe("New chat");
    expect(useChatStore.getState().activeSessionId).toBe(sessions[0].id);
  });

  it("switchSession seeds persisted messages the first time only", async () => {
    const mod = await import("../lib/sessions");
    vi.spyOn(mod, "saveSessionsList").mockResolvedValue(undefined);
    vi.spyOn(mod, "saveActiveId").mockResolvedValue(undefined);
    vi.spyOn(mod, "loadMessages").mockResolvedValue([
      userMsg("restored"),
    ] as UIMessage[]);

    useChatStore.setState({
      sessions: [{ id: "s-1", title: "T", createdAt: 1, updatedAt: 2 }],
      activeSessionId: null,
      sessionsHydrated: true,
    });

    await Promise.resolve();
    useChatStore.getState().switchSession("s-1");
    await new Promise((r) => setTimeout(r, 0));

    expect([...seedMessages.keys()]).toEqual(["s-1"]);
    expect(seedMessages.get("s-1")?.[0]).toMatchObject({ id: "m" });

    seedMessages.clear();
    useChatStore.getState().switchSession("s-1");
    expect(seedMessages.size).toBe(0);
  });

  it("deleteSession recreates a fresh session when the last one goes", async () => {
    const mod = await import("../lib/sessions");
    vi.spyOn(mod, "newSessionId").mockReturnValue("fresh-id");

    useChatStore.setState({
      sessions: [{ id: "only", title: "T", createdAt: 1, updatedAt: 2 }],
      activeSessionId: "only",
      sessionsHydrated: true,
    });

    useChatStore.getState().deleteSession("only");

    expect(useChatStore.getState().sessions[0].id).toBe("fresh-id");
    expect(useChatStore.getState().activeSessionId).toBe("fresh-id");
  });

  it("deleteSession hands focus to the first remaining session when active", async () => {
    useChatStore.setState({
      sessions: [
        { id: "first", title: "A", createdAt: 1, updatedAt: 2 },
        { id: "second", title: "B", createdAt: 1, updatedAt: 2 },
      ],
      activeSessionId: "second",
      sessionsHydrated: true,
    });

    useChatStore.getState().deleteSession("second");

    expect(useChatStore.getState().activeSessionId).toBe("first");
    expect(todoStore.spies.clearSession).toHaveBeenCalled();
  });
});

describe("message persistence debounce and auto-title", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearTransient();
    useChatStore.setState({
      sessions: [{ id: "s-1", title: "New chat", createdAt: 1, updatedAt: 2 }],
      activeSessionId: "s-1",
      sessionsHydrated: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid persistMessages calls into one write of the latest", async () => {
    const mod = await import("../lib/sessions");
    const saveMessages = vi
      .spyOn(mod, "saveMessages")
      .mockResolvedValue(undefined);

    useChatStore.getState().persistMessages("s-1", [userMsg("v1")]);
    useChatStore.getState().persistMessages("s-1", [userMsg("v2")]);
    vi.advanceTimersByTime(400);
    flushPersist("s-1");

    expect(saveMessages).toHaveBeenCalledTimes(1);
    expect(saveMessages).toHaveBeenLastCalledWith("s-1", [userMsg("v2")]);
  });

  it("auto-titles an untitled session once, then never again", async () => {
    const mod = await import("../lib/sessions");
    const saveSessionsList = vi
      .spyOn(mod, "saveSessionsList")
      .mockResolvedValue(undefined);

    useChatStore.getState().persistMessages("s-1", [userMsg("name this chat")]);
    useChatStore.getState().persistMessages("s-1", [userMsg("more tokens")]);

    const titles = useChatStore
      .getState()
      .sessions.map((s) => s.title);
    expect(titles).toEqual(["name this chat"]);
    expect(saveSessionsList).toHaveBeenCalledTimes(1);
  });
});

describe("approval / prefill / selections plumbing", () => {
  beforeEach(() => {
    clearTransient();
    useChatStore.setState({
      approvalResponder: null,
      pendingPrefill: null,
      pendingSelections: [],
      panelOpen: false,
      focusSignal: 0,
    });
  });

  it("respondToApproval delegates to the registered responder", () => {
    const responder = vi.fn();
    useChatStore.getState().setApprovalResponder(responder);

    useChatStore.getState().respondToApproval("ap-1", true);

    expect(responder).toHaveBeenCalledWith("ap-1", true);
  });

  it("respondToApproval is a no-op without a responder", () => {
    expect(() =>
      useChatStore.getState().respondToApproval("ap-1", false),
    ).not.toThrow();
  });

  it("focusInput bumps the signal, opens the panel, stores prefill once", () => {
    useChatStore.getState().focusInput("hello");
    const s = useChatStore.getState();
    expect(s.panelOpen).toBe(true);
    expect(s.focusSignal).toBe(1);
    expect(useChatStore.getState().consumePrefill()).toBe("hello");
    expect(useChatStore.getState().pendingPrefill).toBeNull();
    expect(s.consumePrefill()).toBeNull();
  });

  it("attachSelection trims, ignores blanks, and consume drains all", () => {
    useChatStore.getState().attachSelection("  code here  ", "editor");
    useChatStore.getState().attachSelection("   ", "terminal");

    const drained = useChatStore.getState().consumeSelections();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ text: "code here", source: "editor" });
    expect(useChatStore.getState().consumeSelections()).toEqual([]);
    expect(useChatStore.getState().panelOpen).toBe(true);
  });
});

describe("agent meta and key resolution", () => {
  beforeEach(() => {
    clearTransient();
    useChatStore.setState({
      agentMeta: useChatStore.getState().agentMeta,
      apiKeys: { ...useChatStore.getState().apiKeys, openai: "sk-x" },
      customEndpointKeys: {},
      selectedModelId: "gpt-5.4-mini",
    });
  });

  it("patchAgentMeta merges and resetAgentMeta restores idle zero usage", () => {
    useChatStore.getState().patchAgentMeta({
      status: "streaming",
      step: "read_file",
      tokens: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 2,
      },
    });
    expect(useChatStore.getState().agentMeta.status).toBe("streaming");

    useChatStore.getState().resetAgentMeta();
    const meta = useChatStore.getState().agentMeta;
    expect(meta.status).toBe("idle");
    expect(meta.tokens.inputTokens).toBe(0);
  });

  it("getActiveProviderKey reads the provider key for static models", () => {
    expect(getActiveProviderKey()).toBe("sk-x");
    useChatStore.setState({ selectedModelId: "claude-sonnet-5" });
    expect(getActiveProviderKey()).toBeNull();
  });

  it("getActiveProviderKey prefers endpoint keys for compat models", () => {
    useChatStore.setState({
      selectedModelId: "compat-ab12cd34",
      customEndpointKeys: { ab12cd34: "endpoint-key" },
    });
    expect(getActiveProviderKey()).toBe("endpoint-key");
  });

  it("hasKeyForModel is true for compat ids and keyless providers", () => {
    expect(hasKeyForModel("compat-whatever")).toBe(true);
    expect(hasKeyForModel("lmstudio-local")).toBe(true);
    expect(hasKeyForModel("gpt-5.4-mini")).toBe(true);
    expect(hasKeyForModel("claude-sonnet-5")).toBe(false);
  });

  it("getChat resolves by id or falls back to the active session; stop stops it", () => {
    const c = fakeChat();
    chats.set("s-9", c);
    useChatStore.setState({ activeSessionId: "s-9" });

    expect(getChat("s-9")).toBe(c);
    expect(getChat()).toBe(c);

    stop();
    expect(c.stop).toHaveBeenCalledTimes(1);
  });
});
