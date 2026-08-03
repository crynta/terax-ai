import { describe, expect, it } from "vitest";
import { accentFor, SPACE_COLORS, spaceInitial } from "./spaceColor";

describe("accentFor", () => {
  it("returns the palette color for an in-range index", () => {
    expect(accentFor({ color: 0 })).toBe(SPACE_COLORS[0]);
    expect(accentFor({ color: SPACE_COLORS.length - 1 })).toBe(
      SPACE_COLORS[SPACE_COLORS.length - 1],
    );
  });

  it("falls back to the theme primary for out-of-range, negative, or unset colors", () => {
    expect(accentFor({ color: SPACE_COLORS.length })).toBe("var(--primary)");
    expect(accentFor({ color: -1 })).toBe("var(--primary)");
    expect(accentFor({})).toBe("var(--primary)");
  });
});

describe("spaceInitial", () => {
  it("uppercases the first non-whitespace character", () => {
    expect(spaceInitial("hi")).toBe("H");
    expect(spaceInitial("  bar")).toBe("B");
  });

  it("returns a placeholder for empty or whitespace-only names", () => {
    expect(spaceInitial("")).toBe("?");
    expect(spaceInitial("   ")).toBe("?");
  });
});
