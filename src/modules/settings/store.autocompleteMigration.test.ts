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

async function load(stored: [string, unknown][]) {
  entries.value = stored;
  vi.resetModules();
  const { loadPreferences } = await import("./store");
  return loadPreferences();
}

describe("autocomplete model migration", () => {
  beforeEach(() => {
    entries.value = [];
  });

  it("replaces a removed Groq model with the Groq default", async () => {
    const prefs = await load([
      ["autocompleteProvider", "groq"],
      ["autocompleteModelId", "deepseek-r1-distill-llama-70b"],
    ]);
    expect(prefs.autocompleteModelId).toBe("openai/gpt-oss-20b");
  });

  it("keeps a Groq model that is still in the catalog", async () => {
    const prefs = await load([
      ["autocompleteProvider", "groq"],
      ["autocompleteModelId", "openai/gpt-oss-120b"],
    ]);
    expect(prefs.autocompleteModelId).toBe("openai/gpt-oss-120b");
  });

  it("preserves runtime-supplied model ids for other providers", async () => {
    const prefs = await load([
      ["autocompleteProvider", "openrouter"],
      ["autocompleteModelId", "vendor/custom-model"],
    ]);
    expect(prefs.autocompleteModelId).toBe("vendor/custom-model");
  });

  it("leaves an empty Groq model id for the provider default to apply", async () => {
    const prefs = await load([
      ["autocompleteProvider", "groq"],
      ["autocompleteModelId", ""],
    ]);
    expect(prefs.autocompleteModelId).toBe("");
  });
});
