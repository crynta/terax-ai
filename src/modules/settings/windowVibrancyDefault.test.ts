import { beforeEach, describe, expect, it, vi } from "vitest";

// `store` is created at module load, so the plugin mock must be in place
// before `./store` is imported.
const entries = vi.hoisted(() => ({ value: [] as [string, unknown][] }));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = async () => entries.value;
    get = async () => undefined;
    set = async () => undefined;
    save = async () => undefined;
  },
  Store: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: async () => () => undefined,
}));

describe("windowVibrancy default", () => {
  beforeEach(() => {
    entries.value = [];
    vi.resetModules();
  });

  it("is off by default", async () => {
    const { DEFAULT_PREFERENCES } = await import("./store");
    expect(DEFAULT_PREFERENCES.windowVibrancy).toBe(false);
  });

  it("applies to users who never stored a choice", async () => {
    const { loadPreferences } = await import("./store");
    expect((await loadPreferences()).windowVibrancy).toBe(false);
  });

  it("never overrides an explicit stored choice", async () => {
    entries.value = [["windowVibrancy", true]];
    const { loadPreferences } = await import("./store");
    expect((await loadPreferences()).windowVibrancy).toBe(true);

    vi.resetModules();
    entries.value = [["windowVibrancy", false]];
    const again = await import("./store");
    expect((await again.loadPreferences()).windowVibrancy).toBe(false);
  });
});
