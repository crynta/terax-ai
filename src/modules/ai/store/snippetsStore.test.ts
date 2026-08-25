import { beforeEach, describe, expect, it, vi } from "vitest";

const snippets = vi.hoisted(() => {
  const state = { stored: [] as unknown[] };
  return {
    state,
    loadSnippets: vi.fn(async () => state.stored),
    saveSnippets: vi.fn(async () => undefined),
    newSnippetId: vi.fn(() => "sn-fixed"),
  };
});

vi.mock("../lib/snippets", () => ({
  get loadSnippets() {
    return snippets.loadSnippets;
  },
  get saveSnippets() {
    return snippets.saveSnippets;
  },
  newSnippetId: snippets.newSnippetId,
}));

const events = vi.hoisted(() => {
  const listeners: ((payload?: unknown) => void)[] = [];
  const listen = vi.fn(async (_event: string, handler: () => void) => {
    listeners.push(handler);
  });
  const emit = vi.fn(async () => undefined);
  return { listeners, listen, emit };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: events.listen,
  emit: events.emit,
}));

import type { Snippet } from "../lib/snippets";

function snippet(id: string, name = id): Snippet {
  return {
    id,
    handle: id,
    name,
    description: `desc ${id}`,
    content: `content of ${id}`,
  };
}

async function loadModule() {
  vi.resetModules();
  events.listeners.length = 0;
  events.listen.mockClear();
  events.emit.mockClear();
  snippets.saveSnippets.mockClear();
  snippets.loadSnippets.mockClear();
  return await import("./snippetsStore");
}

describe("snippet store", () => {
  beforeEach(() => {
    snippets.state.stored = [];
  });

  it("hydrates exactly once and subscribes to cross-window changes", async () => {
    snippets.state.stored = [snippet("a")];
    const mod = await loadModule();

    await mod.useSnippetsStore.getState().hydrate();
    await mod.useSnippetsStore.getState().hydrate();

    expect(mod.useSnippetsStore.getState().snippets).toEqual([snippet("a")]);
    expect(mod.useSnippetsStore.getState().hydrated).toBe(true);
    expect(snippets.loadSnippets).toHaveBeenCalledTimes(1);
    expect(events.listen).toHaveBeenCalledTimes(1);
  });

  it("reloads snippets when the change event fires", async () => {
    const mod = await loadModule();
    await mod.useSnippetsStore.getState().hydrate();

    snippets.state.stored = [snippet("a"), snippet("b")];
    events.listeners[0]?.();

    await Promise.resolve();
    await Promise.resolve();
    expect(mod.useSnippetsStore.getState().snippets).toHaveLength(2);
  });

  it("upsert appends unknown ids and replaces known ones", async () => {
    const mod = await loadModule();
    const store = mod.useSnippetsStore;

    store.getState().upsert(snippet("a"));
    store.getState().upsert(snippet("a", "renamed"));
    store.getState().upsert(snippet("b"));

    const ids = store.getState().snippets.map((s) => s.id);
    expect(ids).toEqual(["a", "b"]);
    expect(store.getState().snippets[0].name).toBe("renamed");

    await vi.waitFor(() =>
      expect(events.emit).toHaveBeenCalledWith("terax://ai-snippets-changed"),
    );
  });

  it("remove drops only the matching snippet and persists the rest", async () => {
    const mod = await loadModule();
    const store = mod.useSnippetsStore;
    store.setState({ hydrated: true });

    store.getState().upsert(snippet("a"));
    store.getState().upsert(snippet("b"));
    store.getState().remove("a");

    expect(store.getState().snippets.map((s) => s.id)).toEqual(["b"]);
    await vi.waitFor(() =>
      expect(snippets.saveSnippets).toHaveBeenLastCalledWith([snippet("b")]),
    );
  });
});
