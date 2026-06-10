/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { formatMismatchPercent } from "./visualDiff";

describe("visualDiff", () => {
  describe("formatMismatchPercent", () => {
    it("formats zero and small percentages", () => {
      expect(formatMismatchPercent(0)).toBe("0.00%");
      expect(formatMismatchPercent(0.001)).toBe("0.00%");
      expect(formatMismatchPercent(0.01)).toBe("0.01%");
    });

    it("formats mid-range percentages", () => {
      expect(formatMismatchPercent(50)).toBe("50.00%");
      expect(formatMismatchPercent(12.345)).toBe("12.35%");
    });

    it("formats high percentages", () => {
      expect(formatMismatchPercent(99.999)).toBe("100.00%");
      expect(formatMismatchPercent(100)).toBe("100.00%");
    });
  });
});
