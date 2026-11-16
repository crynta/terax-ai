import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SerializedTab } from "./serialize";
import type { SpaceMeta, SpaceState } from "./store";

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

vi.mock("@/modules/workspace", () => ({}));

function store() {
  return pluginStore.instances[pluginStore.instances.length - 1];
}

async function reload() {
  vi.resetModules();
  return await import("./store");
}

function meta(id: string): SpaceMeta {
  return {
    id,
    name: `Space ${id}`,
    root: `/repo/${id}`,
    env: { kind: "local" } as SpaceMeta["env"],
    createdAt: 1,
    updatedAt: 2,
  };
}

function state(): SpaceState {
  return {
    tabs: [{ id: "tab-1", kind: "terminal" } as unknown as SerializedTab],
    activeTabIndex: 0,
  };
}

describe("space persistence", () => {
  beforeEach(() => {
    pluginStore.instances.length = 0;
  });

  it("loadAll tolerates an empty store", async () => {
    const mod = await reload();

    await expect(mod.loadAll()).resolves.toEqual({
      spaces: [],
      activeId: null,
      states: new Map(),
    });
  });

  it("round-trips spaces, the active id, and per-space tab states", async () => {
    const mod = await reload();
    const spaces = [meta("a"), meta("b")];

    await mod.saveSpacesList(spaces);
    await mod.saveActiveId("b");
    await mod.saveState("a", state());

    const loaded = await mod.loadAll();

    expect(loaded.spaces).toEqual(spaces);
    expect(loaded.activeId).toBe("b");
    expect(loaded.states.get("a")).toEqual(state());
    expect(loaded.states.has("b")).toBe(false);
  });

  it("ignores foreign keys while parsing stored entries", async () => {
    const mod = await reload();
    await mod.saveSpacesList([meta("a")]);
    store().data.set("unrelated", "keep-me");

    const loaded = await mod.loadAll();

    expect(loaded.spaces.map((s) => s.id)).toEqual(["a"]);
    expect(store().data.get("unrelated")).toBe("keep-me");
  });

  it("deleteSpaceData removes only that space's state key", async () => {
    const mod = await reload();
    await mod.saveState("a", state());
    await mod.saveState("b", state());

    await mod.deleteSpaceData("a");

    expect(store().data.has("state:a")).toBe(false);
    expect(store().data.has("state:b")).toBe(true);
  });

  it("newSpaceId is prefixed and unique", async () => {
    const mod = await reload();
    const a = mod.newSpaceId();
    const b = mod.newSpaceId();
    expect(a.startsWith("sp-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
