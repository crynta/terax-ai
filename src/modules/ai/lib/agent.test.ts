import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATLASCLOUD_DEFAULT_BASE_URL } from "@/modules/ai/config";
import { buildLanguageModel } from "./agent";
import type { ProviderKeys } from "./keyring";

const compatibleMock = vi.hoisted(() => {
  const modelFactory = vi.fn((modelId: string) => ({
    id: modelId,
    provider: "mock-atlascloud",
  }));
  const createOpenAICompatible = vi.fn(() => modelFactory);

  return { createOpenAICompatible, modelFactory };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: compatibleMock.createOpenAICompatible,
}));

const providerKeys: ProviderKeys = {
  openai: null,
  anthropic: null,
  google: null,
  xai: null,
  cerebras: null,
  groq: null,
  deepseek: null,
  mistral: null,
  openrouter: null,
  atlascloud: "atlas-test-key",
  "openai-compatible": null,
  lmstudio: null,
  mlx: null,
  ollama: null,
};

describe("buildLanguageModel", () => {
  beforeEach(() => {
    compatibleMock.createOpenAICompatible.mockClear();
    compatibleMock.modelFactory.mockClear();
  });

  it("builds Atlas Cloud models through the OpenAI-compatible runtime", async () => {
    const model = await buildLanguageModel(
      "atlascloud",
      providerKeys,
      "deepseek-ai/deepseek-v4-pro",
    );

    expect(compatibleMock.createOpenAICompatible).toHaveBeenCalledWith({
      name: "atlascloud",
      baseURL: ATLASCLOUD_DEFAULT_BASE_URL,
      apiKey: "atlas-test-key",
    });
    expect(compatibleMock.modelFactory).toHaveBeenCalledWith(
      "deepseek-ai/deepseek-v4-pro",
    );
    expect(model).toEqual({
      id: "deepseek-ai/deepseek-v4-pro",
      provider: "mock-atlascloud",
    });
  });
});
