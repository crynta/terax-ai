import { describe, it, expect } from "vitest";
import { createAnthropic } from "@ai-sdk/anthropic";
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
  it("registers MiniMax-M3 as the default (first) MiniMax model", () => {
    const m = MODELS.find((m) => m.id === "MiniMax-M3");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("minimax");

    const minimaxModels = MODELS.filter((m) => m.provider === "minimax");
    expect(minimaxModels[0]!.id).toBe("MiniMax-M3");
  });

  it("keeps MiniMax-M2.7 as a legacy alternative", () => {
    const m = MODELS.find((m) => m.id === "MiniMax-M2.7");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("minimax");
  });

  it("keeps MiniMax-M2.7-highspeed as a legacy alternative", () => {
    const m = MODELS.find((m) => m.id === "MiniMax-M2.7-highspeed");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("minimax");
  });

  it("is retrievable via getModel", () => {
    const m = getModel("MiniMax-M3" as ModelId);
    expect(m.provider).toBe("minimax");
    expect(m.label).toContain("MiniMax");
  });

  it("has context limits defined", () => {
    expect(MODEL_CONTEXT_LIMITS["MiniMax-M3"]).toBe(512_000);
    expect(MODEL_CONTEXT_LIMITS["MiniMax-M2.7"]).toBe(204_800);
    expect(MODEL_CONTEXT_LIMITS["MiniMax-M2.7-highspeed"]).toBe(204_800);
  });

  it("has pricing defined", () => {
    const m3 = MODEL_PRICING["MiniMax-M3"];
    expect(m3).toBeDefined();
    expect(m3.input).toBe(0.6);
    expect(m3.output).toBe(2.4);
    expect(m3.cacheRead).toBe(0.12);

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
  it("constructs the Anthropic-compatible messages URL", async () => {
    let requestedURL = "";
    const model = createAnthropic({
      apiKey: "test-key",
      baseURL: "https://api.minimax.io/anthropic/v1",
      fetch: async (url) => {
        requestedURL = String(url);
        throw new Error("request intercepted");
      },
    })("MiniMax-M3");

    await expect(
      model.doGenerate({
        prompt: [
          { role: "user", content: [{ type: "text", text: "ping" }] },
        ],
      }),
    ).rejects.toThrow("request intercepted");
    expect(requestedURL).toBe(
      "https://api.minimax.io/anthropic/v1/messages",
    );
  });

  it("does not use api.minimax.chat domain", () => {
    const provider = PROVIDERS.find((p) => p.id === "minimax");
    expect(provider!.consoleUrl).not.toContain("minimax.chat");
  });
});
