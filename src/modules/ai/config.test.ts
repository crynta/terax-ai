import { describe, expect, it } from "vitest";
import {
  type CustomEndpoint,
  coerceSttProvider,
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  getModelContextLimit,
  isCompatModelId,
  isSttProvider,
  MODEL_PRICING,
  migrateLegacyCompatEndpoint,
  modelKeepsReasoning,
  modelSupportsTemperature,
  modelUsesReasoningTokens,
  resolveModel,
  sttProvidersForPlatform,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelId: "llama-3.3-70b",
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("round-trips endpoint id through the synthetic model id", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(isCompatModelId(mid)).toBe(true);
    expect(endpointIdFromCompatModel(mid)).toBe(endpoint.id);
  });

  it("treats static model ids as non-compat", () => {
    expect(isCompatModelId("gpt-5.4-mini")).toBe(false);
    expect(endpointIdFromCompatModel("gpt-5.4-mini")).toBe("");
  });
});

describe("resolveModel", () => {
  it("resolves a compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe(endpoint.modelId);
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(compatModelIdForEndpoint("missing"), []);
    expect(info.provider).toBe("openai-compatible");
  });

  it("resolves a static model id from the registry", () => {
    expect(resolveModel("gpt-5.4-mini").provider).toBe("openai");
  });

  it.each([
    ["gpt-5.6", "openai"],
    ["gpt-5.6-terra", "openai"],
    ["gpt-5.6-luna", "openai"],
    ["claude-fable-5", "anthropic"],
    ["claude-sonnet-5", "anthropic"],
    ["grok-4.5", "xai"],
  ] as const)("resolves current model %s through %s", (modelId, provider) => {
    expect(resolveModel(modelId).provider).toBe(provider);
  });

  it("throws on an unknown static model id", () => {
    expect(() => resolveModel("nope-not-real")).toThrow();
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("reads the static table for known models", () => {
    expect(getModelContextLimit("claude-opus-4-7")).toBe(1_000_000);
  });

  it.each([
    ["gpt-5.6", 1_050_000],
    ["gpt-5.6-terra", 1_050_000],
    ["gpt-5.6-luna", 1_050_000],
    ["claude-fable-5", 1_000_000],
    ["claude-sonnet-5", 1_000_000],
    ["grok-4.5", 500_000],
  ] as const)("uses the published context limit for %s", (modelId, limit) => {
    expect(getModelContextLimit(modelId)).toBe(limit);
  });
});

describe("current model pricing", () => {
  it.each([
    ["gpt-5.6", 5, 30, 0.5],
    ["gpt-5.6-terra", 2.5, 15, 0.25],
    ["gpt-5.6-luna", 1, 6, 0.1],
    ["claude-fable-5", 10, 50, 1],
    ["claude-sonnet-5", 3, 15, 0.3],
    ["grok-4.5", 2, 6, 0.5],
  ] as const)("uses the published token pricing for %s", (modelId, input, output, cacheRead) => {
    expect(MODEL_PRICING[modelId]).toEqual({ input, output, cacheRead });
  });
});

describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(compatModelIdForEndpoint(endpoint.id), [
      endpoint,
    ]);
    expect(modelKeepsReasoning(info)).toBe(true);
  });

  it("drops reasoning for plain non-reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("gpt-5.4-mini"))).toBe(false);
  });

  it("keeps reasoning for tagged reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("claude-opus-4-7"))).toBe(true);
  });
});

describe("model sampling capabilities", () => {
  it.each([
    ["openai", "gpt-5.4-nano"],
    ["openai", "gpt-5.6"],
    ["anthropic", "claude-fable-5"],
    ["anthropic", "claude-sonnet-5"],
  ] as const)("omits temperature for %s/%s", (provider, modelId) => {
    expect(modelSupportsTemperature(provider, modelId)).toBe(false);
  });

  it("keeps temperature for models that accept sampling parameters", () => {
    expect(modelSupportsTemperature("openai", "gpt-4.1-mini")).toBe(true);
    expect(modelSupportsTemperature("xai", "grok-4.5")).toBe(true);
  });

  it("defaults unknown provider models to temperature support", () => {
    expect(modelSupportsTemperature("openai-compatible", "custom-model")).toBe(
      true,
    );
  });

  it.each([
    ["openai", "gpt-5.4-nano"],
    ["openai", "gpt-5.6-luna"],
    ["anthropic", "claude-sonnet-5"],
    ["xai", "grok-4.5"],
    ["groq", "openai/gpt-oss-20b"],
  ] as const)("allocates a reasoning output budget for %s/%s", (provider, modelId) => {
    expect(modelUsesReasoningTokens(provider, modelId)).toBe(true);
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelId: "llama-3.3-70b",
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});

describe("voice provider availability", () => {
  it("offers native speech only on supported macOS systems", () => {
    expect(sttProvidersForPlatform("macos", "aarch64", "15.4")).toContain(
      "native",
    );
    expect(sttProvidersForPlatform("macos", "x86_64", "15.4")).not.toContain(
      "native",
    );
    expect(sttProvidersForPlatform("linux", "aarch64")).not.toContain("native");
    expect(sttProvidersForPlatform("macos", "aarch64", "14.7")).not.toContain(
      "native",
    );
  });

  it("offers native speech on x86-64 Linux and Windows", () => {
    expect(sttProvidersForPlatform("linux", "x86_64")).toContain("native");
    expect(sttProvidersForPlatform("windows", "x86_64")).toContain("native");
    expect(sttProvidersForPlatform("linux", "aarch64")).not.toContain("native");
  });

  it("validates persisted provider ids", () => {
    expect(isSttProvider("native")).toBe(true);
    expect(isSttProvider("speech-swift")).toBe(false);
    expect(isSttProvider("unknown")).toBe(false);
  });

  it("migrates the two legacy local providers", () => {
    expect(coerceSttProvider("speech-swift")).toBe("native");
    expect(coerceSttProvider("speech-core")).toBe("native");
    expect(coerceSttProvider("unknown")).toBe("openai");
  });
});
