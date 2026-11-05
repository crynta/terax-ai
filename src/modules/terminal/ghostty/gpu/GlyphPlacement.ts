/**
 * Where a glyph sits in its cell. Ordinary text stays exactly where the font put it.
 * Private-use symbols (Nerd Font icons and Powerline) come from whichever font in the
 * chain has them and are designed for a cell of their own, so each codepoint range has a
 * constraint, after what Ghostty derives from the Nerd Fonts patcher:
 *
 * - `native`: drawn as designed (the version-control icons, which already fit a cell).
 * - `icon`: drawn as designed, shrunk only when wider than two cells or taller than the
 *   cell. Nerd Font icons are about a em wide, so the cell after one is meant to be
 *   blank.
 * - `stretch`: Powerline separators and extras fill their cell(s) exactly, whatever the
 *   font's metrics: the ink box is mapped onto one or two cells by the cell height, so
 *   neighbours join without a seam and nothing floats.
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

export type GlyphConstraint =
  | { readonly mode: "native" }
  | { readonly mode: "icon" }
  | { readonly mode: "stretch"; readonly span: 1 | 2 };

const NATIVE: GlyphConstraint = { mode: "native" };
const ICON: GlyphConstraint = { mode: "icon" };
const STRETCH_1: GlyphConstraint = { mode: "stretch", span: 1 };
const STRETCH_2: GlyphConstraint = { mode: "stretch", span: 2 };

/** Widest an icon may be, in cells. */
const ICON_MAX_CELLS = 2;

/** Constraints that differ from the `icon` default, by inclusive codepoint range. */
export const GLYPH_CONSTRAINTS: ReadonlyArray<
  readonly [from: number, to: number, constraint: GlyphConstraint]
> = [
  // Version control icons (branch, line number, lock, column).
  [0xe0a0, 0xe0a3, NATIVE],
  // Powerline separators and their thin and mirrored forms.
  [0xe0b0, 0xe0bf, STRETCH_1],
  // Powerline Extra: flames, pixel fades, ice, honeycombs are two cells wide.
  [0xe0c0, 0xe0cd, STRETCH_2],
  // Lego blocks are ordinary icons.
  [0xe0ce, 0xe0d1, ICON],
  // Trapezoids and half circles.
  [0xe0d2, 0xe0d7, STRETCH_1],
];

export function constraintFor(codepoint: number): GlyphConstraint {
  for (const [from, to, constraint] of GLYPH_CONSTRAINTS) {
    if (codepoint >= from && codepoint <= to) return constraint;
  }
  return ICON;
}

export type GlyphPlacement = {
  readonly scaleX: number;
  readonly scaleY: number;
  /** Device pixels the pen origin moves right of the cell's left edge. */
  readonly shiftX: number;
  /** Baseline from the cell's top edge; absent: the cell's own baseline. */
  readonly baselineY?: number;
  /** Cell-relative box the ink is clipped to; absent: unclipped. */
  readonly clip?: {
    readonly width: number;
    readonly height: number;
  };
};

export const IDENTITY_PLACEMENT: GlyphPlacement = {
  scaleX: 1,
  scaleY: 1,
  shiftX: 0,
};

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

  const constraint = constraintFor(codepoint);
  if (constraint.mode === "native") return IDENTITY_PLACEMENT;
  if (constraint.mode === "stretch") {
    const width = cellWidth * constraint.span;
    const scaleX = width / inkWidth;
    const scaleY = cellHeight / inkHeight;
    return {
      scaleX,
      scaleY,
      shiftX: measure.left * scaleX,
      baselineY: measure.ascent * scaleY,
      clip: { width, height: cellHeight },
    };
  }
  const scale = Math.min(
    1,
    (cellWidth * ICON_MAX_CELLS) / inkWidth,
    cellHeight / inkHeight,
  );
  return scale === 1 ? IDENTITY_PLACEMENT : { scaleX: scale, scaleY: scale, shiftX: 0 };
}

/** Everything a rasterizer needs to size, draw and position one glyph bitmap. */
export type GlyphLayout = {
  readonly width: number;
  readonly height: number;
  /** Offset of the bitmap's top-left from the cell's top-left. */
  readonly bearingX: number;
  readonly bearingY: number;
  readonly penX: number;
  readonly baselineY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Bitmap-space clip box; null: unclipped. */
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
};

export type CellMetrics = {
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
};

/**
 * Sizes the bitmap for a glyph and says where to draw it. Without a placement this is the
 * measurement every renderer used before: whole-pixel ink bounds plus `padding`, falling back
 * to the cell when the engine reports no extents.
 */
export function layoutGlyph(
  measure: GlyphMeasure,
  placement: GlyphPlacement,
  cell: CellMetrics,
  padding: number,
  limit: number,
): GlyphLayout {
  const { scaleX, scaleY, shiftX } = placement;
  if (placement.baselineY !== undefined && placement.clip) {
    const { width, height } = placement.clip;
    return {
      width: Math.min(limit, Math.ceil(width) + padding * 2),
      height: Math.min(limit, Math.ceil(height) + padding * 2),
      bearingX: -padding,
      bearingY: -padding,
      penX: padding + shiftX,
      baselineY: padding + placement.baselineY,
      scaleX,
      scaleY,
      clip: { x: padding, y: padding, width, height },
    };
  }
  const left = Math.max(0, Math.ceil(measure.left * scaleX - shiftX || 0));
  const right = Math.ceil(
    (measure.right ? shiftX + measure.right * scaleX : 0) || cell.width,
  );
  const ascent = Math.ceil(measure.ascent * scaleY || cell.baseline);
  const descent = Math.ceil(
    measure.descent * scaleY || cell.height - cell.baseline,
  );
  return {
    width: Math.min(limit, Math.max(1, left + right + padding * 2)),
    height: Math.min(limit, Math.max(1, ascent + descent + padding * 2)),
    bearingX: -left - padding,
    bearingY: cell.baseline - ascent - padding,
    penX: padding + left + shiftX,
    baselineY: padding + ascent,
    scaleX,
    scaleY,
    clip: null,
  };
}

export function drawGlyph(
  context: Pick<
    CanvasRenderingContext2D,
    | "fillText"
    | "save"
    | "restore"
    | "translate"
    | "scale"
    | "beginPath"
    | "rect"
    | "clip"
  >,
  text: string,
  layout: GlyphLayout,
): void {
  if (layout.scaleX === 1 && layout.scaleY === 1 && !layout.clip) {
    context.fillText(text, layout.penX, layout.baselineY);
    return;
  }
  context.save();
  if (layout.clip) {
    context.beginPath();
    context.rect(layout.clip.x, layout.clip.y, layout.clip.width, layout.clip.height);
    context.clip();
  }
  context.translate(layout.penX, layout.baselineY);
  context.scale(layout.scaleX, layout.scaleY);
  context.fillText(text, 0, 0);
  context.restore();
}
