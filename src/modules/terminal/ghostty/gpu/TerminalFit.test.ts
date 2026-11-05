import { describe, expect, it } from "vitest";
import {
  fitTerminalViewport,
  snapOffsetCss,
  TERMINAL_RIGHT_GUTTER_CSS_PX,
} from "./TerminalFit";
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

describe("fitTerminalViewport right gutter", () => {
  const GUTTER = TERMINAL_RIGHT_GUTTER_CSS_PX;

  it.each(RATIOS)(
    "always leaves at least the gutter free to the right of the grid at %s",
    (scale) => {
      const metrics = metricsAt(scale);
      for (let width = 120; width <= 1400; width += 7.3) {
        const fit = fitTerminalViewport(width, 400, metrics, null, GUTTER);
        if (!fit) continue;
        const free = width * scale - fit.pixelWidth;
        expect(free, `${width}px`).toBeGreaterThanOrEqual(
          Math.round(GUTTER * scale) - 0.02,
        );
      }
    },
  );

  it("takes the gutter from the device box where the engine reports one", () => {
    const metrics = metricsAt(2);
    const plain = fitTerminalViewport(700, 400, metrics, {
      width: 1400,
      height: 800,
    });
    const gutter = fitTerminalViewport(
      700,
      400,
      metrics,
      { width: 1400, height: 800 },
      GUTTER,
    );
    expect(gutter?.cols).toBeLessThan(plain?.cols ?? 0);
    expect(1400 - (gutter?.pixelWidth ?? 0)).toBeGreaterThanOrEqual(GUTTER * 2);
  });

  it("changes nothing without a gutter", () => {
    const metrics = metricsAt(1.25);
    expect(fitTerminalViewport(500, 300, metrics, null, 0)).toEqual(
      fitTerminalViewport(500, 300, metrics),
    );
  });

  it("gives the gutter up in a pane too narrow for two columns beside it", () => {
    const metrics = metricsAt(1);
    const narrow = 2 * metrics.deviceCellWidth + GUTTER - 1;
    const fit = fitTerminalViewport(narrow, 100, metrics, null, GUTTER);
    expect(fit?.cols).toBe(
      2 + Math.floor((GUTTER - 1) / metrics.deviceCellWidth),
    );
    expect(
      fitTerminalViewport(narrow - 6, 100, metrics, null, GUTTER),
    ).not.toBeNull();
    expect(
      fitTerminalViewport(metrics.deviceCellWidth, 100, metrics, null, GUTTER),
    ).toBeNull();
  });

  it("keeps a half-width split pane clear of its edge by more than a column", () => {
    // A 1440 px window split in two: each pane is about 718 px wide.
    const metrics = metricsAt(2);
    const fit = fitTerminalViewport(718.5, 800, metrics, null, GUTTER);
    expect(718.5 * 2 - (fit?.pixelWidth ?? 0)).toBeGreaterThanOrEqual(
      GUTTER * 2,
    );
  });
});

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
