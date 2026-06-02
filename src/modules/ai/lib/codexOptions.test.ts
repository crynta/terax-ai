import { describe, expect, it } from "vitest";
import { buildCodexProviderOptions } from "./codexOptions";

describe("buildCodexProviderOptions", () => {
  it("maps reasoning and only enables Fast for supported Codex models", () => {
    expect(
      buildCodexProviderOptions(
        "extra-high",
        "fast",
        "gpt-5.4",
        "Use Terax tools.",
        "session-1",
      ).openai,
    ).toMatchObject({
      store: false,
      reasoningEffort: "xhigh",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
      instructions: "Use Terax tools.",
      promptCacheKey: "session-1",
      serviceTier: "priority",
    });

    expect(
      buildCodexProviderOptions("high", "fast", "gpt-5.3-codex-spark").openai,
    ).toEqual({
      store: false,
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    });
  });
});
