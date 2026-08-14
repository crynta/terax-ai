import { describe, expect, it } from "vitest";
import {
  parseOpenRouterModels,
  toOpenRouterModelInfo,
} from "./openrouterModels";

describe("OpenRouter model catalog", () => {
  it("maps catalog metadata into selectable model info", () => {
    const [model] = parseOpenRouterModels(
      JSON.stringify({
        data: [
          {
            id: "anthropic/claude-sonnet-4.5",
            name: "Claude Sonnet 4.5",
            description: "A capable model.",
            context_length: 200_000,
            architecture: { input_modalities: ["text", "image"] },
            pricing: { prompt: "0.000003", completion: "0.000015" },
            supported_parameters: ["tools", "temperature", "reasoning"],
          },
        ],
      }),
    );

    expect(model).toMatchObject({
      id: "anthropic/claude-sonnet-4.5",
      provider: "openrouter",
      label: "Claude Sonnet 4.5",
      openrouterModelId: "anthropic/claude-sonnet-4.5",
      contextLength: 200_000,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      supportsTools: true,
      batchOnly: false,
    });
    expect(model.tags).toEqual(["vision", "reasoning", "tools"]);
  });

  it("keeps batch-only models visible and marks them", () => {
    const model = toOpenRouterModelInfo({
      id: "openai/batch-model",
      name: "Batch Model",
      supported_parameters: ["batch"],
    });

    expect(model).toMatchObject({
      openrouterModelId: "openai/batch-model",
      batchOnly: true,
      hint: "Batch only",
    });
  });

  it("rejects malformed catalog responses", () => {
    expect(() => parseOpenRouterModels(JSON.stringify({ data: {} }))).toThrow(
      "invalid model catalog",
    );
  });
});
