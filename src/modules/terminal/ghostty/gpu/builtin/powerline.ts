/**
 * Powerline separators U+E0B0..U+E0BF plus U+E0D2/U+E0D4, after Ghostty's
 * `draw/powerline.zig` (MIT). Every shape spans exactly the cell, so a
 * separator touches the neighbouring cell's background with no gap at any size.
 * Stylised variants are left to the font.
 */
import { flattenCubic, type SpriteMask } from "./SpriteMask";
import {
  diagonalUpperLeftToLowerRight,
  diagonalUpperRightToLowerLeft,
} from "./boxDrawing";
import type { SpriteSpec } from "./spriteSpec";

export function isPowerline(codepoint: number): boolean {
  return (
    (codepoint >= 0xe0b0 && codepoint <= 0xe0bf) ||
    codepoint === 0xe0d2 ||
    codepoint === 0xe0d4
  );
}

/** Control-point coefficient that approximates a quarter circle. */
const ARC = ((Math.SQRT2 - 1) * 4) / 3;

export function drawPowerline(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const { width: w, height: h, thickness } = spec;
  switch (codepoint) {
    case 0xe0b0:
      mask.fill([0, 0, w, h / 2, 0, h]);
      return;
    case 0xe0b2:
      mask.fill([w, 0, 0, h / 2, w, h]);
      return;
    case 0xe0b8:
      mask.fill([0, 0, w, h, 0, h]);
      return;
    case 0xe0ba:
      mask.fill([w, 0, w, h, 0, h]);
      return;
    case 0xe0bc:
      mask.fill([0, 0, w, 0, 0, h]);
      return;
    case 0xe0be:
      mask.fill([0, 0, w, 0, w, h]);
      return;
    case 0xe0b9:
    case 0xe0bf:
      diagonalUpperLeftToLowerRight(mask, spec);
      return;
    case 0xe0bb:
    case 0xe0bd:
      diagonalUpperRightToLowerLeft(mask, spec);
      return;
    case 0xe0b1:
      mask.stroke([0, 0, w, h / 2, 0, h], thickness);
      return;
    case 0xe0b3:
      mask.stroke([0, 0, w, h / 2, 0, h], thickness);
      mask.flipHorizontal();
      return;
    case 0xe0b4:
      mask.fill(roundedHalf(w, h));
      return;
    case 0xe0b6:
      mask.fill(roundedHalf(w, h));
      mask.flipHorizontal();
      return;
    case 0xe0b5:
      mask.stroke(roundedOutline(w, h), thickness, thickness / 2);
      return;
    case 0xe0b7:
      mask.stroke(roundedOutline(w, h), thickness, thickness / 2);
      mask.flipHorizontal();
      return;
    case 0xe0d2:
      drawBowtie(mask, spec);
      return;
    case 0xe0d4:
      drawBowtie(mask, spec);
      mask.flipHorizontal();
      return;
  }
}

function segments(radius: number): number {
  return Math.max(8, Math.min(48, Math.ceil(radius * 2)));
}

/** The filled half-round separator: a flat left edge and a rounded right. */
function roundedHalf(w: number, h: number): number[] {
  const radius = Math.min(w, h / 2);
  const points = [0, 0];
  flattenCubic(
    points,
    0,
    0,
    radius * ARC,
    0,
    radius,
    radius - radius * ARC,
    radius,
    radius,
    segments(radius),
  );
  points.push(radius, h - radius);
  flattenCubic(
    points,
    radius,
    h - radius,
    radius,
    h - radius + radius * ARC,
    radius * ARC,
    h,
    0,
    h,
    segments(radius),
  );
  return points;
}

/**
 * The rounded separator's boundary as an open path. The short horizontal runs
 * at both ends keep the stroke's butt caps square to the cell edge.
 */
function roundedOutline(w: number, h: number): number[] {
  const radius = Math.min(w, h / 2);
  const points = [0, 0, 1, 0];
  flattenCubic(
    points,
    1,
    0,
    radius * ARC,
    0,
    radius,
    radius - radius * ARC,
    radius,
    radius,
    segments(radius),
  );
  points.push(radius, h - radius);
  flattenCubic(
    points,
    radius,
    h - radius,
    radius,
    h - radius + radius * ARC,
    radius * ARC,
    h,
    1,
    h,
    segments(radius),
  );
  points.push(0, h);
  return points;
}

function drawBowtie(mask: SpriteMask, spec: SpriteSpec): void {
  const { width: w, height: h, thickness } = spec;
  const upper = h / 2 - thickness / 2;
  const lower = h / 2 + thickness / 2;
  mask.fill([0, 0, w, 0, w / 2, upper, 0, upper]);
  mask.fill([0, h, w, h, w / 2, lower, 0, lower]);
}
