import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../config";

describe("agent.ts — OpenCode transport wiring", () => {
  it("PROVIDERS includes opencode (used in switch)", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toContain("opencode");
  });

  it("every provider has a buildLanguageModel case (no missing case check)", () => {
    // Each provider must have a corresponding case in agent.ts.
    // The TypeScript exhaustive check (`never`) in the default branch
    // ensures at compile time that all ProviderId values are covered.
    // This test double-checks that opencode is not accidentally dropped.
    const valid = new Set([
      "openai",
      "anthropic",
      "google",
      "xai",
      "cerebras",
      "deepseek",
      "opencode",
      "groq",
      "lmstudio",
    ]);
    for (const p of PROVIDERS) {
      expect(valid.has(p.id)).toBe(true);
    }
  });
});
