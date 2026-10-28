import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveFontMetrics,
  devicePixelScale,
  measureTerminalFontSync,
  metricsEqual,
  metricsForScale,
} from "./terminalVisuals";

const FONT = {
  family: "JetBrains Mono",
  size: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  weight: "400",
} as const;

describe("deriveFontMetrics", () => {
  it.each([1, 1.25, 1.5, 1.75, 2, 2.25, 3])(
    "produces integer device cells whose CSS size round-trips at %s",
    (scale) => {
      const metrics = deriveFontMetrics(FONT, scale, {
        advance: 8.4 * scale,
        ascent: 10.9 * scale,
        descent: 3.1 * scale,
      });
      expect(Number.isInteger(metrics.deviceCellWidth)).toBe(true);
      expect(Number.isInteger(metrics.deviceCellHeight)).toBe(true);
      expect(Number.isInteger(metrics.deviceBaseline)).toBe(true);
      expect(metrics.deviceCellWidth).toBe(Math.ceil(8.4 * scale - 0.001));
      expect(metrics.cellWidth * scale).toBeCloseTo(metrics.deviceCellWidth, 9);
      expect(metrics.cellHeight * scale).toBeCloseTo(
        metrics.deviceCellHeight,
        9,
      );
      expect(metrics.baseline * scale).toBeCloseTo(metrics.deviceBaseline, 9);
      expect(metrics.deviceBaseline).toBeLessThanOrEqual(
        metrics.deviceCellHeight,
      );
    },
  );

  it("does not spend a pixel on floating-point noise at an exact advance", () => {
    const metrics = deriveFontMetrics(FONT, 2, {
      advance: 18.000000000000004,
      ascent: 20,
      descent: 6,
    });
    expect(metrics.deviceCellWidth).toBe(18);
  });

  it("scales letter spacing with the ratio and keeps line height at least the glyph extent", () => {
    const spaced = deriveFontMetrics({ ...FONT, letterSpacing: 1 }, 1.5, {
      advance: 12.6,
      ascent: 15,
      descent: 5,
    });
    expect(spaced.deviceCellWidth).toBe(Math.ceil(12.6 + 1.5 - 0.001));
    const tight = deriveFontMetrics({ ...FONT, lineHeight: 0.5 }, 1, {
      advance: 8,
      ascent: 11,
      descent: 3,
    });
    expect(tight.deviceCellHeight).toBe(16);
  });
});

describe("metrics reuse", () => {
  afterEach(() => vi.unstubAllGlobals());

  function canvasStub() {
    const context = {
      font: "",
      measureText: vi.fn(() => ({
        width:
          (8.4 *
            Number.parseFloat(/([\d.]+)px/.exec(context.font)?.[1] ?? "1")) /
          14,
        actualBoundingBoxAscent: 11,
        actualBoundingBoxDescent: 3,
      })),
    };
    return { context, element: { getContext: () => context } };
  }

  it("measures at font size times ratio and reuses metrics at the same ratio", () => {
    const { context, element } = canvasStub();
    vi.stubGlobal("document", { createElement: () => element });
    const at125 = measureTerminalFontSync(FONT, 1.25);
    expect(context.font).toContain("17.5px");
    expect(at125.scale).toBe(1.25);
    expect(metricsForScale(at125, 1.25)).toBe(at125);
    const at2 = metricsForScale(at125, 2);
    expect(at2.scale).toBe(2);
    expect(at2).not.toBe(at125);
    expect(metricsEqual(at125, at2)).toBe(false);
    expect(metricsEqual(at125, { ...at125 })).toBe(true);
  });

  it("re-measures metrics that lack device sizes", () => {
    const { element } = canvasStub();
    vi.stubGlobal("document", { createElement: () => element });
    const legacy = {
      font: FONT,
      cellWidth: 8,
      cellHeight: 16,
      baseline: 12,
    } as never;
    const metrics = metricsForScale(legacy, 1);
    expect(Number.isInteger(metrics.deviceCellWidth)).toBe(true);
  });

  it("clamps the ratio like the renderers do", () => {
    vi.stubGlobal("window", { devicePixelRatio: 0.5 });
    expect(devicePixelScale()).toBe(1);
    vi.stubGlobal("window", { devicePixelRatio: 1.25 });
    expect(devicePixelScale()).toBe(1.25);
    vi.stubGlobal("window", { devicePixelRatio: Number.NaN });
    expect(devicePixelScale()).toBe(1);
  });
});
