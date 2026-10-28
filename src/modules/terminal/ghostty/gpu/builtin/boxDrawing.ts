/**
 * Box Drawing, U+2500..U+257F. The geometry follows Ghostty's sprite font
 * (`src/font/sprite/draw/box.zig`, MIT): every stroke is a whole-pixel
 * rectangle centred on integer coordinates, so lines meet exactly across cell
 * boundaries at every size, odd or even. Only diagonals and arcs are
 * anti-aliased.
 */
import { flattenCubic, type SpriteMask } from "./SpriteMask";
import type { SpriteSpec } from "./spriteSpec";

const LINE_NONE = 0;
export const LINE_LIGHT = 1;
export const LINE_HEAVY = 2;
const LINE_DOUBLE = 3;

/** `up | right << 2 | down << 4 | left << 6`, or -1 when drawn another way. */
const BOX_LINES: readonly number[] = [
  68, 136, 17, 34, -1, -1, -1, -1, -1, -1, -1, -1, 20, 24, 36, 40, 80, 144, 96,
  160, 5, 9, 6, 10, 65, 129, 66, 130, 21, 25, 22, 37, 38, 26, 41, 42, 81, 145,
  82, 97, 98, 146, 161, 162, 84, 148, 88, 152, 100, 164, 104, 168, 69, 133, 73,
  137, 70, 134, 74, 138, 85, 149, 89, 153, 86, 101, 102, 150, 90, 165, 105, 154,
  169, 166, 106, 170, -1, -1, -1, -1, 204, 51, 28, 52, 60, 208, 112, 240, 13, 7,
  15, 193, 67, 195, 29, 55, 63, 209, 115, 243, 220, 116, 252, 205, 71, 207, 221,
  119, 255, -1, -1, -1, -1, -1, -1, -1, 64, 1, 4, 16, 128, 2, 8, 32, 72, 33,
  132, 18,
];

export function isBoxDrawing(codepoint: number): boolean {
  return codepoint >= 0x2500 && codepoint <= 0x257f;
}

export function drawBoxDrawing(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const packed = BOX_LINES[codepoint - 0x2500];
  if (packed >= 0) {
    drawLines(
      mask,
      spec,
      packed & 3,
      (packed >> 2) & 3,
      (packed >> 4) & 3,
      (packed >> 6) & 3,
    );
    return;
  }
  const light = spec.thickness;
  const heavy = light * 2;
  switch (codepoint) {
    case 0x2504:
      dashHorizontal(mask, spec, 3, light, Math.max(4, light));
      return;
    case 0x2505:
      dashHorizontal(mask, spec, 3, heavy, Math.max(4, light));
      return;
    case 0x2506:
      dashVertical(mask, spec, 3, light, Math.max(4, light));
      return;
    case 0x2507:
      dashVertical(mask, spec, 3, heavy, Math.max(4, light));
      return;
    case 0x2508:
      dashHorizontal(mask, spec, 4, light, Math.max(4, light));
      return;
    case 0x2509:
      dashHorizontal(mask, spec, 4, heavy, Math.max(4, light));
      return;
    case 0x250a:
      dashVertical(mask, spec, 4, light, Math.max(4, light));
      return;
    case 0x250b:
      dashVertical(mask, spec, 4, heavy, Math.max(4, light));
      return;
    case 0x254c:
      dashHorizontal(mask, spec, 2, light, light);
      return;
    case 0x254d:
      dashHorizontal(mask, spec, 2, heavy, heavy);
      return;
    case 0x254e:
      dashVertical(mask, spec, 2, light, heavy);
      return;
    case 0x254f:
      dashVertical(mask, spec, 2, heavy, heavy);
      return;
    case 0x256d:
      drawArc(mask, spec, "br");
      return;
    case 0x256e:
      drawArc(mask, spec, "bl");
      return;
    case 0x256f:
      drawArc(mask, spec, "tl");
      return;
    case 0x2570:
      drawArc(mask, spec, "tr");
      return;
    case 0x2571:
      diagonalUpperRightToLowerLeft(mask, spec);
      return;
    case 0x2572:
      diagonalUpperLeftToLowerRight(mask, spec);
      return;
    case 0x2573:
      diagonalUpperRightToLowerLeft(mask, spec);
      diagonalUpperLeftToLowerRight(mask, spec);
      return;
  }
}

/** Saturating subtraction, as the unsigned arithmetic the geometry assumes. */
function sub(a: number, b: number): number {
  return Math.max(0, a - b);
}

/**
 * A traditional junction: each of the four arms has its own style, drawn from
 * the cell centre to the edge. Where arms of different weight meet, the shorter
 * ones are extended or trimmed so the joint is solid with no notch.
 */
export function drawLines(
  mask: SpriteMask,
  spec: SpriteSpec,
  up: number,
  right: number,
  down: number,
  left: number,
): void {
  const { width, height } = spec;
  const light = spec.thickness;
  const heavy = light * 2;

  const hLightTop = sub(height, light) >> 1;
  const hLightBottom = hLightTop + light;
  const hHeavyTop = sub(height, heavy) >> 1;
  const hHeavyBottom = hHeavyTop + heavy;
  const hDoubleTop = sub(hLightTop, light);
  const hDoubleBottom = hLightBottom + light;

  const vLightLeft = sub(width, light) >> 1;
  const vLightRight = vLightLeft + light;
  const vHeavyLeft = sub(width, heavy) >> 1;
  const vHeavyRight = vHeavyLeft + heavy;
  const vDoubleLeft = sub(vLightLeft, light);
  const vDoubleRight = vLightRight + light;

  let upBottom: number;
  if (left === LINE_HEAVY || right === LINE_HEAVY) upBottom = hHeavyBottom;
  else if (left !== right || down === up) {
    upBottom =
      left === LINE_DOUBLE || right === LINE_DOUBLE
        ? hDoubleBottom
        : hLightBottom;
  } else if (left === LINE_NONE && right === LINE_NONE) upBottom = hLightBottom;
  else upBottom = hLightTop;

  let downTop: number;
  if (left === LINE_HEAVY || right === LINE_HEAVY) downTop = hHeavyTop;
  else if (left !== right || up === down) {
    downTop =
      left === LINE_DOUBLE || right === LINE_DOUBLE ? hDoubleTop : hLightTop;
  } else if (left === LINE_NONE && right === LINE_NONE) downTop = hLightTop;
  else downTop = hLightBottom;

  let leftRight: number;
  if (up === LINE_HEAVY || down === LINE_HEAVY) leftRight = vHeavyRight;
  else if (up !== down || left === right) {
    leftRight =
      up === LINE_DOUBLE || down === LINE_DOUBLE ? vDoubleRight : vLightRight;
  } else if (up === LINE_NONE && down === LINE_NONE) leftRight = vLightRight;
  else leftRight = vLightLeft;

  let rightLeft: number;
  if (up === LINE_HEAVY || down === LINE_HEAVY) rightLeft = vHeavyLeft;
  else if (up !== down || right === left) {
    rightLeft =
      up === LINE_DOUBLE || down === LINE_DOUBLE ? vDoubleLeft : vLightLeft;
  } else if (up === LINE_NONE && down === LINE_NONE) rightLeft = vLightLeft;
  else rightLeft = vLightRight;

  if (up === LINE_LIGHT) mask.box(vLightLeft, 0, vLightRight, upBottom);
  else if (up === LINE_HEAVY) mask.box(vHeavyLeft, 0, vHeavyRight, upBottom);
  else if (up === LINE_DOUBLE) {
    const leftBottom = left === LINE_DOUBLE ? hLightTop : upBottom;
    const rightBottom = right === LINE_DOUBLE ? hLightTop : upBottom;
    mask.box(vDoubleLeft, 0, vLightLeft, leftBottom);
    mask.box(vLightRight, 0, vDoubleRight, rightBottom);
  }

  if (right === LINE_LIGHT) {
    mask.box(rightLeft, hLightTop, width, hLightBottom);
  } else if (right === LINE_HEAVY) {
    mask.box(rightLeft, hHeavyTop, width, hHeavyBottom);
  } else if (right === LINE_DOUBLE) {
    const topLeft = up === LINE_DOUBLE ? vLightRight : rightLeft;
    const bottomLeft = down === LINE_DOUBLE ? vLightRight : rightLeft;
    mask.box(topLeft, hDoubleTop, width, hLightTop);
    mask.box(bottomLeft, hLightBottom, width, hDoubleBottom);
  }

  if (down === LINE_LIGHT) mask.box(vLightLeft, downTop, vLightRight, height);
  else if (down === LINE_HEAVY) {
    mask.box(vHeavyLeft, downTop, vHeavyRight, height);
  } else if (down === LINE_DOUBLE) {
    const leftTop = left === LINE_DOUBLE ? hLightBottom : downTop;
    const rightTop = right === LINE_DOUBLE ? hLightBottom : downTop;
    mask.box(vDoubleLeft, leftTop, vLightLeft, height);
    mask.box(vLightRight, rightTop, vDoubleRight, height);
  }

  if (left === LINE_LIGHT) mask.box(0, hLightTop, leftRight, hLightBottom);
  else if (left === LINE_HEAVY) mask.box(0, hHeavyTop, leftRight, hHeavyBottom);
  else if (left === LINE_DOUBLE) {
    const topRight = up === LINE_DOUBLE ? vLightLeft : leftRight;
    const bottomRight = down === LINE_DOUBLE ? vLightLeft : leftRight;
    mask.box(0, hDoubleTop, topRight, hLightTop);
    mask.box(0, hLightBottom, bottomRight, hDoubleBottom);
  }
}

/**
 * Evenly spaced dashes that tile into one consistent line: half a gap on each
 * side, leftover pixels spread over the dashes (never the gaps).
 */
function dashHorizontal(
  mask: SpriteMask,
  spec: SpriteSpec,
  count: number,
  thickness: number,
  desiredGap: number,
): void {
  const { width, height } = spec;
  if (width < count * 2) {
    const y = sub(height, spec.thickness) >> 1;
    mask.box(0, y, width, y + spec.thickness);
    return;
  }
  const gap = Math.min(desiredGap, Math.floor(width / (2 * count)));
  const totalDash = width - count * gap;
  const dash = Math.floor(totalDash / count);
  let extra = totalDash % count;
  const y = sub(height, thickness) >> 1;
  let x = gap >> 1;
  for (let index = 0; index < count; index += 1) {
    let end = x + dash;
    if (extra > 0) {
      extra -= 1;
      end += 1;
    }
    mask.box(x, y, end, y + thickness);
    x = end + gap;
  }
}

/** Vertical dashes; one full gap at the bottom joins solid lines cleanly. */
function dashVertical(
  mask: SpriteMask,
  spec: SpriteSpec,
  count: number,
  thickness: number,
  desiredGap: number,
): void {
  const { width, height } = spec;
  if (height < count * 2) {
    const x = sub(width, spec.thickness) >> 1;
    mask.box(x, 0, x + spec.thickness, height);
    return;
  }
  const gap = Math.min(desiredGap, Math.floor(height / (2 * count)));
  const totalDash = height - count * gap;
  const dash = Math.floor(totalDash / count);
  let extra = totalDash % count;
  const x = sub(width, thickness) >> 1;
  let y = 0;
  for (let index = 0; index < count; index += 1) {
    let end = y + dash;
    if (extra > 0) {
      extra -= 1;
      end += 1;
    }
    mask.box(x, y, x + thickness, end);
    y = end + gap;
  }
}

/**
 * U+2571..U+2573 diagonals overshoot both corners by half a pixel along the
 * line so butt caps leave no notch; the mask clips the overshoot, and the
 * neighbour's matching diagonal continues the same straight line.
 */
export function diagonalUpperRightToLowerLeft(
  mask: SpriteMask,
  spec: SpriteSpec,
): void {
  const { width, height } = spec;
  const slopeX = Math.min(1, width / height);
  const slopeY = Math.min(1, height / width);
  mask.line(
    width + 0.5 * slopeX,
    -0.5 * slopeY,
    -0.5 * slopeX,
    height + 0.5 * slopeY,
    spec.thickness,
  );
}

export function diagonalUpperLeftToLowerRight(
  mask: SpriteMask,
  spec: SpriteSpec,
): void {
  const { width, height } = spec;
  const slopeX = Math.min(1, width / height);
  const slopeY = Math.min(1, height / width);
  mask.line(
    -0.5 * slopeX,
    -0.5 * slopeY,
    width + 0.5 * slopeX,
    height + 0.5 * slopeY,
    spec.thickness,
  );
}

/** Rounded corner: the straight arms of a light junction joined by a curve. */
function drawArc(
  mask: SpriteMask,
  spec: SpriteSpec,
  corner: "tl" | "tr" | "bl" | "br",
): void {
  const { width, height, thickness } = spec;
  const centerX = (sub(width, thickness) >> 1) + thickness / 2;
  const centerY = (sub(height, thickness) >> 1) + thickness / 2;
  const radius = Math.min(width, height) / 2;
  // Control points sit a quarter of the radius from the centre.
  const control = 0.25;
  const horizontal = corner === "tl" || corner === "bl" ? -1 : 1;
  const vertical = corner === "tl" || corner === "tr" ? -1 : 1;
  const edgeY = vertical < 0 ? 0 : height;
  const edgeX = horizontal < 0 ? 0 : width;

  const points = [centerX, edgeY, centerX, centerY + vertical * radius];
  flattenCubic(
    points,
    centerX,
    centerY + vertical * radius,
    centerX,
    centerY + vertical * control * radius,
    centerX + horizontal * control * radius,
    centerY,
    centerX + horizontal * radius,
    centerY,
    arcSegments(radius),
  );
  points.push(edgeX, centerY);
  mask.stroke(points, thickness);

  // The curve's tail sits a few hundredths of a pixel off the line in the last
  // column, bleeding faint ink beside the band. Pin the two open ends to whole
  // pixels so they match ─ and │ exactly.
  const bandTop = sub(height, thickness) >> 1;
  const bandLeft = sub(width, thickness) >> 1;
  const endX = horizontal < 0 ? 0 : width - 1;
  const endY = vertical < 0 ? 0 : height - 1;
  mask.box(endX, 0, endX + 1, height, 0);
  mask.box(endX, bandTop, endX + 1, bandTop + thickness);
  mask.box(0, endY, width, endY + 1, 0);
  mask.box(bandLeft, endY, bandLeft + thickness, endY + 1);
}

function arcSegments(radius: number): number {
  return Math.max(8, Math.min(48, Math.ceil(radius * 2)));
}
