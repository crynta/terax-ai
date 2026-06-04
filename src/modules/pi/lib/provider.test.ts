import { describe, expect, it } from "vitest";
import {
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
} from "@/modules/ai/config";
import {
  nextPiModelIdAfterCustomEndpointRemoval,
  type PiProviderPrefs,
  profileModelSourceId,
  resolvePiProviderConfig,
} from "@/modules/pi/lib/provider";

const basePrefs: PiProviderPrefs = {
  piAuthMode: "terax",
  piModelId: DEFAULT_MODEL_ID,
  lmstudioBaseURL: "http://localhost:1234/v1",
  lmstudioModelId: "",
  mlxBaseURL: "http://127.0.0.1:8080/v1",
  mlxModelId: "",
  ollamaBaseURL: "http://localhost:11434/v1",
  ollamaModelId: "",
  openaiCompatibleBaseURL: "https://api.example.com/v1",
  openaiCompatibleModelId: "",
  openaiCompatibleContextLimit: 128_000,
  openrouterModelId: "",
  customEndpoints: [],
};

describe("resolvePiProviderConfig", () => {
  it("resolves built-in reasoning cloud models without secrets", () => {
    const resolved = resolvePiProviderConfig({
      ...basePrefs,
      piModelId: "gpt-5.5",
    });

    expect(resolved).toMatchObject({
      ok: true,
      providerLabel: "OpenAI",
      modelLabel: "GPT-5.5",
      config: {
        provider: "openai",
        modelId: "gpt-5.5",
        sourceModelId: "gpt-5.5",
        contextLimit: 1_050_000,
        maxTokens: 1_050_000,
        reasoning: true,
      },
    });
    expect(resolved.ok && resolved.config.apiKey).toBeUndefined();
  });

  it("resolves local placeholder models to their configured runtime id", () => {
    const resolved = resolvePiProviderConfig({
      ...basePrefs,
      piModelId: "lmstudio-local",
      lmstudioModelId: "qwen2.5-coder-7b-instruct",
    });

    expect(resolved).toMatchObject({
      ok: true,
      providerLabel: "LM Studio",
      modelLabel: "qwen2.5-coder-7b-instruct",
      config: {
        provider: "lmstudio",
        modelId: "qwen2.5-coder-7b-instruct",
        sourceModelId: "lmstudio-local",
        baseUrl: "http://localhost:1234/v1",
      },
    });
  });

  it("resolves named OpenAI-compatible endpoints", () => {
    const endpoint = {
      id: "abc123",
      name: "Gateway",
      baseURL: "https://gateway.example.com/v1",
      modelId: "qwen3-max",
      contextLimit: 256_000,
    };

    const resolved = resolvePiProviderConfig({
      ...basePrefs,
      piModelId: compatModelIdForEndpoint(endpoint.id),
      customEndpoints: [endpoint],
    });

    expect(resolved).toMatchObject({
      ok: true,
      providerLabel: "OpenAI Compatible",
      modelLabel: "Gateway",
      config: {
        provider: "openai-compatible",
        modelId: "qwen3-max",
        sourceModelId: "compat-abc123",
        customEndpointId: "abc123",
        baseUrl: "https://gateway.example.com/v1",
        contextLimit: 256_000,
        maxTokens: 256_000,
        reasoning: true,
      },
    });
  });

  it("returns an actionable error for incomplete local providers", () => {
    const resolved = resolvePiProviderConfig({
      ...basePrefs,
      piModelId: "ollama-local",
    });

    expect(resolved).toMatchObject({
      ok: false,
      providerLabel: "Ollama",
      modelLabel: "Ollama",
      error: "Ollama needs a model id in Settings > Models.",
    });
  });

  it("resolves profile-backed Pi models without Terax provider keys", () => {
    const resolved = resolvePiProviderConfig({
      ...basePrefs,
      piAuthMode: "profile",
      piModelId: profileModelSourceId("openai-codex", "gpt-5.3-codex"),
    });

    expect(resolved).toMatchObject({
      ok: true,
      provider: "openai-codex",
      providerLabel: "OpenAI Codex",
      modelLabel: "gpt-5.3-codex",
      config: {
        authMode: "profile",
        provider: "openai-codex",
        modelId: "gpt-5.3-codex",
        sourceModelId: "pi-profile:openai-codex:gpt-5.3-codex",
      },
    });
  });
});

describe("nextPiModelIdAfterCustomEndpointRemoval", () => {
  it("falls back when the removed endpoint was selected for Pi", () => {
    expect(
      nextPiModelIdAfterCustomEndpointRemoval(
        compatModelIdForEndpoint("deleted"),
        "deleted",
        [
          {
            id: "remaining",
            name: "Gateway",
            baseURL: "https://gateway.example.com/v1",
            modelId: "qwen3-max",
            contextLimit: 128_000,
          },
        ],
      ),
    ).toBe(compatModelIdForEndpoint("remaining"));
  });

  it("keeps the current Pi model when another endpoint is removed", () => {
    expect(
      nextPiModelIdAfterCustomEndpointRemoval(
        "claude-sonnet-4-6",
        "deleted",
        [],
      ),
    ).toBe("claude-sonnet-4-6");
  });
});
