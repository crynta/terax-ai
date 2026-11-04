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

  it("keeps a cell-sized icon in place", () => {
    expect(placeGlyph("", measure(), CELL.width, CELL.height)).toBe(
      IDENTITY_PLACEMENT,
    );
  });

  it("shrinks an icon wider than its cell instead of overflowing into the neighbour", () => {
    const placement = placeGlyph(
      "",
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
      "",
      measure({ ascent: 20, descent: 8 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBeCloseTo(18 / 28, 6);
  });

  it("never enlarges a small icon", () => {
    const placement = placeGlyph(
      "b".length === 1 ? "" : "",
      measure({ advance: 9, left: 0, right: 5, ascent: 5, descent: 0 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBe(1);
  });

  it("centres an icon whose font advance differs from the cell, on whole pixels", () => {
    const placement = placeGlyph(
      "",
      measure({ advance: 5, right: 5 }),
      CELL.width,
      CELL.height,
    );
    expect(placement.scale).toBe(1);
    expect(placement.shiftX).toBe(2);
    expect(Number.isInteger(placement.shiftX)).toBe(true);
    // Sub-pixel slack is ignored rather than blurring the icon.
    expect(
      placeGlyph("", measure({ advance: 8.4 }), CELL.width, CELL.height),
    ).toBe(IDENTITY_PLACEMENT);
  });

  it("keeps two cells for a double-width font", () => {
    const placement = placeGlyph(
      "",
      measure({ advance: 18, left: 0, right: 17 }),
      CELL.width,
      CELL.height,
    );
    expect(placement).toBe(IDENTITY_PLACEMENT);
    const wider = placeGlyph(
      "",
      measure({ advance: 18, left: 0, right: 27 }),
      CELL.width,
      CELL.height,
    );
    expect(wider.scale).toBeCloseTo(18 / 27, 6);
  });

  it("leaves a private-use character with a variation selector to the font", () => {
    expect(
      placeGlyph("️", measure({ right: 30 }), CELL.width, CELL.height),
    ).toBe(IDENTITY_PLACEMENT);
  });

  it("ignores a glyph with no ink", () => {
    expect(
      placeGlyph("", measure({ left: 0, right: 0 }), CELL.width, CELL.height),
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
          const placement = placeGlyph("", m, cellWidth, 20);
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

describe("drawGlyph", () => {
  it("draws unscaled text directly at the pen position plus the shift", () => {
    const context = {
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    };
    drawGlyph(context, "A", IDENTITY_PLACEMENT, 4, 20);
    expect(context.fillText).toHaveBeenCalledWith("A", 4, 20);
    drawGlyph(context, "", { scale: 1, shiftX: 3 }, 4, 20);
    expect(context.fillText).toHaveBeenLastCalledWith("", 7, 20);
    expect(context.save).not.toHaveBeenCalled();
  });

  it("scales a shrunken icon about its pen origin and restores the context", () => {
    const calls: string[] = [];
    const context = {
      fillText: vi.fn(() => calls.push("fill")),
      save: vi.fn(() => calls.push("save")),
      restore: vi.fn(() => calls.push("restore")),
      translate: vi.fn(() => calls.push("translate")),
      scale: vi.fn(() => calls.push("scale")),
    };
    drawGlyph(context, "", { scale: 0.5, shiftX: 2 }, 4, 20);
    expect(context.translate).toHaveBeenCalledWith(6, 20);
    expect(context.scale).toHaveBeenCalledWith(0.5, 0.5);
    expect(context.fillText).toHaveBeenCalledWith("", 0, 0);
    expect(calls).toEqual(["save", "translate", "scale", "fill", "restore"]);
  });
});
