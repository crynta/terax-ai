import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  MODELS,
  MODEL_CONTEXT_LIMITS,
  getProvider,
  getModel,
  providerNeedsKey,
  getModelContextLimit,
  KEYLESS_PROVIDERS,
  getOpenCodeBaseURL,
  isOpenCodeModel,
  stripOpenCodePrefix,
  type ProviderId,
} from "../config";

const OPENCODE_PROVIDER_ID: ProviderId = "opencode";

describe("config.ts — OpenCode provider", () => {
  describe("PROVIDERS", () => {
    it("includes an opencode entry", () => {
      const entry = PROVIDERS.find((p) => p.id === OPENCODE_PROVIDER_ID);
      expect(entry).toBeDefined();
    });

    it("has correct opencode metadata", () => {
      const entry = PROVIDERS.find((p) => p.id === OPENCODE_PROVIDER_ID)!;
      expect(entry.label).toBe("OpenCode");
      expect(entry.keyringAccount).toBe("opencode-api-key");
      expect(entry.keyPrefix).toBeNull();
      expect(entry.consoleUrl).toBe("https://opencode.ai/settings/api-keys");
    });

    it("is NOT in KEYLESS_PROVIDERS", () => {
      expect(KEYLESS_PROVIDERS).not.toContain(OPENCODE_PROVIDER_ID);
    });
  });

  describe("getProvider", () => {
    it("returns opencode info", () => {
      const info = getProvider("opencode");
      expect(info.id).toBe("opencode");
      expect(info.label).toBe("OpenCode");
    });

    it("throws for unknown provider", () => {
      expect(() => getProvider("unknown" as ProviderId)).toThrow();
    });
  });

  describe("MODELS", () => {
    it("includes opencode-custom entry", () => {
      const model = MODELS.find((m) => m.id === "opencode-custom");
      expect(model).toBeDefined();
      expect(model!.provider).toBe("opencode");
      expect(model!.label).toBe("OpenCode");
      expect(model!.hint).toBe("User-configured model");
    });

    it("has unique model IDs across all providers", () => {
      const ids = MODELS.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("getModel", () => {
    it("returns opencode-custom model info", () => {
      const m = getModel("opencode-custom");
      expect(m.provider).toBe("opencode");
      expect(m.id).toBe("opencode-custom");
    });

    it("throws for unknown model", () => {
      expect(() => getModel("nonexistent" as never)).toThrow();
    });
  });

  describe("MODEL_CONTEXT_LIMITS", () => {
    it("does not have hardcoded limits for opencode models", () => {
      expect(MODEL_CONTEXT_LIMITS).not.toHaveProperty("opencode-custom");
    });
  });

  describe("getModelContextLimit", () => {
    it("returns default for opencode-custom (no hardcoded limit)", () => {
      expect(getModelContextLimit("opencode-custom")).toBe(128_000);
    });

    it("returns default for undefined model", () => {
      expect(getModelContextLimit(undefined)).toBe(128_000);
    });

    it("returns default for unknown model id", () => {
      expect(getModelContextLimit("unknown-model")).toBe(128_000);
    });
  });

  describe("providerNeedsKey", () => {
    it("returns true for opencode", () => {
      expect(providerNeedsKey("opencode")).toBe(true);
    });
  });

  describe("base URL helpers", () => {
    it("getOpenCodeBaseURL returns correct URLs", () => {
      expect(getOpenCodeBaseURL("go")).toBe("https://opencode.ai/zen/go/v1");
      expect(getOpenCodeBaseURL("zen")).toBe("https://opencode.ai/zen/v1");
    });
  });

  describe("model ID helpers", () => {
    it("isOpenCodeModel detects opencode model IDs", () => {
      expect(isOpenCodeModel("opencode-go:deepseek-v4-flash")).toBe(true);
      expect(isOpenCodeModel("opencode-zen:gpt-5.5")).toBe(true);
      expect(isOpenCodeModel("gpt-5.4-mini")).toBe(false);
      expect(isOpenCodeModel("opencode-custom")).toBe(false);
    });

    it("stripOpenCodePrefix removes mode prefix", () => {
      expect(stripOpenCodePrefix("opencode-go:deepseek-v4-flash")).toBe(
        "deepseek-v4-flash",
      );
      expect(stripOpenCodePrefix("opencode-zen:gpt-5.5")).toBe("gpt-5.5");
      expect(stripOpenCodePrefix("plain-model")).toBe("plain-model");
    });
  });
});
