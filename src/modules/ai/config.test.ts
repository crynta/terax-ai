import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  getAllModels,
  getModel,
  getModelOrDefault,
  makeOpenAICompatibleId,
  parseOpenAICompatibleModelIds,
  serializeOpenAICompatibleModelIds,
  setOpenAICompatibleSynthesizedModelIds,
} from "./config";

describe("OpenAI-compatible model registry", () => {
  afterEach(() => {
    setOpenAICompatibleSynthesizedModelIds("");
  });

  it("round-trips comma-separated upstream ids without duplicates", () => {
    const parsed = parseOpenAICompatibleModelIds(
      "gpt-4o, qwen/qwen3-max, gpt-4o,  , glm-4.6",
    );

    expect(parsed).toEqual(["gpt-4o", "qwen/qwen3-max", "glm-4.6"]);
    expect(serializeOpenAICompatibleModelIds(parsed)).toBe(
      "gpt-4o, qwen/qwen3-max, glm-4.6",
    );
  });

  it("registers discovered upstream ids as namespaced selectable models", () => {
    setOpenAICompatibleSynthesizedModelIds([
      "zai/glm-4.6",
      "openai/gpt-5.5",
    ]);

    const ids = getAllModels().map((model) => model.id);
    expect(ids).not.toContain("openai-compatible-custom");
    expect(ids).toContain(makeOpenAICompatibleId("zai/glm-4.6"));
    expect(ids).toContain(makeOpenAICompatibleId("openai/gpt-5.5"));

    const model = getModel(
      makeOpenAICompatibleId("zai/glm-4.6") as Parameters<typeof getModel>[0],
    );
    expect(model.provider).toBe("openai-compatible");
    expect(model.label).toBe("zai/glm-4.6");
    expect(model.upstreamId).toBe("zai/glm-4.6");
  });

  it("falls back when a previously selected synthesized model disappears", () => {
    const staleCompatModelId = makeOpenAICompatibleId("zai/glm-4.6");

    setOpenAICompatibleSynthesizedModelIds(["zai/glm-4.6"]);
    expect(getModelOrDefault(staleCompatModelId).id).toBe(staleCompatModelId);

    setOpenAICompatibleSynthesizedModelIds([]);
    expect(getModelOrDefault(staleCompatModelId).id).toBe(DEFAULT_MODEL_ID);
  });
});
