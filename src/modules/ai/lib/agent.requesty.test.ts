import { describe, expect, it } from "vitest";
import { EMPTY_PROVIDER_KEYS } from "./keyring";
import { buildConfiguredLanguageModel } from "./agent";

const keys = { ...EMPTY_PROVIDER_KEYS, requesty: "test-key" };

describe("buildConfiguredLanguageModel requesty-custom", () => {
  it("uses the configured Requesty model id", async () => {
    const model = await buildConfiguredLanguageModel("requesty-custom", keys, {
      requestyModelId: "  openai/gpt-4o-mini  ",
    });
    expect(typeof model === "object" && model.modelId).toBe(
      "openai/gpt-4o-mini",
    );
  });

  it("rejects a missing Requesty model id", () => {
    expect(() =>
      buildConfiguredLanguageModel("requesty-custom", keys, {
        requestyModelId: "  ",
      }),
    ).toThrow(/Requesty: no model id set/);
  });
});
