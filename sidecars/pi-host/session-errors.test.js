import { describe, expect, it } from "vitest";
import { friendlySessionErrorMessage } from "./session-errors.js";

describe("friendlySessionErrorMessage", () => {
  it("turns API key failures into a provider setup action", () => {
    expect(
      friendlySessionErrorMessage(
        new Error("401 Unauthorized: invalid API key"),
      ),
    ).toBe(
      "Provider authentication failed. Open Settings > Models and check the selected Pi provider key.",
    );
  });

  it("turns unavailable model failures into a model setup action", () => {
    expect(
      friendlySessionErrorMessage(
        new Error("model is not available: anthropic/old-model"),
      ),
    ).toBe(
      "Selected Pi model is not available. Open Settings > Models and choose another model.",
    );
  });

  it("preserves unknown errors", () => {
    expect(friendlySessionErrorMessage(new Error("network offline"))).toBe(
      "network offline",
    );
  });
});
