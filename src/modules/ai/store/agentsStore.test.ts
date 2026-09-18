import { beforeEach, describe, expect, it, vi } from "vitest";
const agents = vi.hoisted(() => {
  const state = {
    stored: { custom: [] as Agent[], activeId: "builtin-coder" },
  };
  return {
    state,
    loadAgents: vi.fn(async () => state.stored),
    saveCustomAgents: vi.fn(async () => undefined),
    saveActiveAgentId: vi.fn(async () => undefined),
    BUILTIN_AGENTS: [
      { id: "builtin-coder", name: "Coder", builtIn: true },
      { id: "builtin-reviewer", name: "Reviewer", builtIn: true },
    ],
  };
});

vi.mock("../lib/agents", () => ({
  get BUILTIN_AGENTS() {
    return agents.BUILTIN_AGENTS;
  },
  get loadAgents() {
    return agents.loadAgents;
  },
  get saveCustomAgents() {
    return agents.saveCustomAgents;
  },
  get saveActiveAgentId() {
    return agents.saveActiveAgentId;
  },
}));

const events = vi.hoisted(() => {
  const listeners: (() => void)[] = [];
  return {
    listeners,
    listen: vi.fn(async (_e: string, h: () => void) => {
      listeners.push(h);
    }),
    emit: vi.fn(async () => undefined),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: events.listen,
  emit: events.emit,
}));

import type { Agent } from "../lib/agents";
function customAgent(id: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    instructions: "",
    builtIn: false,
  } as Agent;
}

async function loadModule() {
  vi.resetModules();
  events.listeners.length = 0;
  events.listen.mockClear();
  events.emit.mockClear();
  agents.saveCustomAgents.mockClear();
  agents.saveActiveAgentId.mockClear();
  return await import("./agentsStore");
}

describe("custom agent store", () => {
  beforeEach(() => {
    agents.state.stored = { custom: [], activeId: "builtin-coder" };
  });

  it("hydrates builtin-first list once and subscribes to changes", async () => {
    agents.state.stored = {
      custom: [customAgent("x")],
      activeId: "x",
    };
    const mod = await loadModule();

    await mod.useAgentsStore.getState().hydrate();
    await mod.useAgentsStore.getState().hydrate();

    expect(mod.useAgentsStore.getState().activeId).toBe("x");
    expect(mod.useAgentsStore.getState().all().map((a) => a.id)).toEqual([
      "builtin-coder",
      "builtin-reviewer",
      "x",
    ]);
    expect(agents.loadAgents).toHaveBeenCalledTimes(1);
    expect(events.listen).toHaveBeenCalledTimes(1);
  });

  it("reloads from disk when the change event fires", async () => {
    const mod = await loadModule();
    await mod.useAgentsStore.getState().hydrate();

    agents.state.stored = {
      custom: [customAgent("from-other-window")],
      activeId: "builtin-coder",
    };
    events.listeners[0]?.();

    await Promise.resolve();
    await Promise.resolve();
    expect(mod.useAgentsStore.getState().customAgents).toHaveLength(1);
  });

  it("upsert refuses to modify builtin agents", async () => {
    const mod = await loadModule();
    const store = mod.useAgentsStore;

    store.getState().upsert({
      id: "builtin-coder",
      name: "Hacked",
      instructions: "",
      builtIn: true,
    } as Agent);

    expect(store.getState().customAgents).toEqual([]);
  });

  it("remove falls back to the first builtin when the active agent is removed", async () => {
    const mod = await loadModule();
    const store = mod.useAgentsStore;
    store.setState({ hydrated: true });
    store.getState().upsert(customAgent("a"));
    store.getState().setActiveId("a");
    await vi.waitFor(() =>
      expect(agents.saveActiveAgentId).toHaveBeenCalledWith("a"),
    );

    store.getState().remove("a");

    expect(store.getState().activeId).toBe("builtin-coder");
    expect(store.getState().customAgents).toEqual([]);
    await vi.waitFor(() =>
      expect(agents.saveActiveAgentId).toHaveBeenLastCalledWith("builtin-coder"),
    );
  });

  it("removing a non-active custom agent keeps the active selection", async () => {
    const mod = await loadModule();
    const store = mod.useAgentsStore;
    store.getState().upsert(customAgent("a"));
    store.getState().upsert(customAgent("b"));
    store.getState().setActiveId("b");

    store.getState().remove("a");

    expect(store.getState().activeId).toBe("b");
  });
});
