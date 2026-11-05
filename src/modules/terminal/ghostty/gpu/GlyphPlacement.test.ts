import { describe, expect, it, vi } from "vitest";
import {
  constraintFor,
  drawGlyph,
  type GlyphMeasure,
  GLYPH_CONSTRAINTS,
  IDENTITY_PLACEMENT,
  isExtendedSymbol,
  isPrivateUse,
  layoutGlyph,
  placeGlyph,
} from "./GlyphPlacement";

const CELL = { width: 9, height: 18, baseline: 14 };
const PADDING = 2;
const LIMIT = 256;

function measure(overrides: Partial<GlyphMeasure> = {}): GlyphMeasure {
  return { advance: 9, left: 0, right: 9, ascent: 14, descent: 3, ...overrides };
}

function place(text: string, ink: Partial<GlyphMeasure> = {}) {
  return placeGlyph(text, measure(ink), CELL.width, CELL.height);
}

describe("private-use ranges", () => {
  it("covers the BMP area and both supplementary planes", () => {
    for (const codepoint of [0xe000, 0xeb99, 0xf8ff, 0xf0000, 0xf024b, 0xffffd, 0x100000, 0x10fffd]) {
      expect(isPrivateUse(codepoint), codepoint.toString(16)).toBe(true);
    }
    for (const codepoint of [0x41, 0xdfff, 0xf900, 0xeffff, 0xffffe, 0x1f600, 0x10fffe]) {
      expect(isPrivateUse(codepoint), codepoint.toString(16)).toBe(false);
    }
  });

  it("names the Material Design plane for the lazily loaded face", () => {
    expect(isExtendedSymbol(0xf024b)).toBe(true);
    expect(isExtendedSymbol(0xe0a0)).toBe(false);
    expect(isExtendedSymbol(0x100000)).toBe(false);
  });
});

describe("constraint table", () => {
  it("is ordered, in range and free of overlaps", () => {
    let previousEnd = -1;
    for (const [from, to] of GLYPH_CONSTRAINTS) {
      expect(from).toBeLessThanOrEqual(to);
      expect(from).toBeGreaterThan(previousEnd);
      expect(isPrivateUse(from) && isPrivateUse(to)).toBe(true);
      previousEnd = to;
    }
  });

  it("keeps the version control icons as designed", () => {
    for (let codepoint = 0xe0a0; codepoint <= 0xe0a3; codepoint += 1) {
      expect(constraintFor(codepoint)).toEqual({ mode: "native" });
    }
  });

  it("stretches Powerline separators over one cell", () => {
    for (const codepoint of [
      ...Array.from({ length: 16 }, (_, index) => 0xe0b0 + index),
      0xe0d2,
      0xe0d4,
      0xe0d6,
      0xe0d7,
    ]) {
      expect(constraintFor(codepoint), codepoint.toString(16)).toEqual({
        mode: "stretch",
        span: 1,
      });
    }
  });

  it("stretches Powerline Extra flames, pixels, ice and honeycombs over two cells", () => {
    for (let codepoint = 0xe0c0; codepoint <= 0xe0cd; codepoint += 1) {
      expect(constraintFor(codepoint), codepoint.toString(16)).toEqual({
        mode: "stretch",
        span: 2,
      });
    }
  });

  it("treats the lego blocks and every other private-use glyph as icons", () => {
    for (const codepoint of [0xe0ce, 0xe0d0, 0xe0d1, 0xe000, 0xe718, 0xeb99, 0xf07b, 0xf024b]) {
      expect(constraintFor(codepoint), codepoint.toString(16)).toEqual({ mode: "icon" });
    }
  });
});

describe("placeGlyph", () => {
  it("leaves ordinary text exactly where the font put it", () => {
    expect(place("A", { right: 30 })).toBe(IDENTITY_PLACEMENT);
    expect(place("中", { advance: 18, right: 18 })).toBe(IDENTITY_PLACEMENT);
    expect(place("\u{1f600}", { advance: 18, right: 20 })).toBe(IDENTITY_PLACEMENT);
  });

  it("draws the version control icons as designed", () => {
    expect(place("\ue0a0", { right: 30, ascent: 40 })).toBe(IDENTITY_PLACEMENT);
  });

  it("lets an icon overflow into the blank cell after it, as Nerd Fonts design", () => {
    // About an em wide in a cell of 0.6 em: kept at its size and position.
    expect(place("\ue718", { right: 15 })).toBe(IDENTITY_PLACEMENT);
    expect(place("\ueb99", { right: 18 })).toBe(IDENTITY_PLACEMENT);
  });

  it("shrinks an icon only when it is wider than two cells or taller than the cell", () => {
    const wide = place("\uf07b", { right: 27 });
    expect(wide.scaleX).toBeCloseTo(18 / 27, 9);
    expect(wide.scaleY).toBe(wide.scaleX);
    const tall = place("\uf07b", { ascent: 20, descent: 8 });
    expect(tall.scaleX).toBeCloseTo(18 / 28, 9);
  });

  it("never enlarges a small icon", () => {
    expect(place("\ue000", { right: 5, ascent: 5, descent: 0 })).toBe(IDENTITY_PLACEMENT);
  });

  it("leaves a private-use character with a variation selector to the font", () => {
    expect(place("\ue0a0️", { right: 30 })).toBe(IDENTITY_PLACEMENT);
    expect(place("\ue718️", { right: 30 })).toBe(IDENTITY_PLACEMENT);
  });

  it("ignores a glyph with no ink", () => {
    expect(place("\ue718", { left: 0, right: 0 })).toBe(IDENTITY_PLACEMENT);
    expect(place("\ue0c0", { ascent: 0, descent: 0 })).toBe(IDENTITY_PLACEMENT);
  });

  it("stretches a separator over exactly one cell by the cell height", () => {
    const ink = { left: 0.3, right: 9.4, ascent: 15.2, descent: 3.1 };
    const placement = place("\ue0d6", ink);
    expect(placement.scaleX).toBeCloseTo(9 / 9.7, 9);
    expect(placement.scaleY).toBeCloseTo(18 / 18.3, 9);
    expect(placement.clip).toEqual({ width: 9, height: 18 });
  });

  it("stretches a Powerline Extra over exactly two cells", () => {
    const placement = place("\ue0c0", { left: 0.1, right: 21.7, ascent: 16, descent: 4 });
    expect(placement.scaleX).toBeCloseTo(18 / 21.8, 9);
    expect(placement.clip).toEqual({ width: 18, height: 18 });
  });

  it("maps the ink box of every stretched glyph onto its cell box, whatever the metrics", () => {
    for (const codepoint of [0xe0c0, 0xe0c4, 0xe0cd, 0xe0d6, 0xe0d7]) {
      for (let cellWidth = 6; cellWidth <= 24; cellWidth += 3) {
        for (const cellHeight of [10, 17, 23, 31]) {
          for (const left of [-2, 0, 0.7]) {
            const ink = measure({ left, right: cellWidth * 1.9, ascent: cellHeight * 0.8, descent: cellHeight * 0.25 });
            const text = String.fromCodePoint(codepoint);
            const placement = placeGlyph(text, ink, cellWidth, cellHeight);
            const layout = layoutGlyph(ink, placement, { width: cellWidth, height: cellHeight, baseline: cellHeight * 0.8 }, PADDING, LIMIT);
            const span = constraintFor(codepoint);
            const cells = span.mode === "stretch" ? span.span : 1;
            const inkLeft = layout.penX - ink.left * layout.scaleX;
            const inkRight = layout.penX + ink.right * layout.scaleX;
            const inkTop = layout.baselineY - ink.ascent * layout.scaleY;
            const inkBottom = layout.baselineY + ink.descent * layout.scaleY;
            expect(inkLeft).toBeCloseTo(PADDING, 6);
            expect(inkRight).toBeCloseTo(PADDING + cellWidth * cells, 6);
            expect(inkTop).toBeCloseTo(PADDING, 6);
            expect(inkBottom).toBeCloseTo(PADDING + cellHeight, 6);
          }
        }
      }
    }
  });
});

describe("layoutGlyph", () => {
  it("measures ordinary text as every renderer did before: whole-pixel ink plus padding", () => {
    const layout = layoutGlyph(
      measure({ left: 1.2, right: 8.4, ascent: 11.1, descent: 3.2 }),
      IDENTITY_PLACEMENT,
      CELL,
      PADDING,
      LIMIT,
    );
    expect(layout).toMatchObject({
      width: 2 + 9 + 2 * PADDING,
      height: 12 + 4 + 2 * PADDING,
      bearingX: -2 - PADDING,
      bearingY: CELL.baseline - 12 - PADDING,
      penX: PADDING + 2,
      baselineY: PADDING + 12,
      scaleX: 1,
      scaleY: 1,
      clip: null,
    });
  });

  it("falls back to the cell when the engine reports no extents", () => {
    const layout = layoutGlyph(
      { advance: 9, left: 0, right: 0, ascent: 0, descent: 0 },
      IDENTITY_PLACEMENT,
      CELL,
      PADDING,
      LIMIT,
    );
    expect(layout.width).toBe(9 + 2 * PADDING);
    expect(layout.height).toBe(14 + 4 + 2 * PADDING);
  });

  it("caps the bitmap at the raster limit", () => {
    const layout = layoutGlyph(measure({ right: 400, ascent: 300 }), IDENTITY_PLACEMENT, CELL, PADDING, 64);
    expect(layout.width).toBe(64);
    expect(layout.height).toBe(64);
  });

  it("lays a stretched glyph out as its cell box plus padding, with a clip on that box", () => {
    const ink = { left: 0.1, right: 21.7, ascent: 16, descent: 4 };
    const placement = placeGlyph("\ue0c0", measure(ink), CELL.width, CELL.height);
    const layout = layoutGlyph(measure(ink), placement, CELL, PADDING, LIMIT);
    expect(layout).toMatchObject({
      width: 18 + 2 * PADDING,
      height: 18 + 2 * PADDING,
      bearingX: -PADDING,
      bearingY: -PADDING,
      clip: { x: PADDING, y: PADDING, width: 18, height: 18 },
    });
  });
});

describe("drawGlyph", () => {
  it("draws unscaled, unclipped text directly at the pen position", () => {
    const context = fakeContext();
    drawGlyph(context, "A", layoutGlyph(measure(), IDENTITY_PLACEMENT, CELL, PADDING, LIMIT));
    expect(context.fillText).toHaveBeenCalledWith("A", PADDING, PADDING + 14);
    expect(context.save).not.toHaveBeenCalled();
  });

  it("scales a shrunken icon about its pen origin and restores the context", () => {
    const calls: string[] = [];
    const context = fakeContext(calls);
    const ink = measure({ right: 27 });
    drawGlyph(context, "\uf07b", layoutGlyph(ink, place("\uf07b", ink), CELL, PADDING, LIMIT));
    expect(context.scale).toHaveBeenCalledWith(expect.closeTo(18 / 27, 9), expect.closeTo(18 / 27, 9));
    expect(context.fillText).toHaveBeenCalledWith("\uf07b", 0, 0);
    expect(calls).toEqual(["save", "translate", "scale", "fill", "restore"]);
  });

  it("clips a stretched glyph to its cell box so its edges are flush", () => {
    const calls: string[] = [];
    const context = fakeContext(calls);
    const ink = measure({ left: 0.1, right: 21.7, ascent: 16, descent: 4 });
    drawGlyph(context, "\ue0c0", layoutGlyph(ink, place("\ue0c0", ink), CELL, PADDING, LIMIT));
    expect(context.rect).toHaveBeenCalledWith(PADDING, PADDING, 18, 18);
    expect(calls).toEqual(["save", "beginPath", "rect", "clip", "translate", "scale", "fill", "restore"]);
  });
});

function fakeContext(calls: string[] = []) {
  const note = (name: string) => vi.fn(() => calls.push(name));
  return {
    fillText: note("fill"),
    save: note("save"),
    restore: note("restore"),
    translate: note("translate"),
    scale: note("scale"),
    beginPath: note("beginPath"),
    rect: note("rect"),
    clip: note("clip"),
  };
}
