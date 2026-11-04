import { afterEach, describe, expect, it, vi } from "vitest";

const fonts = vi.hoisted(() => ({ pending: true }));
vi.mock("@/lib/fonts", () => ({
  extendedSymbolsPending: () => fonts.pending,
}));

import { GlyphRasterizer } from "./GlyphRasterizer";
import { deriveFontMetrics } from "./terminalVisuals";

const METRICS = deriveFontMetrics(
  {
    family: '"JetBrains Mono", monospace',
    size: 14,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  1,
  { advance: 8.4, ascent: 11, descent: 3 },
);

function stub(ink: { left: number; right: number; advance: number }) {
  const drawn: Array<[string, number, number]> = [];
  const transforms: string[] = [];
  const context = {
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    font: "",
    clearRect: () => undefined,
    save: () => transforms.push("save"),
    restore: () => transforms.push("restore"),
    translate: (x: number, y: number) => transforms.push(`translate ${x} ${y}`),
    scale: (x: number) => transforms.push(`scale ${x.toFixed(3)}`),
    fillText: (text: string, x: number, y: number) => drawn.push([text, x, y]),
    measureText: () => ({
      width: ink.advance,
      actualBoundingBoxLeft: ink.left,
      actualBoundingBoxRight: ink.right,
      actualBoundingBoxAscent: 11,
      actualBoundingBoxDescent: 3,
    }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    }),
  };
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  return { drawn, transforms };
}

describe("GlyphRasterizer private-use symbols", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fonts.pending = true;
  });

  it("draws nothing for a Material Design icon until its face has loaded", () => {
    const { drawn } = stub({ left: 0, right: 8, advance: 8.4 });
    const glyph = new GlyphRasterizer(METRICS).rasterize("\u{f024b}", 0);
    expect(glyph.width * glyph.height).toBe(1);
    expect(glyph.pixels[0]).toBe(0);
    expect(drawn).toEqual([]);
  });

  it("rasterizes the icon once the face has loaded", () => {
    fonts.pending = false;
    const { drawn } = stub({ left: 0, right: 8, advance: 8.4 });
    const glyph = new GlyphRasterizer(METRICS).rasterize("\u{f024b}", 0);
    expect(drawn).toHaveLength(1);
    expect(glyph.width).toBeGreaterThan(1);
  });

  it("never waits for the face on other private-use icons or text", () => {
    const { drawn } = stub({ left: 0, right: 8, advance: 8.4 });
    const rasterizer = new GlyphRasterizer(METRICS);
    rasterizer.rasterize("", 0);
    rasterizer.rasterize("a", 0);
    expect(drawn.map(([text]) => text)).toEqual(["", "a"]);
  });

  it("shrinks an icon that overflows the cell so it cannot reach the neighbour", () => {
    fonts.pending = false;
    const { transforms } = stub({ left: 0, right: 16.8, advance: 8.4 });
    const glyph = new GlyphRasterizer(METRICS).rasterize("", 0);
    expect(transforms).toContain("scale 0.536");
    expect(glyph.width).toBeLessThanOrEqual(
      METRICS.deviceCellWidth + 2 * 2 + 1,
    );
  });

  it("leaves a cell-sized icon unscaled", () => {
    fonts.pending = false;
    const { transforms } = stub({ left: 0, right: 8.4, advance: 8.4 });
    new GlyphRasterizer(METRICS).rasterize("", 0);
    expect(transforms).toEqual([]);
  });
});
