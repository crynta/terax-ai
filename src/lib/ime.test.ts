import { describe, expect, it } from "vitest";
import { isImeComposing } from "./ime";

describe("isImeComposing", () => {
  it("is true while a candidate is being composed (isComposing set)", () => {
    // Enter pressed to confirm an IME candidate: must be treated as composition.
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it("is true for Chromium's 229 'Process' keyCode before isComposing is set", () => {
    // macOS reports this for the Enter that confirms a candidate (#873).
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("is false for a plain Enter outside composition", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("is false for ordinary character typing", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 65 })).toBe(false);
  });
});
