import { describe, expect, it } from "vitest";
import {
  createRuntimeProviderOptions,
  normalizeRuntimeProviderConfig,
} from "./provider-config.js";

class FakeAuthStorage {
  runtimeKeys = new Map();
  constructor(path) {
    this.path = path;
  }
  setRuntimeApiKey(provider, apiKey) {
    this.runtimeKeys.set(provider, apiKey);
  }
}

class FakeModelRegistry {
  constructor(authStorage, path) {
    this.authStorage = authStorage;
    this.path = path;
    this.models = [
      { provider: "anthropic", id: "claude-sonnet-4-6" },
      { provider: "openai-codex", id: "gpt-5.3-codex" },
    ];
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
      create(path) {
        refs.authStorage = new FakeAuthStorage(path);
        return refs.authStorage;
      },
      inMemory() {
        refs.authStorage = new FakeAuthStorage();
        return refs.authStorage;
      },
    },
    ModelRegistry: {
      create(authStorage, path) {
        refs.modelRegistry = new FakeModelRegistry(authStorage, path);
        return refs.modelRegistry;
      },
      inMemory(authStorage) {
        refs.modelRegistry = new FakeModelRegistry(authStorage);
        return refs.modelRegistry;
      },
    },
    SettingsManager: {
      create(_cwd, agentDir) {
        refs.settingsManager = { agentDir };
        return refs.settingsManager;
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
      authMode: "terax",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      sourceModelId: "claude-sonnet-4-6",
    });
  });

  it("normalizes explicit Pi profile config", () => {
    expect(
      normalizeRuntimeProviderConfig({
        authMode: " profile ",
        provider: " openai-codex ",
        modelId: " gpt-5.3-codex ",
        sourceModelId: "pi-profile:openai-codex:gpt-5.3-codex",
        profileAgentDir: " /Users/me/.pi/agent ",
      }),
    ).toEqual({
      authMode: "profile",
      provider: "openai-codex",
      modelId: "gpt-5.3-codex",
      sourceModelId: "pi-profile:openai-codex:gpt-5.3-codex",
      profileAgentDir: "/Users/me/.pi/agent",
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

  it("uses explicit Pi profile storage for profile-backed models", async () => {
    const pi = fakePi();
    const options = await createRuntimeProviderOptions(
      pi,
      {
        authMode: "profile",
        provider: "openai-codex",
        modelId: "gpt-5.3-codex",
        profileAgentDir: "/Users/me/.pi/agent",
      },
      { cwd: "/repo" },
    );

    expect(options.model).toEqual({
      provider: "openai-codex",
      id: "gpt-5.3-codex",
    });
    expect(pi.refs.authStorage.path).toBe("/Users/me/.pi/agent/auth.json");
    expect(pi.refs.modelRegistry.path).toBe("/Users/me/.pi/agent/models.json");
    expect(options.settingsManager).toEqual({
      agentDir: "/Users/me/.pi/agent",
    });
  });
});
