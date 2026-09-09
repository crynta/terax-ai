import { describe, expect, it } from "vitest";
import { fitTerminalViewport } from "./TerminalFit";
import type { TerminalFontMetrics } from "./terminalVisuals";

const metrics: TerminalFontMetrics = {
  font: {
    family: "JetBrains Mono",
    size: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  cellWidth: 9,
  cellHeight: 18,
  baseline: 14,
};

describe("fitTerminalViewport", () => {
  it("fits whole cells and preserves a fractional DPR in backing pixels", () => {
    expect(fitTerminalViewport(731, 431, metrics, 1.5)).toEqual({
      cols: 81,
      rows: 23,
      cssWidth: 729,
      cssHeight: 414,
      pixelWidth: 1094,
      pixelHeight: 621,
    });
  });

  it("tolerates browser subpixel noise at an exact cell boundary", () => {
    expect(fitTerminalViewport(719.995, 432, metrics, 2)).toMatchObject({
      cols: 80,
      rows: 24,
      cssWidth: 720,
      cssHeight: 432,
    });
  });

  it("does not create an overflowing two-column viewport for a tiny pane", () => {
    expect(fitTerminalViewport(17.9, 100, metrics, 2)).toBeNull();
    expect(fitTerminalViewport(100, 17.9, metrics, 2)).toBeNull();
  });

  it("caps pathological layouts before they reach a renderer allocation", () => {
    expect(fitTerminalViewport(100_000, 100_000, metrics, 2)).toMatchObject({
      cols: 512,
      rows: 256,
      pixelWidth: 9_216,
      pixelHeight: 9_216,
    });
  });
});
