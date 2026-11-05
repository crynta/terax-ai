import { describe, expect, it, vi } from "vitest";
import {
  drawGlyph,
  type GlyphMeasure,
  glyphBounds,
  IDENTITY_PLACEMENT,
  isExtendedSymbol,
  isPrivateUse,
  placeGlyph,
} from "./GlyphPlacement";

const CELL = { width: 9, height: 18 };

function measure(overrides: Partial<GlyphMeasure> = {}): GlyphMeasure {
  return {
    advance: 9,
    left: 0,
    right: 9,
    ascent: 14,
    descent: 3,
    ...overrides,
  };
}

describe("private-use ranges", () => {
  it("covers the BMP area and both supplementary planes", () => {
    for (const codepoint of [
      0xe000, 0xeb99, 0xf8ff, 0xf0000, 0xf024b, 0xffffd, 0x100000, 0x10fffd,
    ]) {
      expect(isPrivateUse(codepoint), codepoint.toString(16)).toBe(true);
    }
    for (const codepoint of [
      0x41, 0xdfff, 0xf900, 0xeffff, 0xffffe, 0x1f600, 0x10fffe,
    ]) {
      expect(isPrivateUse(codepoint), codepoint.toString(16)).toBe(false);
    }
  });

  it("names the Material Design plane for the lazily loaded face", () => {
    expect(isExtendedSymbol(0xf024b)).toBe(true);
    expect(isExtendedSymbol(0xe0a0)).toBe(false);
    expect(isExtendedSymbol(0x100000)).toBe(false);
  });
});

describe("placeGlyph", () => {
  it("leaves ordinary text exactly where the font put it", () => {
    expect(
      placeGlyph("A", measure({ right: 30 }), CELL.width, CELL.height),
    ).toBe(IDENTITY_PLACEMENT);
    expect(placeGlyph("中", measure({ advance: 18, right: 18 }), 9, 18)).toBe(
      IDENTITY_PLACEMENT,
    );
    expect(
      placeGlyph("\u{1f600}", measure({ advance: 18, right: 20 }), 9, 18),
    ).toBe(IDENTITY_PLACEMENT);
  });

  it("keeps a cell-sized icon in place, clipped to its cell", () => {
    expect(placeGlyph("\ue0a0", measure(), CELL.width, CELL.height)).toEqual({
      scale: 1,
      shiftX: 0,
      room: CELL.width,
    });
  });

  it("shrinks an icon wider than its cell instead of overflowing into the neighbour", () => {
    const placement = placeGlyph(
      "\ueb99",
      measure({ advance: 9, left: 0, right: 14 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBeCloseTo(9 / 14, 6);
    const bounds = glyphBounds(measure({ advance: 9, right: 14 }), placement, {
      width: 9,
      ascent: 14,
      descent: 4,
    });
    expect(bounds.leftExtent).toBe(0);
    expect(bounds.rightExtent).toBeLessThanOrEqual(CELL.width);
  });

  it("shrinks an icon taller than the cell", () => {
    const placement = placeGlyph(
      "\ue718",
      measure({ ascent: 20, descent: 8 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBeCloseTo(18 / 28, 6);
  });

  it("never enlarges a small icon", () => {
    const placement = placeGlyph(
      "\uf024b".length === 1 ? "\ue000" : "\ue000",
      measure({ advance: 9, left: 0, right: 5, ascent: 5, descent: 0 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBe(1);
  });

  it("centres an icon whose font advance differs from the cell, on whole pixels", () => {
    const placement = placeGlyph(
      "\ue0a0",
      measure({ advance: 5, right: 5 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBe(1);
    expect(placement.shiftX).toBe(2);
    expect(Number.isInteger(placement.shiftX)).toBe(true);
    // Sub-pixel slack is ignored rather than blurring the icon.
    expect(
      placeGlyph("\ue0a0", measure({ advance: 8.4 }), CELL.width, CELL.height),
    ).toMatchObject({ scale: 1, shiftX: 0 });
  });

  it("keeps two cells for a double-width font", () => {
    const placement = placeGlyph(
      "\ue0a0",
      measure({ advance: 18, left: 0, right: 17 }),
      CELL.width,
      CELL.height,
    );
    expect(placement).toEqual({ scale: 1, shiftX: 0, room: 18 });
    const wider = placeGlyph(
      "\ue0a0",
      measure({ advance: 18, left: 0, right: 27 }),
      CELL.width,
      CELL.height,
    );
    expect(wider.scale).toBeCloseTo(18 / 27, 6);
  });

  it("leaves a private-use character with a variation selector to the font", () => {
    expect(
      placeGlyph("\ue0a0️", measure({ right: 30 }), CELL.width, CELL.height),
    ).toBe(IDENTITY_PLACEMENT);
  });

  it("ignores a glyph with no ink", () => {
    expect(
      placeGlyph("\ue0a0", measure({ left: 0, right: 0 }), CELL.width, CELL.height),
    ).toBe(IDENTITY_PLACEMENT);
  });

  it("always fits the ink inside the span for any icon and cell", () => {
    for (let cellWidth = 6; cellWidth <= 24; cellWidth += 3) {
      for (let right = 3; right <= 60; right += 7) {
        for (const advance of [
          cellWidth * 0.8,
          cellWidth,
          cellWidth * 1.2,
          cellWidth * 2,
        ]) {
          const m = measure({
            advance,
            left: 1,
            right,
            ascent: 12,
            descent: 5,
          });
          const placement = placeGlyph("\ue5fa", m, cellWidth, 20);
          const span = advance >= cellWidth * 1.5 ? 2 : 1;
          const inkLeft = placement.shiftX - m.left * placement.scale;
          const inkRight = placement.shiftX + m.right * placement.scale;
          expect(inkRight - inkLeft).toBeLessThanOrEqual(
            cellWidth * span + 1e-9,
          );
          expect(placement.scale).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("glyphBounds", () => {
  const fallback = { width: 9, ascent: 14, descent: 4 };

  it("matches the unplaced measurements of ordinary text", () => {
    expect(
      glyphBounds(
        measure({ left: 1.2, right: 8.4, ascent: 11.1, descent: 3.2 }),
        IDENTITY_PLACEMENT,
        fallback,
      ),
    ).toEqual({ leftExtent: 2, rightExtent: 9, ascent: 12, descent: 4 });
  });

  it("falls back to the cell when the engine reports no extents", () => {
    expect(
      glyphBounds(
        { advance: 9, left: 0, right: 0, ascent: 0, descent: 0 },
        IDENTITY_PLACEMENT,
        fallback,
      ),
    ).toEqual({ leftExtent: 0, rightExtent: 9, ascent: 14, descent: 4 });
  });

  it("measures ink left of the cell origin after a shift", () => {
    expect(
      glyphBounds(
        measure({ left: 3, right: 5 }),
        { scale: 1, shiftX: 2 },
        fallback,
      ).leftExtent,
    ).toBe(1);
    expect(
      glyphBounds(
        measure({ left: 1, right: 5 }),
        { scale: 1, shiftX: 2 },
        fallback,
      ).leftExtent,
    ).toBe(0);
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

describe("drawGlyph", () => {
  it("draws unscaled text directly at the pen position plus the shift", () => {
    const context = fakeContext();
    drawGlyph(context, "A", IDENTITY_PLACEMENT, 4, 20, 256);
    expect(context.fillText).toHaveBeenCalledWith("A", 4, 20);
    expect(context.save).not.toHaveBeenCalled();
  });

  it("clips an icon to the cells it may cover, so its fringe cannot reach a neighbour", () => {
    const calls: string[] = [];
    const context = fakeContext(calls);
    drawGlyph(context, "\ue0a0", { scale: 1, shiftX: 0, room: 9 }, 4, 20, 256);
    expect(context.rect).toHaveBeenCalledWith(4, 0, 9, 256);
    expect(calls).toEqual([
      "save",
      "beginPath",
      "rect",
      "clip",
      "translate",
      "scale",
      "fill",
      "restore",
    ]);
  });

  it("scales a shrunken icon about its pen origin and restores the context", () => {
    const calls: string[] = [];
    const context = fakeContext(calls);
    drawGlyph(context, "\ue0a0", { scale: 0.5, shiftX: 2 }, 4, 20, 256);
    expect(context.translate).toHaveBeenCalledWith(6, 20);
    expect(context.scale).toHaveBeenCalledWith(0.5, 0.5);
    expect(context.fillText).toHaveBeenCalledWith("\ue0a0", 0, 0);
    expect(calls).toEqual(["save", "translate", "scale", "fill", "restore"]);
  });
});
