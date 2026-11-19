/**
 * Block Elements (U+2580..U+259F) and braille (U+2800..U+28FF), after Ghostty's
 * sprite font (`draw/block.zig`, `braille.zig`, MIT). Sextants and octants live
 * in `legacyComputing.ts`, which loads on first use. Everything is whole-pixel
 * rectangles, so shapes tile with their neighbours at any cell size. Pieces
 * that should join (the two halves of a split cell) overlap by one pixel when
 * the size is odd rather than leaving a seam.
 */
import type { SpriteMask } from "./SpriteMask";
import type { SpriteSpec } from "./spriteSpec";

const SHADE_LIGHT = 0x40;
export const SHADE_MEDIUM = 0x80;
const SHADE_DARK = 0xc0;

/** Start of a fraction `f` of `size`, rounded from the far edge. */
function fractionStart(fraction: number, size: number): number {
  return size - Math.round((1 - fraction) * size);
}

/** End of a fraction `f` of `size`. */
function fractionEnd(fraction: number, size: number): number {
  return Math.round(fraction * size);
}

/**
 * Fills the part of the cell between two fractions on each axis. Rounding is
 * complementary at the two ends, so `[0, 1/2]` and `[1/2, 1]` together always
 * cover the whole cell, sharing the middle pixel line when the size is odd.
 */
export function fillFractions(
  mask: SpriteMask,
  spec: SpriteSpec,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  value = 255,
): void {
  mask.box(
    fractionStart(x0, spec.width),
    fractionStart(y0, spec.height),
    fractionEnd(x1, spec.width),
    fractionEnd(y1, spec.height),
    value,
  );
}

type HorizontalAlign = "left" | "center" | "right";
type VerticalAlign = "top" | "middle" | "bottom";

/** A `width x height` fraction of the cell, pinned to an edge or centred. */
export function fillBlock(
  mask: SpriteMask,
  spec: SpriteSpec,
  horizontal: HorizontalAlign,
  vertical: VerticalAlign,
  widthFraction: number,
  heightFraction: number,
  value = 255,
): void {
  const w = Math.round(spec.width * widthFraction);
  const h = Math.round(spec.height * heightFraction);
  const x =
    horizontal === "left"
      ? 0
      : horizontal === "right"
        ? spec.width - w
        : (spec.width - w) >> 1;
  const y =
    vertical === "top"
      ? 0
      : vertical === "bottom"
        ? spec.height - h
        : (spec.height - h) >> 1;
  mask.box(x, y, x + w, y + h, value);
}

export function isBlockElement(codepoint: number): boolean {
  return codepoint >= 0x2580 && codepoint <= 0x259f;
}

/** Quadrant masks: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right. */
const QUADRANTS = [4, 8, 1, 13, 9, 7, 11, 2, 6, 14] as const;

function drawQuadrants(
  mask: SpriteMask,
  spec: SpriteSpec,
  quadrants: number,
): void {
  if (quadrants & 1) fillFractions(mask, spec, 0, 0.5, 0, 0.5);
  if (quadrants & 2) fillFractions(mask, spec, 0.5, 1, 0, 0.5);
  if (quadrants & 4) fillFractions(mask, spec, 0, 0.5, 0.5, 1);
  if (quadrants & 8) fillFractions(mask, spec, 0.5, 1, 0.5, 1);
}

export function drawBlockElement(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  if (codepoint >= 0x2596) {
    drawQuadrants(mask, spec, QUADRANTS[codepoint - 0x2596]);
    return;
  }
  switch (codepoint) {
    case 0x2580:
      fillBlock(mask, spec, "left", "top", 1, 1 / 2);
      return;
    case 0x2588:
      mask.box(0, 0, spec.width, spec.height);
      return;
    case 0x2590:
      fillBlock(mask, spec, "right", "top", 1 / 2, 1);
      return;
    case 0x2591:
      mask.box(0, 0, spec.width, spec.height, SHADE_LIGHT);
      return;
    case 0x2592:
      mask.box(0, 0, spec.width, spec.height, SHADE_MEDIUM);
      return;
    case 0x2593:
      mask.box(0, 0, spec.width, spec.height, SHADE_DARK);
      return;
    case 0x2594:
      fillBlock(mask, spec, "left", "top", 1, 1 / 8);
      return;
    case 0x2595:
      fillBlock(mask, spec, "right", "top", 1 / 8, 1);
      return;
  }
  if (codepoint < 0x2588) {
    // U+2581..U+2587: lower one eighth up to seven eighths.
    fillBlock(mask, spec, "left", "bottom", 1, (codepoint - 0x2580) / 8);
    return;
  }
  // U+2589..U+258F: left seven eighths down to one eighth.
  fillBlock(mask, spec, "left", "top", (0x2590 - codepoint) / 8, 1);
}

export function isBraille(codepoint: number): boolean {
  return codepoint >= 0x2800 && codepoint <= 0x28ff;
}

/**
 * Braille dots on a 2 x 4 grid. Dot size, spacing and margins are chosen so the
 * grid is symmetric and as large as the cell allows, with every dot a whole
 * square of pixels (no anti-aliasing, no dot cut by the cell edge).
 */
export function drawBraille(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const { width, height } = spec;
  let dot = Math.min(width >> 2, height >> 3);
  let xSpacing = width >> 2;
  let ySpacing = height >> 3;
  let xMargin = xSpacing >> 1;
  let yMargin = ySpacing >> 1;

  let xLeft = width - 2 * xMargin - xSpacing - 2 * dot;
  let yLeft = height - 2 * yMargin - 3 * ySpacing - 4 * dot;

  // First, try hard to make the dots at least one pixel wide.
  if (xLeft >= 2 && yLeft >= 4 && dot === 0) {
    dot += 1;
    xLeft -= 2;
    yLeft -= 4;
  }
  // Second, prefer a non-zero margin.
  if (xLeft >= 2 && xMargin === 0) {
    xMargin = 1;
    xLeft -= 2;
  }
  if (yLeft >= 2 && yMargin === 0) {
    yMargin = 1;
    yLeft -= 2;
  }
  // Third, widen the spacing.
  if (xLeft >= 1) {
    xSpacing += 1;
    xLeft -= 1;
  }
  if (yLeft >= 3) {
    ySpacing += 1;
    yLeft -= 3;
  }
  // Fourth, widen the margins.
  if (xLeft >= 2) {
    xMargin += 1;
    xLeft -= 2;
  }
  if (yLeft >= 2) {
    yMargin += 1;
    yLeft -= 2;
  }
  // Last, grow the dots.
  if (xLeft >= 2 && yLeft >= 4) {
    dot += 1;
  }

  const columns = [xMargin, xMargin + dot + xSpacing];
  const rows = [
    yMargin,
    yMargin + (dot + ySpacing),
    yMargin + 2 * (dot + ySpacing),
    yMargin + 3 * (dot + ySpacing),
  ];
  // Bits 0,1,2 are the left column top to bottom, 3,4,5 the right column,
  // then bit 6 is the bottom-left dot and bit 7 the bottom-right.
  const dots: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [0, 3],
    [1, 3],
  ];
  const pattern = codepoint & 0xff;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((pattern & (1 << bit)) === 0) continue;
    const [column, row] = dots[bit];
    mask.box(
      columns[column],
      rows[row],
      columns[column] + dot,
      rows[row] + dot,
    );
  }
}
