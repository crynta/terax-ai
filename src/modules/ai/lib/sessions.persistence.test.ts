import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "@ai-sdk/react";

const pluginStore = vi.hoisted(() => {
  const instances: {
    data: Map<string, unknown>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    entries: ReturnType<typeof vi.fn>;
  }[] = [];
  class LazyStore {
    data = new Map<string, unknown>();
    get = vi.fn(async (key: string) => this.data.get(key));
    set = vi.fn(async (key: string, value: unknown) => {
      this.data.set(key, value);
    });
    delete = vi.fn(async (key: string) => {
      this.data.delete(key);
    });
    entries = vi.fn(async () => [...this.data.entries()]);
    constructor() {
      instances.push(this);
    }
  }
  return { instances, LazyStore };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: pluginStore.LazyStore,
}));

function store() {
  return pluginStore.instances[pluginStore.instances.length - 1];
}

async function reload() {
  vi.resetModules();
  return await import("./sessions");
}

describe("session persistence", () => {
  beforeEach(() => {
    pluginStore.instances.length = 0;
  });

  it("reads sessions and active id, tolerating an empty store", async () => {
    const mod = await reload();
    await expect(mod.loadAll()).resolves.toEqual({
      sessions: [],
      activeId: null,
    });

    store().data.set("sessions", [
      { id: "s-1", title: "T", createdAt: 1, updatedAt: 2 },
    ]);
    store().data.set("activeId", "s-1");

    await expect(mod.loadAll()).resolves.toEqual({
      sessions: [{ id: "s-1", title: "T", createdAt: 1, updatedAt: 2 }],
      activeId: "s-1",
    });
  });

  it("writes the session list and the active id under fixed keys", async () => {
    const mod = await reload();
    const metas = [{ id: "s-9", title: "X", createdAt: 0, updatedAt: 0 }];

    await mod.saveSessionsList(metas);
    expect(store().data.get("sessions")).toEqual(metas);

    await mod.saveActiveId("s-9");
    expect(store().data.get("activeId")).toBe("s-9");
  });

  it("namespaces per-session messages and returns null when missing", async () => {
    const mod = await reload();
    const messages = [{ id: "m1", role: "user", parts: [] }] as UIMessage[];

    await expect(mod.loadMessages("s-1")).resolves.toBeNull();

    await mod.saveMessages("s-1", messages);
    expect(store().data.get("messages:s-1")).toEqual(messages);
    await expect(mod.loadMessages("s-1")).resolves.toEqual(messages);
  });

  it("deletes only the targeted session's messages", async () => {
    const mod = await reload();
    await mod.saveMessages("s-1", [{ id: "a", role: "user", parts: [] }]);
    await mod.saveMessages("s-2", [{ id: "b", role: "user", parts: [] }]);

    await mod.deleteSessionData("s-1");

    expect(store().data.has("messages:s-1")).toBe(false);
    expect(store().data.has("messages:s-2")).toBe(true);
  });

  it("generates prefixed unique ids", async () => {
    const mod = await reload();
    const a = mod.newSessionId();
    const b = mod.newSessionId();
    expect(a.startsWith("s-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
