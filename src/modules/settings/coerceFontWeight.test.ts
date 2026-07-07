import { describe, expect, it } from "vitest";
import { coerceFontWeight } from "./store";

describe("coerceFontWeight", () => {
  it("keeps supported weights", () => {
    for (const w of ["normal", "500", "600", "bold"]) {
      expect(coerceFontWeight(w)).toBe(w);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(coerceFontWeight("  bold  ")).toBe("bold");
  });

  it("falls back to normal for unsupported or empty values", () => {
    expect(coerceFontWeight("")).toBe("normal");
    expect(coerceFontWeight("900")).toBe("normal");
    expect(coerceFontWeight("heavy")).toBe("normal");
  });
});
