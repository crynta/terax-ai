/**
 * Block Elements (U+2580..U+259F), sextants (U+1FB00..U+1FB3B), octants
 * (U+1CD00..U+1CDE5) and braille (U+2800..U+28FF), after Ghostty's sprite font
 * (`draw/block.zig`, `braille.zig`, MIT). Everything is whole-pixel
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

export function isSextant(codepoint: number): boolean {
  return codepoint >= 0x1fb00 && codepoint <= 0x1fb3b;
}

export function drawSextant(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const index = codepoint - 0x1fb00;
  // The block skips the patterns that are plain halves and the full cell.
  const bits = index + Math.floor(index / 0x14) + 1;
  const third = 1 / 3;
  if (bits & 1) fillFractions(mask, spec, 0, 0.5, 0, third);
  if (bits & 2) fillFractions(mask, spec, 0.5, 1, 0, third);
  if (bits & 4) fillFractions(mask, spec, 0, 0.5, third, 2 * third);
  if (bits & 8) fillFractions(mask, spec, 0.5, 1, third, 2 * third);
  if (bits & 16) fillFractions(mask, spec, 0, 0.5, 2 * third, 1);
  if (bits & 32) fillFractions(mask, spec, 0.5, 1, 2 * third, 1);
}

/** Octant dot masks (bit n-1 is octant n) for U+1CD00..U+1CDE5. */
const OCTANTS: readonly number[] = [
  0x04, 0x06, 0x07, 0x08, 0x09, 0x0b, 0x0c, 0x0d, 0x0e, 0x10, 0x11, 0x12, 0x13,
  0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21,
  0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
  0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c,
  0x3d, 0x3e, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b,
  0x4c, 0x4d, 0x4e, 0x4f, 0x51, 0x52, 0x53, 0x54, 0x56, 0x57, 0x58, 0x59, 0x5b,
  0x5c, 0x5d, 0x5e, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76,
  0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f, 0x81, 0x82, 0x83, 0x84,
  0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91,
  0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e,
  0x9f, 0xa1, 0xa2, 0xa3, 0xa4, 0xa6, 0xa7, 0xa8, 0xa9, 0xab, 0xac, 0xad, 0xae,
  0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc,
  0xbd, 0xbe, 0xbf, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
  0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
  0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4,
  0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xf1, 0xf2,
  0xf3, 0xf4, 0xf6, 0xf7, 0xf8, 0xf9, 0xfb, 0xfd, 0xfe,
];

export function isOctant(codepoint: number): boolean {
  return codepoint >= 0x1cd00 && codepoint <= 0x1cde5;
}

export function drawOctant(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const bits = OCTANTS[codepoint - 0x1cd00];
  for (let octant = 0; octant < 8; octant += 1) {
    if ((bits & (1 << octant)) === 0) continue;
    const row = octant >> 1;
    const left = (octant & 1) === 0;
    fillFractions(
      mask,
      spec,
      left ? 0 : 0.5,
      left ? 0.5 : 1,
      row / 4,
      (row + 1) / 4,
    );
  }
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
