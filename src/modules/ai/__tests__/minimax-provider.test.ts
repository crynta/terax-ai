import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  MODELS,
  MODEL_CONTEXT_LIMITS,
  MODEL_PRICING,
  getProvider,
  getModel,
  DEFAULT_AUTOCOMPLETE_MODEL,
  type ProviderId,
  type ModelId,
} from "../config";

describe("MiniMax provider registration", () => {
  it("is listed in PROVIDERS", () => {
    const minimax = PROVIDERS.find((p) => p.id === "minimax");
    expect(minimax).toBeDefined();
    expect(minimax!.label).toBe("MiniMax");
    expect(minimax!.keyringAccount).toBe("minimax-api-key");
  });

  it("is retrievable via getProvider", () => {
    const p = getProvider("minimax" as ProviderId);
    expect(p.id).toBe("minimax");
    expect(p.consoleUrl).toContain("minimax.io");
  });
});

describe("MiniMax model registration", () => {
  it("registers MiniMax-M2.7", () => {
    const m = MODELS.find((m) => m.id === "MiniMax-M2.7");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("minimax");
  });

  it("registers MiniMax-M2.7-highspeed", () => {
    const m = MODELS.find((m) => m.id === "MiniMax-M2.7-highspeed");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("minimax");
  });

  it("is retrievable via getModel", () => {
    const m = getModel("MiniMax-M2.7" as ModelId);
    expect(m.provider).toBe("minimax");
    expect(m.label).toContain("MiniMax");
  });

  it("has context limits defined", () => {
    expect(MODEL_CONTEXT_LIMITS["MiniMax-M2.7"]).toBe(204_800);
    expect(MODEL_CONTEXT_LIMITS["MiniMax-M2.7-highspeed"]).toBe(204_800);
  });

  it("has pricing defined", () => {
    const pricing = MODEL_PRICING["MiniMax-M2.7"];
    expect(pricing).toBeDefined();
    expect(pricing.input).toBe(0.3);
    expect(pricing.output).toBe(1.2);
    expect(pricing.cacheRead).toBe(0.06);

    const hsPricing = MODEL_PRICING["MiniMax-M2.7-highspeed"];
    expect(hsPricing).toBeDefined();
    expect(hsPricing.input).toBe(0.6);
    expect(hsPricing.output).toBe(2.4);
  });

  it("has a default autocomplete model", () => {
    expect(DEFAULT_AUTOCOMPLETE_MODEL["minimax" as ProviderId]).toBe(
      "MiniMax-M2.7-highspeed",
    );
  });
});

describe("MiniMax base URL handling", () => {
  it("constructs correct Anthropic-compatible base URL", () => {
    const baseURL = "https://api.minimax.io/anthropic";
    const normalized = baseURL.endsWith("/v1")
      ? baseURL
      : `${baseURL.replace(/\/$/, "")}/v1`;
    expect(normalized).toBe("https://api.minimax.io/anthropic/v1");
  });

  it("does not use api.minimax.chat domain", () => {
    const provider = PROVIDERS.find((p) => p.id === "minimax");
    expect(provider!.consoleUrl).not.toContain("minimax.chat");
  });
});
