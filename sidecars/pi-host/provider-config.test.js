import { describe, expect, it } from "vitest";
import {
  createRuntimeProviderOptions,
  normalizeRuntimeProviderConfig,
} from "./provider-config.js";

class FakeAuthStorage {
  runtimeKeys = new Map();
  setRuntimeApiKey(provider, apiKey) {
    this.runtimeKeys.set(provider, apiKey);
  }
}

class FakeModelRegistry {
  constructor(authStorage) {
    this.authStorage = authStorage;
    this.models = [{ provider: "anthropic", id: "claude-sonnet-4-6" }];
    this.registered = [];
  }

  find(provider, modelId) {
    return this.models.find(
      (model) => model.provider === provider && model.id === modelId,
    );
  }

  registerProvider(provider, config) {
    this.registered.push({ provider, config });
    this.models = config.models.map((model) => ({
      provider,
      id: model.id,
      api: model.api ?? config.api,
      baseUrl: model.baseUrl ?? config.baseUrl,
    }));
  }
}

function fakePi() {
  const refs = {};
  return {
    refs,
    AuthStorage: {
      inMemory() {
        refs.authStorage = new FakeAuthStorage();
        return refs.authStorage;
      },
    },
    ModelRegistry: {
      inMemory(authStorage) {
        refs.modelRegistry = new FakeModelRegistry(authStorage);
        return refs.modelRegistry;
      },
    },
  };
}

describe("normalizeRuntimeProviderConfig", () => {
  it("trims runtime config and keeps keys optional", () => {
    expect(
      normalizeRuntimeProviderConfig({
        provider: " anthropic ",
        modelId: " claude-sonnet-4-6 ",
        sourceModelId: " claude-sonnet-4-6 ",
      }),
    ).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      sourceModelId: "claude-sonnet-4-6",
    });
  });

  it("rejects newline-bearing provider fields", () => {
    expect(() =>
      normalizeRuntimeProviderConfig({
        provider: "anthropic",
        modelId: "claude\nsonnet",
      }),
    ).toThrow("providerConfig.modelId must not contain newlines");
  });
});

describe("createRuntimeProviderOptions", () => {
  it("uses in-memory auth storage for built-in runtime keys", async () => {
    const pi = fakePi();
    const options = await createRuntimeProviderOptions(pi, {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      apiKey: "sk-ant-test",
    });

    expect(options.model).toEqual({
      provider: "anthropic",
      id: "claude-sonnet-4-6",
    });
    expect(pi.refs.authStorage.runtimeKeys.get("anthropic")).toBe(
      "sk-ant-test",
    );
    expect(pi.refs.modelRegistry.registered).toEqual([]);
  });

  it("registers custom OpenAI-compatible endpoints without persisting keys", async () => {
    const pi = fakePi();
    const options = await createRuntimeProviderOptions(pi, {
      provider: "openai-compatible",
      modelId: "qwen3-max",
      baseUrl: "https://gateway.example.com/v1",
      contextLimit: 256_000,
      apiKey: "gateway-key",
    });

    expect(options.model).toMatchObject({
      provider: "openai-compatible",
      id: "qwen3-max",
      baseUrl: "https://gateway.example.com/v1",
    });
    expect(pi.refs.modelRegistry.registered).toEqual([
      expect.objectContaining({
        provider: "openai-compatible",
        config: expect.objectContaining({
          api: "openai-completions",
          apiKey: "gateway-key",
          baseUrl: "https://gateway.example.com/v1",
        }),
      }),
    ]);
  });
});
