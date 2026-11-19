/**
 * Where a glyph sits in its cell. Ordinary text stays exactly where the font put it.
 * Private-use symbols (Nerd Font icons and Powerline) come from whichever font in the
 * chain has them and are designed for a cell of their own, so each codepoint range has a
 * constraint, after what Ghostty derives from the Nerd Fonts patcher:
 *
 * - `native`: drawn as designed (the version-control icons, which already fit a cell).
 * - `icon`: drawn as designed, shrunk only when wider than its room or taller than the
 *   cell. Nerd Font icons are about an em wide, so the cell after one is meant to be
 *   blank.
 * - `stretch`: Powerline separators and extras fill their cell(s) exactly, whatever the
 *   font's metrics: the ink box is mapped onto one or two cells by the cell height, so
 *   neighbours join without a seam and nothing floats.
 *
 * A glyph that may take two cells has two forms, as in Ghostty's `constraintWidth`: the
 * roomy one (two cells) is used only when the next cell is blank, the cell is not the last
 * column and the cell before is not a non-graphics symbol; every other time the glyph is
 * constrained to its own cell, so it never paints over a neighbouring letter or spills
 * past the grid.
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

/** A private-use glyph that may take two cells, so it has a constrained and a roomy form. */
export function isNeighbourAware(codepoint: number): boolean {
  if (!isPrivateUse(codepoint)) return false;
  const constraint = constraintFor(codepoint);
  return (
    constraint.mode === "icon" ||
    (constraint.mode === "stretch" && constraint.span === 2)
  );
}

/**
 * A private-use symbol that is not a Powerline separator: a glyph right after one is
 * constrained to its own cell, so a row of icons never smears (Ghostty's `isSymbol` and
 * `isGraphicsElement`).
 */
export function isNonGraphicsSymbol(codepoint: number): boolean {
  return isPrivateUse(codepoint) && !(codepoint >= 0xe0b0 && codepoint <= 0xe0d7);
}

/** Whether a glyph with a blank cell after it, away from the last column, after no symbol, is roomy. */
export function roomyAt(
  column: number,
  columns: number,
  nextIsBlank: boolean,
  previousIsSymbol: boolean,
): boolean {
  return column + 1 < columns && nextIsBlank && !previousIsSymbol;
}

export type GlyphPlacement = {
  readonly scaleX: number;
  readonly scaleY: number;
  /** Device pixels the pen origin moves right of the cell's left edge. */
  readonly shiftX: number;
  /** Baseline from the cell's top edge; absent: the cell's own baseline. */
  readonly baselineY?: number;
  /** Cell-relative box the ink is clipped to (a stretched glyph fills it); absent: unclipped. */
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
  roomy = true,
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
    const width = cellWidth * (roomy ? constraint.span : 1);
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
  const room = cellWidth * (roomy ? ICON_MAX_CELLS : 1);
  const scale = Math.min(1, room / inkWidth, cellHeight / inkHeight);
  // Keep the ink inside its room: an ink box that starts right of the pen origin would
  // otherwise end past the room once shrunk to fit it.
  const inkStart = -measure.left * scale;
  const inkEnd = measure.right * scale;
  const shiftX = Math.min(Math.max(0, -inkStart), room - inkEnd);
  // A glyph held to its own cell is also clipped there, so a fringe never touches a neighbour.
  const clip = roomy ? undefined : { width: cellWidth, height: cellHeight };
  if (scale === 1 && shiftX === 0 && !clip) return IDENTITY_PLACEMENT;
  return { scaleX: scale, scaleY: scale, shiftX, ...(clip && { clip }) };
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
  /** The ink fills its cell box exactly, so its coverage is final (no text contrast). */
  readonly exact: boolean;
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
      exact: true,
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
    exact: false,
    clip: placement.clip
      ? { x: padding + left, y: 0, width: placement.clip.width, height: limit }
      : null,
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
