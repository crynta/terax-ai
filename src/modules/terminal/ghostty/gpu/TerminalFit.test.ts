import { describe, expect, it } from "vitest";
import { fitTerminalViewport, snapOffsetCss } from "./TerminalFit";
import { deriveFontMetrics, type TerminalFontMetrics } from "./terminalVisuals";

const FONT = {
  family: "JetBrains Mono",
  size: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  weight: "400",
} as const;
const RATIOS = [1, 1.25, 1.5, 1.75, 2, 2.25, 3] as const;

function metricsAt(scale: number): TerminalFontMetrics {
  return deriveFontMetrics(FONT, scale, {
    advance: 8.4 * scale,
    ascent: 11 * scale,
    descent: 3 * scale,
  });
}

describe("fitTerminalViewport", () => {
  it.each(RATIOS)(
    "fits whole integer device cells and sizes the canvas 1:1 at %s",
    (scale) => {
      const metrics = metricsAt(scale);
      const fit = fitTerminalViewport(731.4, 431.7, metrics);
      expect(fit).not.toBeNull();
      if (!fit) return;
      expect(Number.isInteger(fit.pixelWidth)).toBe(true);
      expect(fit.pixelWidth).toBe(fit.cols * metrics.deviceCellWidth);
      expect(fit.pixelHeight).toBe(fit.rows * metrics.deviceCellHeight);
      // CSS size times ratio is the backing size, so nothing is resampled.
      expect(fit.cssWidth * scale).toBeCloseTo(fit.pixelWidth, 9);
      expect(fit.cssHeight * scale).toBeCloseTo(fit.pixelHeight, 9);
      // The whole grid fits and one more cell would not.
      expect(fit.pixelWidth).toBeLessThanOrEqual(Math.round(731.4 * scale) + 1);
      expect(fit.pixelWidth + metrics.deviceCellWidth).toBeGreaterThan(
        Math.round(731.4 * scale),
      );
    },
  );

  it("prefers the engine's device-pixel content box over CSS rounding", () => {
    const metrics = metricsAt(1.25);
    const css = fitTerminalViewport(800, 400, metrics);
    const device = fitTerminalViewport(800, 400, metrics, {
      width: 1000 - 1,
      height: 500,
    });
    expect(css?.cols).toBe(Math.floor(1000 / metrics.deviceCellWidth));
    expect(device?.cols).toBe(Math.floor(999 / metrics.deviceCellWidth));
  });

  it("round-trips CSS and device sizes without drift", () => {
    for (const scale of RATIOS) {
      const metrics = metricsAt(scale);
      for (const cols of [2, 80, 117, 512]) {
        const cssWidth = (cols * metrics.deviceCellWidth) / scale;
        expect(Math.round(cssWidth * scale)).toBe(
          cols * metrics.deviceCellWidth,
        );
        expect(Math.floor(cssWidth / metrics.cellWidth + 1e-9)).toBe(cols);
      }
    }
  });

  it("tolerates browser subpixel noise at an exact cell boundary", () => {
    const metrics = metricsAt(2);
    const edge = (80 * metrics.deviceCellWidth) / 2;
    expect(fitTerminalViewport(edge - 0.004, 432, metrics)).toMatchObject({
      cols: 80,
    });
  });

  it("does not create an overflowing two-column viewport for a tiny pane", () => {
    const metrics = metricsAt(2);
    expect(fitTerminalViewport(16.9, 100, metrics)).toBeNull();
    expect(fitTerminalViewport(100, 16.9, metrics)).toBeNull();
  });

  it("caps pathological layouts before they reach a renderer allocation", () => {
    const metrics = metricsAt(2);
    expect(fitTerminalViewport(100_000, 100_000, metrics)).toMatchObject({
      cols: 512,
      rows: 256,
      pixelWidth: 512 * metrics.deviceCellWidth,
      pixelHeight: 256 * metrics.deviceCellHeight,
    });
  });
});

describe("snapOffsetCss", () => {
  it.each(RATIOS)(
    "lands the canvas origin on a device pixel at %s",
    (scale) => {
      for (const origin of [0, 0.3, 41.25, 100.4, 233.333, 1000.99]) {
        const { x, y } = snapOffsetCss(origin, origin + 7.7, scale);
        const deviceX = (origin + x) * scale;
        const deviceY = (origin + 7.7 + y) * scale;
        expect(Math.abs(deviceX - Math.round(deviceX))).toBeLessThan(1e-6);
        expect(Math.abs(deviceY - Math.round(deviceY))).toBeLessThan(1e-6);
        // Never moves further than half a device pixel.
        expect(Math.abs(x * scale)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    },
  );

  it("does nothing for an aligned origin or invalid input", () => {
    expect(snapOffsetCss(40, 80, 1)).toEqual({ x: 0, y: 0 });
    expect(snapOffsetCss(40, 80, 2)).toEqual({ x: 0, y: 0 });
    expect(snapOffsetCss(Number.NaN, 4, 2).x).toBe(0);
    expect(snapOffsetCss(4, 4, 0)).toEqual({ x: 0, y: 0 });
  });
});
