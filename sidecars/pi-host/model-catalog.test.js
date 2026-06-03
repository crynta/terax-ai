import { describe, expect, it } from "vitest";
import { listProfileModels } from "./model-catalog.js";

class FakeAuthStorage {
  constructor(path) {
    this.path = path;
  }
}

class FakeModelRegistry {
  constructor(authStorage, path) {
    this.authStorage = authStorage;
    this.path = path;
  }

  getAll() {
    return [
      {
        provider: "openai-codex",
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        contextWindow: 400_000,
        maxTokens: 32_000,
        reasoning: true,
      },
      {
        provider: "anthropic",
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        contextWindow: 200_000,
        maxTokens: 64_000,
        reasoning: false,
      },
    ];
  }

  hasConfiguredAuth(model) {
    return model.provider === "openai-codex";
  }

  getProviderDisplayName(provider) {
    return provider === "openai-codex" ? "OpenAI Codex" : "Anthropic";
  }

  getError() {
    return undefined;
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
    },
    ModelRegistry: {
      create(authStorage, path) {
        refs.modelRegistry = new FakeModelRegistry(authStorage, path);
        return refs.modelRegistry;
      },
    },
  };
}

describe("listProfileModels", () => {
  it("lists non-secret Pi profile model metadata and availability", async () => {
    const pi = fakePi();
    const result = await listProfileModels(pi, {
      profileAgentDir: "/Users/me/.pi/agent",
    });

    expect(pi.refs.authStorage.path).toBe("/Users/me/.pi/agent/auth.json");
    expect(pi.refs.modelRegistry.path).toBe("/Users/me/.pi/agent/models.json");
    expect(result).toEqual({
      profileAgentDir: "/Users/me/.pi/agent",
      loadError: null,
      models: [
        {
          provider: "openai-codex",
          providerLabel: "OpenAI Codex",
          id: "gpt-5.3-codex",
          label: "GPT-5.3 Codex",
          available: true,
          contextWindow: 400_000,
          maxTokens: 32_000,
          reasoning: true,
        },
        {
          provider: "anthropic",
          providerLabel: "Anthropic",
          id: "claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          available: false,
          contextWindow: 200_000,
          maxTokens: 64_000,
          reasoning: false,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sk-");
  });
});
