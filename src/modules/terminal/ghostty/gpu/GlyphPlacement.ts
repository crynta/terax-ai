/**
 * Where a glyph sits in its cell. Private-use symbols (Nerd Font icons, Powerline
 * extras) come from whichever font in the chain has them, and their outlines are
 * designed for a cell of their own font: wider than the terminal's cell they would
 * paint over the neighbour, narrower they would sit off centre. They are fitted to
 * the cell the terminal gives them (shrunk, never enlarged, and centred on their
 * advance), except in a double-width font, which keeps two cells.
 */

export type GlyphMeasure = {
  /** `TextMetrics.width`: the pen advance. */
  readonly advance: number;
  /** Ink extent left of the pen origin (`actualBoundingBoxLeft`, positive to the left). */
  readonly left: number;
  readonly right: number;
  readonly ascent: number;
  readonly descent: number;
};

export type GlyphPlacement = {
  readonly scale: number;
  /** Device pixels the pen origin moves right of the cell's left edge. */
  readonly shiftX: number;
};

export const IDENTITY_PLACEMENT: GlyphPlacement = { scale: 1, shiftX: 0 };

const DOUBLE_WIDTH_ADVANCE = 1.5;

/** The private-use areas: BMP, supplementary A and supplementary B. */
export function isPrivateUse(codepoint: number): boolean {
  return (
    (codepoint >= 0xe000 && codepoint <= 0xf8ff) ||
    (codepoint >= 0xf0000 && codepoint <= 0xffffd) ||
    (codepoint >= 0x100000 && codepoint <= 0x10fffd)
  );
}

/** A glyph whose font is the supplementary-plane icon face (Material Design icons). */
export function isExtendedSymbol(codepoint: number): boolean {
  return codepoint >= 0xf0000 && codepoint <= 0xffffd;
}

export function placeGlyph(
  text: string,
  measure: GlyphMeasure,
  cellWidth: number,
  cellHeight: number,
): GlyphPlacement {
  const codepoint = text.codePointAt(0) ?? 0;
  if (!isPrivateUse(codepoint)) return IDENTITY_PLACEMENT;
  if (text.length !== (codepoint > 0xffff ? 2 : 1)) return IDENTITY_PLACEMENT;
  const inkWidth = measure.left + measure.right;
  const inkHeight = measure.ascent + measure.descent;
  if (!(inkWidth > 0) || !(inkHeight > 0)) return IDENTITY_PLACEMENT;

  const span = measure.advance >= cellWidth * DOUBLE_WIDTH_ADVANCE ? 2 : 1;
  const room = cellWidth * span;
  const scale = Math.min(1, room / inkWidth, cellHeight / inkHeight);
  // Centre the advance box in the span, but never push the ink out of it. Whole pixels
  // only: a fractional shift would blur an icon that is otherwise crisp.
  const centred = (room - measure.advance * scale) / 2;
  const lowest = measure.left * scale;
  const highest = room - measure.right * scale;
  const shift = Math.min(Math.max(centred, lowest), highest);
  const shiftX = Math.abs(shift) < 0.5 ? 0 : Math.round(shift);
  return scale === 1 && shiftX === 0 ? IDENTITY_PLACEMENT : { scale, shiftX };
}

export type GlyphBounds = {
  /** Ink left of the cell's left edge. */
  readonly leftExtent: number;
  /** Ink right of the cell's left edge. */
  readonly rightExtent: number;
  readonly ascent: number;
  readonly descent: number;
};

/** Whole-pixel ink bounds relative to the cell origin and baseline. */
export function glyphBounds(
  measure: GlyphMeasure,
  placement: GlyphPlacement,
  fallback: {
    readonly width: number;
    readonly ascent: number;
    readonly descent: number;
  },
): GlyphBounds {
  const { scale, shiftX } = placement;
  const left = Math.max(0, Math.ceil(measure.left * scale - shiftX || 0));
  const right = Math.ceil(
    (measure.right ? shiftX + measure.right * scale : 0) || fallback.width,
  );
  const ascent = Math.ceil(measure.ascent * scale || fallback.ascent);
  const descent = Math.ceil(measure.descent * scale || fallback.descent);
  return { leftExtent: left, rightExtent: right, ascent, descent };
}

export function drawGlyph(
  context: Pick<
    CanvasRenderingContext2D,
    "fillText" | "save" | "restore" | "translate" | "scale"
  >,
  text: string,
  placement: GlyphPlacement,
  penX: number,
  baselineY: number,
): void {
  if (placement.scale === 1) {
    context.fillText(text, penX + placement.shiftX, baselineY);
    return;
  }
  context.save();
  context.translate(penX + placement.shiftX, baselineY);
  context.scale(placement.scale, placement.scale);
  context.fillText(text, 0, 0);
  context.restore();
}
