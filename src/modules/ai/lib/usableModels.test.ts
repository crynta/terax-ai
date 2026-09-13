import { describe, expect, it } from "vitest";
import { EMPTY_PROVIDER_KEYS } from "./keyring";
import {
  emptyAccess,
  isModelUsable,
  isProviderUsable,
  resolveUsableModelId,
  usableCatalogModelIds,
  usableProviders,
} from "./usableModels";

describe("isProviderUsable", () => {
  it("requires a key for cloud providers", () => {
    const none = emptyAccess({ ...EMPTY_PROVIDER_KEYS });
    expect(isProviderUsable("xai", none)).toBe(false);
    expect(isProviderUsable("openai", none)).toBe(false);
    const xai = emptyAccess({ ...EMPTY_PROVIDER_KEYS, xai: "xai-key" });
    expect(isProviderUsable("xai", xai)).toBe(true);
    expect(isProviderUsable("openai", xai)).toBe(false);
  });

  it("requires an OpenRouter model id as well as a key", () => {
    const keyed = emptyAccess({
      ...EMPTY_PROVIDER_KEYS,
      openrouter: "sk-or-1",
    });
    expect(isProviderUsable("openrouter", keyed)).toBe(false);
    expect(
      isProviderUsable("openrouter", {
        ...keyed,
        openrouterModelId: "openai/gpt-5.4-mini",
      }),
    ).toBe(true);
  });

  it("treats local providers as usable only when a model id is set", () => {
    const none = emptyAccess({ ...EMPTY_PROVIDER_KEYS });
    expect(isProviderUsable("ollama", none)).toBe(false);
    expect(
      isProviderUsable("ollama", { ...none, ollamaModelId: "qwen2.5:7b" }),
    ).toBe(true);
  });
});

describe("usable catalog and resolve", () => {
  it("lists only models for providers with access", () => {
    const access = emptyAccess({ ...EMPTY_PROVIDER_KEYS, xai: "xai-key" });
    const ids = usableCatalogModelIds(access);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("grok-"))).toBe(true);
    expect(usableProviders(access)).toEqual(["xai"]);
  });

  it("keeps a usable preferred model instead of the first catalog entry", () => {
    const access = emptyAccess({ ...EMPTY_PROVIDER_KEYS, xai: "xai-key" });
    const first = usableCatalogModelIds(access)[0];
    expect(first).toBe("grok-4.6");
    expect(resolveUsableModelId("grok-4.3", access)).toBe("grok-4.3");
    expect(isModelUsable("grok-4.3", access)).toBe(true);
  });

  it("falls back to the first usable model when the preferred one has no key", () => {
    const access = emptyAccess({ ...EMPTY_PROVIDER_KEYS, xai: "xai-key" });
    expect(resolveUsableModelId("gpt-5.4-mini", access)).toBe("grok-4.6");
    expect(isModelUsable("gpt-5.4-mini", access)).toBe(false);
  });

  it("uses a configured custom endpoint when no catalog provider is ready", () => {
    const access = emptyAccess({ ...EMPTY_PROVIDER_KEYS });
    const endpoints = [
      {
        id: "ab12cd34",
        name: "Local",
        baseURL: "http://127.0.0.1:8080/v1",
        modelId: "llama",
        contextLimit: 32_000,
      },
    ];
    expect(resolveUsableModelId("gpt-5.4-mini", access, endpoints)).toBe(
      "compat-ab12cd34",
    );
    expect(isModelUsable("compat-ab12cd34", access, endpoints)).toBe(true);
  });
});
