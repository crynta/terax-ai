import { describe, expect, it } from "vitest";
import {
  applyTextContrast,
  DWRITE_GAMMA_RATIOS,
  NO_TEXT_CONTRAST,
  textContrastFor,
} from "./textContrast";

const WHITE = [1, 1, 1] as const;
const BLACK = [0, 0, 0] as const;
const ACTIVE = { enhancedContrast: 0.5, alphaCorrection: 0.5 };

describe("text contrast policy", () => {
  it("is off by default so both renderers draw the same glyph pixels", () => {
    expect(textContrastFor(undefined)).toBe(NO_TEXT_CONTRAST);
    expect(textContrastFor(null)).toBe(NO_TEXT_CONTRAST);
    expect(textContrastFor("")).toBe(NO_TEXT_CONTRAST);
  });

  it("honours an explicit override and ignores nonsense", () => {
    expect(textContrastFor("off")).toBe(NO_TEXT_CONTRAST);
    expect(textContrastFor("0")).toBe(NO_TEXT_CONTRAST);
    expect(textContrastFor("on")).toEqual(ACTIVE);
    expect(textContrastFor("1.5")).toEqual({
      enhancedContrast: 1.5,
      alphaCorrection: 0.5,
    });
    expect(textContrastFor("9")).toEqual({
      enhancedContrast: 4,
      alphaCorrection: 0.5,
    });
    expect(textContrastFor("banana")).toBe(NO_TEXT_CONTRAST);
    expect(textContrastFor("-3")).toBe(NO_TEXT_CONTRAST);
  });
});

describe("DirectWrite style curve", () => {
  it("is the identity at zero strength", () => {
    for (const coverage of [0, 0.2, 0.5, 1]) {
      expect(applyTextContrast(coverage, WHITE, NO_TEXT_CONTRAST)).toBe(
        coverage,
      );
    }
  });

  it("fixes the endpoints and never leaves [0, 1]", () => {
    for (const color of [WHITE, BLACK, [0.2, 0.6, 0.9] as const]) {
      expect(applyTextContrast(0, color, ACTIVE)).toBe(0);
      expect(applyTextContrast(1, color, ACTIVE)).toBeCloseTo(1, 9);
      for (let step = 0; step <= 100; step += 1) {
        const value = applyTextContrast(step / 100, color, ACTIVE);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is monotonic in coverage", () => {
    for (const color of [WHITE, BLACK]) {
      let previous = -1;
      for (let step = 0; step <= 200; step += 1) {
        const value = applyTextContrast(step / 200, color, ACTIVE);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = value;
      }
    }
  });

  it("strengthens light text on dark and weakens dark text, with lightness dependent boost", () => {
    const light = applyTextContrast(0.5, WHITE, ACTIVE);
    const dark = applyTextContrast(0.5, BLACK, ACTIVE);
    expect(light).toBeGreaterThan(0.5);
    expect(dark).toBeLessThan(light);
    // Enhanced contrast alone boosts dark text more than light text.
    const enhancedOnly = { enhancedContrast: 1, alphaCorrection: 0 };
    expect(applyTextContrast(0.3, BLACK, enhancedOnly)).toBeGreaterThan(
      applyTextContrast(0.3, WHITE, enhancedOnly),
    );
    expect(applyTextContrast(0.3, WHITE, enhancedOnly)).toBeCloseTo(0.3, 9);
  });

  it("matches the published Windows Terminal formula", () => {
    const [g0, g1, g2, g3] = DWRITE_GAMMA_RATIOS;
    const coverage = 0.4;
    const color = [0.1, 0.2, 0.3] as const;
    const lightness = 0.1 * 0.3 + 0.2 * 0.59 + 0.3 * 0.11;
    const k = 1 * Math.min(1, Math.max(0, 4 * (0.75 - lightness)));
    const enhanced = (coverage * (k + 1)) / (coverage * k + 1);
    const intensity = 0.1 * 0.25 + 0.2 * 0.5 + 0.3 * 0.25;
    const corrected =
      enhanced +
      enhanced *
        (1 - enhanced) *
        ((g0 * intensity + g1) * enhanced + (g2 * intensity + g3));
    expect(
      applyTextContrast(coverage, color, {
        enhancedContrast: 1,
        alphaCorrection: 1,
      }),
    ).toBeCloseTo(corrected, 12);
  });
});
