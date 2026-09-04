import { describe, expect, it } from "vitest";
import { MAX_VISIBLE_LANES, railWidth } from "./GraphRail";

describe("railWidth", () => {
  it("uses the same minimum width for zero and one lane", () => {
    expect(railWidth(0)).toBe(railWidth(1));
  });

  it("grows as lanes are added", () => {
    expect(railWidth(2)).toBeGreaterThan(railWidth(1));
    expect(railWidth(3)).toBeGreaterThan(railWidth(2));
  });

  it("clamps the width once the visible-lane cap is reached", () => {
    const capped = railWidth(MAX_VISIBLE_LANES);
    expect(railWidth(MAX_VISIBLE_LANES + 1)).toBe(capped);
    expect(railWidth(100)).toBe(capped);
  });
});
