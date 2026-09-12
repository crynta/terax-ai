import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginStore = vi.hoisted(() => {
  const instances: {
    data: Map<string, unknown>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    onChange: ReturnType<typeof vi.fn>;
  }[] = [];
  class LazyStore {
    data = new Map<string, unknown>();
    get = vi.fn(async (key: string) => this.data.get(key));
    set = vi.fn(async (key: string, value: unknown) => {
      this.data.set(key, value);
    });
    save = vi.fn(async () => undefined);
    onChange = vi.fn(async () => () => undefined);
    constructor() {
      instances.push(this);
    }
  }
  return { instances, LazyStore };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: pluginStore.LazyStore,
}));

const events = vi.hoisted(() => ({
  listen: vi.fn(async () => () => undefined),
  emit: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => events);

import type { Theme } from "./types";

function theme(id: string): Theme {
  return {
    id,
    name: id,
    author: "",
    description: "",
    variants: {},
  };
}

async function loadModule() {
  vi.resetModules();
  return await import("./customThemes");
}

describe("custom theme store", () => {
  beforeEach(() => {
    pluginStore.instances.length = 0;
    events.emit.mockClear();
    events.listen.mockClear();
  });

  it("treats a missing or malformed store value as an empty list", async () => {
    const mod = await loadModule();

    await expect(mod.listCustomThemes()).resolves.toEqual([]);

    const store = pluginStore.instances[0];
    store.data.set("themes", "not-an-array");
    await expect(mod.listCustomThemes()).resolves.toEqual([]);
  });

  it("upserts by id: appends unknown ids and replaces known ones", async () => {
    const mod = await loadModule();

    await mod.saveCustomTheme(theme("a"));
    await mod.saveCustomTheme(theme("b"));
    await mod.saveCustomTheme(theme("a"));

    const store = pluginStore.instances[0];
    const stored = store.data.get("themes") as Theme[];
    expect(stored.map((t) => t.id)).toEqual(["b", "a"]);
    expect(store.save).toHaveBeenCalledTimes(3);
    expect(events.emit).toHaveBeenCalledWith("terax://custom-themes-changed");
  });

  it("delete is a no-op when the id does not exist", async () => {
    const mod = await loadModule();
    await mod.saveCustomTheme(theme("a"));
    events.emit.mockClear();
    const store = pluginStore.instances[0];
    store.set.mockClear();
    store.save.mockClear();

    await mod.deleteCustomTheme("missing");

    expect(store.set).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("delete removes only the target theme and persists", async () => {
    const mod = await loadModule();
    await mod.saveCustomTheme(theme("a"));
    await mod.saveCustomTheme(theme("b"));

    await mod.deleteCustomTheme("a");

    const store = pluginStore.instances[0];
    const stored = store.data.get("themes") as Theme[];
    expect(stored.map((t) => t.id)).toEqual(["b"]);
    expect(events.emit).toHaveBeenCalledWith("terax://custom-themes-changed");
  });

  it("subscribes to store-key changes and cross-window events once", async () => {
    const mod = await loadModule();
    const cb = vi.fn();

    const unlisten = await mod.onCustomThemesChange(cb);

    const store = pluginStore.instances[0];
    const keyHandler = store.onChange.mock.calls[0][0] as (k: string) => void;
    keyHandler("themes");
    expect(cb).toHaveBeenCalledTimes(1);

    keyHandler("other");
    expect(cb).toHaveBeenCalledTimes(1);

    unlisten();
  });
});
