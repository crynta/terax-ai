import { beforeEach, describe, expect, it, vi } from "vitest";

const openai = vi.hoisted(() => {
  const createOpenAI = vi.fn(() => vi.fn(() => "model-openai"));
  return { createOpenAI };
});

vi.mock("@ai-sdk/openai", () => openai);

const anthropic = vi.hoisted(() => {
  const createAnthropic = vi.fn(() => vi.fn(() => "model-anthropic"));
  return { createAnthropic };
});

vi.mock("@ai-sdk/anthropic", () => anthropic);

const openaiCompatible = vi.hoisted(() => {
  const createOpenAICompatible = vi.fn(() => vi.fn(() => "model-compat"));
  return { createOpenAICompatible };
});

vi.mock("@ai-sdk/openai-compatible", () => openaiCompatible);

import { buildConfiguredLanguageModel } from "./agent";
import { EMPTY_PROVIDER_KEYS } from "./keyring";

const keys = { ...EMPTY_PROVIDER_KEYS, anthropic: "sk-ant-test" };

function compatEndpoint(partial: Record<string, unknown>) {
  return [
    {
      id: "e1",
      name: "My Relay",
      baseURL: "http://localhost:4000/v1",
      modelId: "relay-model",
      apiKeyId: null,
      ...partial,
    },
  ] as never;
}

describe("buildConfiguredLanguageModel", () => {
  beforeEach(() => {
    openai.createOpenAI.mockClear();
    anthropic.createAnthropic.mockClear();
    openaiCompatible.createOpenAICompatible.mockClear();
  });

  it("routes a cloud model id to its provider SDK", async () => {
    const model = await buildConfiguredLanguageModel("claude-sonnet-5", keys);

    expect(model).toBe("model-anthropic");
    expect(anthropic.createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ant-test" }),
    );
  });

  it("refuses local providers with no model id configured", async () => {
    expect(() => buildConfiguredLanguageModel("lmstudio-local", keys)).toThrow(
      /no model id set/i,
    );
    expect(() => buildConfiguredLanguageModel("ollama-local", keys)).toThrow(
      /no model id set/i,
    );
    expect(openaiCompatible.createOpenAICompatible).not.toHaveBeenCalled();
  });

  it("points local servers at their configured base URL and model", async () => {
    const model = await buildConfiguredLanguageModel("lmstudio-local", keys, {
      lmstudioBaseURL: "http://127.0.0.1:1234/v1",
      lmstudioModelId: "qwen3-32b",
    });

    expect(model).toBe("model-compat");
    expect(openaiCompatible.createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://127.0.0.1:1234/v1",
      }),
    );
  });

  it("rejects a compat model whose endpoint is unknown", () => {
    expect(() =>
      buildConfiguredLanguageModel("compat-missing", keys),
    ).toThrow(/Custom endpoint not found: missing/);
  });

  it("rejects a known endpoint without a model id", () => {
    expect(() =>
      buildConfiguredLanguageModel("compat-e1", keys, {
        customEndpoints: compatEndpoint({ modelId: "   " }),
      }),
    ).toThrow(/no model id set/i);
  });

  it("builds from the endpoint's configured model id and base URL", async () => {
    const model = await buildConfiguredLanguageModel("compat-e1", keys, {
      customEndpoints: compatEndpoint({}),
    });
    expect(model).toBe("model-compat");
    expect(openaiCompatible.createOpenAICompatible).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:4000/v1" }),
    );
  });
});
