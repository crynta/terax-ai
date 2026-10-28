/**
 * Geometric corner triangles (U+25E2..U+25E5, U+25F8..U+25FF) and the parts of
 * Symbols for Legacy Computing (U+1FB3C..U+1FBEF) that terminal UIs actually
 * draw with: smooth mosaics, one-eighth bars, half shades, checkerboards,
 * diagonal fills and quarter circles. Geometry follows Ghostty's sprite font
 * (`draw/symbols_for_legacy_computing.zig`, `geometric_shapes.zig`, MIT).
 */
import { SHADE_MEDIUM, fillBlock, fillFractions } from "./blockElements";
import {
  LINE_HEAVY,
  LINE_LIGHT,
  diagonalUpperLeftToLowerRight,
  diagonalUpperRightToLowerLeft,
  drawLines,
} from "./boxDrawing";
import type { SpriteMask } from "./SpriteMask";
import type { SpriteSpec } from "./spriteSpec";

export function isGeometricShape(codepoint: number): boolean {
  return (
    (codepoint >= 0x25e2 && codepoint <= 0x25e5) ||
    (codepoint >= 0x25f8 && codepoint <= 0x25fa) ||
    codepoint === 0x25ff
  );
}

export function isLegacyComputing(codepoint: number): boolean {
  return (
    (codepoint >= 0x1fb3c && codepoint <= 0x1fbaf) ||
    (codepoint >= 0x1fbbd && codepoint <= 0x1fbbf) ||
    (codepoint >= 0x1fbce && codepoint <= 0x1fbef)
  );
}

type Corner = "tl" | "tr" | "bl" | "br";

function cornerTriangle(corner: Corner, w: number, h: number): number[] {
  switch (corner) {
    case "tl":
      return [0, 0, 0, h, w, 0];
    case "tr":
      return [0, 0, w, h, w, 0];
    case "bl":
      return [0, 0, 0, h, w, h];
    case "br":
      return [0, h, w, h, w, 0];
  }
}

export function drawGeometricShape(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const { width: w, height: h, thickness } = spec;
  switch (codepoint) {
    case 0x25e2:
      mask.fill(cornerTriangle("br", w, h));
      return;
    case 0x25e3:
      mask.fill(cornerTriangle("bl", w, h));
      return;
    case 0x25e4:
      mask.fill(cornerTriangle("tl", w, h));
      return;
    case 0x25e5:
      mask.fill(cornerTriangle("tr", w, h));
      return;
    case 0x25f8:
      mask.outline(cornerTriangle("tl", w, h), thickness);
      return;
    case 0x25f9:
      mask.outline(cornerTriangle("tr", w, h), thickness);
      return;
    case 0x25fa:
      mask.outline(cornerTriangle("bl", w, h), thickness);
      return;
    case 0x25ff:
      mask.outline(cornerTriangle("br", w, h), thickness);
      return;
  }
}

/**
 * Smooth mosaic shapes, 10 bits each: the cell edge is walked clockwise from
 * the top-left through these vertices and a bit says whether a vertex is on the
 * shape. Bit order: top-left, upper-left, lower-left, bottom-left,
 * bottom-centre, bottom-right, lower-right, upper-right, top-right,
 * top-centre. U+1FB3C..U+1FB67.
 */
const MOSAICS: readonly number[] = [
  0x01c, 0x02c, 0x01a, 0x02a, 0x019, 0x32a, 0x12a, 0x32c, 0x12c, 0x328, 0x0ac,
  0x070, 0x068, 0x0b0, 0x0a8, 0x130, 0x2a9, 0x0a9, 0x269, 0x069, 0x229, 0x06a,
  0x135, 0x125, 0x133, 0x123, 0x131, 0x203, 0x103, 0x205, 0x105, 0x209, 0x185,
  0x159, 0x149, 0x199, 0x189, 0x119, 0x380, 0x181, 0x340, 0x141, 0x320, 0x143,
];

function drawMosaic(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const { width: w, height: h } = spec;
  const bits = MOSAICS[codepoint - 0x1fb3c];
  const upper = h / 3;
  const lower = (2 * h) / 3;
  const center = w / 2;
  const vertices: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, upper],
    [0, lower],
    [0, h],
    [center, h],
    [w, h],
    [w, lower],
    [w, upper],
    [w, 0],
    [center, 0],
  ];
  const ring: number[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    if (bits & (1 << index)) ring.push(vertices[index][0], vertices[index][1]);
  }
  mask.fill(ring);
}

type Edge = "top" | "left" | "bottom" | "right";

/** The triangle from the cell centre to one whole edge. */
function edgeTriangle(edge: Edge, spec: SpriteSpec): number[] {
  const { width: w, height: h } = spec;
  const centerX = Math.round(w / 2);
  const centerY = Math.round(h / 2);
  switch (edge) {
    case "top":
      return [centerX, centerY, w, 0, 0, 0];
    case "left":
      return [centerX, centerY, 0, 0, 0, h];
    case "bottom":
      return [centerX, centerY, 0, h, w, h];
    case "right":
      return [centerX, centerY, w, h, w, 0];
  }
}

function drawEdgeTriangle(
  mask: SpriteMask,
  spec: SpriteSpec,
  edge: Edge,
  inverted: boolean,
): void {
  mask.fill(edgeTriangle(edge, spec));
  if (inverted) mask.invert();
}

function checkerboard(mask: SpriteMask, spec: SpriteSpec, parity: number) {
  const { width: w, height: h } = spec;
  const columns = 4;
  const rows = Math.round(4 * (h / w));
  for (let x = 0; x < columns; x += 1) {
    const x0 = Math.floor((w * x) / columns);
    const x1 = Math.floor((w * (x + 1)) / columns);
    for (let y = 0; y < rows; y += 1) {
      const y0 = Math.floor((h * y) / rows);
      const y1 = Math.floor((h * (y + 1)) / rows);
      if ((x + y) % 2 === parity) mask.box(x0, y0, x1, y1);
    }
  }
}

/** Diagonal hatching across the cell, clipped to it. */
function hatch(mask: SpriteMask, spec: SpriteSpec, descending: boolean) {
  const { width: w, height: h, thickness } = spec;
  const count = Math.floor(w / (2 * thickness));
  if (count === 0) return;
  const stride = Math.round(w / count);
  for (let index = 0; index <= count * 2; index += 1) {
    const offset = (index - count) * stride;
    if (descending) mask.line(offset, 0, w + offset, h, thickness);
    else mask.line(w + offset, 0, offset, h, thickness);
  }
}

type Corners = number;
const TL = 1;
const TR = 2;
const BL = 4;
const BR = 8;

function cornerDiagonals(
  mask: SpriteMask,
  spec: SpriteSpec,
  corners: Corners,
): void {
  const { width: w, height: h, thickness } = spec;
  const centerX = (w >> 1) + (w % 2);
  const centerY = (h >> 1) + (h % 2);
  if (corners & TL) mask.line(centerX, 0, 0, centerY, thickness);
  if (corners & TR) mask.line(centerX, 0, w, centerY, thickness);
  if (corners & BL) mask.line(centerX, h, 0, centerY, thickness);
  if (corners & BR) mask.line(centerX, h, w, centerY, thickness);
}

/** Corner combinations for U+1FBA0..U+1FBAE. */
const CORNER_DIAGONALS: readonly Corners[] = [
  TL,
  TR,
  BL,
  BR,
  TL | BL,
  TR | BR,
  BL | BR,
  TL | TR,
  TL | BR,
  TR | BL,
  TR | BL | BR,
  TL | BL | BR,
  TL | TR | BR,
  TL | TR | BL,
  TL | TR | BL | BR,
];

type Anchor = readonly [horizontal: 0 | 0.5 | 1, vertical: 0 | 0.5 | 1];
const UL: Anchor = [0, 0];
const UC: Anchor = [0.5, 0];
const UR: Anchor = [1, 0];
const ML: Anchor = [0, 0.5];
const MC: Anchor = [0.5, 0.5];
const MR: Anchor = [1, 0.5];
const LL: Anchor = [0, 1];
const LC: Anchor = [0.5, 1];
const LR: Anchor = [1, 1];

/** Segment chains for U+1FBD0..U+1FBDF. */
const CELL_DIAGONALS: ReadonlyArray<readonly Anchor[]> = [
  [MR, LL],
  [UR, ML],
  [UL, MR],
  [ML, LR],
  [UL, LC],
  [UC, LR],
  [UR, LC],
  [UC, LL],
  [UL, MC, UR],
  [UR, MC, LR],
  [LL, MC, LR],
  [UL, MC, LL],
  [UL, LC, UR],
  [UR, ML, LR],
  [LL, UC, LR],
  [UL, MR, LL],
];

function circle(
  mask: SpriteMask,
  spec: SpriteSpec,
  anchor: Anchor,
  filled: boolean,
): void {
  const { width: w, height: h, thickness } = spec;
  const x = anchor[0] * w;
  const y = anchor[1] * h;
  const radius = 0.5 * Math.min(w, h);
  const outer = circleRing(x, y, radius);
  if (filled) mask.fill(outer);
  else mask.fill(outer, [circleRing(x, y, radius - thickness)]);
}

function circleRing(x: number, y: number, radius: number): number[] {
  const count = Math.max(48, Math.ceil(radius) * 8);
  const ring: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    ring.push(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
  }
  return ring;
}

export function drawLegacyComputing(
  mask: SpriteMask,
  spec: SpriteSpec,
  codepoint: number,
): void {
  const { width: w, height: h, thickness } = spec;
  if (codepoint <= 0x1fb67) {
    drawMosaic(mask, spec, codepoint);
    return;
  }
  if (codepoint <= 0x1fb6f) {
    const edges: readonly Edge[] = ["left", "top", "right", "bottom"];
    const index = codepoint - 0x1fb68;
    drawEdgeTriangle(mask, spec, edges[index % 4], index < 4);
    return;
  }
  if (codepoint <= 0x1fb75) {
    // Vertical one-eighth bars, second to seventh column.
    const n = codepoint + 1 - 0x1fb70;
    fillFractions(mask, spec, n / 8, (n + 1) / 8, 0, 1);
    return;
  }
  if (codepoint <= 0x1fb7b) {
    const n = codepoint + 1 - 0x1fb76;
    fillFractions(mask, spec, 0, 1, n / 8, (n + 1) / 8);
    return;
  }
  switch (codepoint) {
    case 0x1fb7c:
      fillBlock(mask, spec, "left", "top", 1 / 8, 1);
      fillBlock(mask, spec, "left", "bottom", 1, 1 / 8);
      return;
    case 0x1fb7d:
      fillBlock(mask, spec, "left", "top", 1 / 8, 1);
      fillBlock(mask, spec, "left", "top", 1, 1 / 8);
      return;
    case 0x1fb7e:
      fillBlock(mask, spec, "right", "top", 1 / 8, 1);
      fillBlock(mask, spec, "left", "top", 1, 1 / 8);
      return;
    case 0x1fb7f:
      fillBlock(mask, spec, "right", "top", 1 / 8, 1);
      fillBlock(mask, spec, "left", "bottom", 1, 1 / 8);
      return;
    case 0x1fb80:
      fillBlock(mask, spec, "left", "top", 1, 1 / 8);
      fillBlock(mask, spec, "left", "bottom", 1, 1 / 8);
      return;
    case 0x1fb81:
      for (const row of [0, 2, 4, 7]) {
        fillFractions(mask, spec, 0, 1, row / 8, (row + 1) / 8);
      }
      return;
    case 0x1fb82:
    case 0x1fb83:
    case 0x1fb84:
    case 0x1fb85:
    case 0x1fb86:
      // Upper one quarter, three eighths, five eighths, three quarters,
      // seven eighths.
      fillBlock(
        mask,
        spec,
        "left",
        "top",
        1,
        [2, 3, 5, 6, 7][codepoint - 0x1fb82] / 8,
      );
      return;
    case 0x1fb87:
    case 0x1fb88:
    case 0x1fb89:
    case 0x1fb8a:
    case 0x1fb8b:
      fillBlock(
        mask,
        spec,
        "right",
        "top",
        [2, 3, 5, 6, 7][codepoint - 0x1fb87] / 8,
        1,
      );
      return;
    case 0x1fb8c:
      fillBlock(mask, spec, "left", "top", 1 / 2, 1, SHADE_MEDIUM);
      return;
    case 0x1fb8d:
      fillBlock(mask, spec, "right", "top", 1 / 2, 1, SHADE_MEDIUM);
      return;
    case 0x1fb8e:
      fillBlock(mask, spec, "left", "top", 1, 1 / 2, SHADE_MEDIUM);
      return;
    case 0x1fb8f:
      fillBlock(mask, spec, "left", "bottom", 1, 1 / 2, SHADE_MEDIUM);
      return;
    case 0x1fb90:
      mask.box(0, 0, w, h, SHADE_MEDIUM);
      return;
    case 0x1fb91:
      mask.box(0, 0, w, h, SHADE_MEDIUM);
      fillBlock(mask, spec, "left", "top", 1, 1 / 2);
      return;
    case 0x1fb92:
      mask.box(0, 0, w, h, SHADE_MEDIUM);
      fillBlock(mask, spec, "left", "bottom", 1, 1 / 2);
      return;
    case 0x1fb93:
      return; // Unassigned code point; draws nothing.
    case 0x1fb94:
      mask.box(0, 0, w, h, SHADE_MEDIUM);
      fillBlock(mask, spec, "right", "top", 1 / 2, 1);
      return;
    case 0x1fb95:
      checkerboard(mask, spec, 0);
      return;
    case 0x1fb96:
      checkerboard(mask, spec, 1);
      return;
    case 0x1fb97:
      mask.box(0, h >> 2, w, (2 * h) >> 2);
      mask.box(0, (3 * h) >> 2, w, h);
      return;
    case 0x1fb98:
      hatch(mask, spec, true);
      return;
    case 0x1fb99:
      hatch(mask, spec, false);
      return;
    case 0x1fb9a:
      mask.fill(edgeTriangle("top", spec));
      mask.fill(edgeTriangle("bottom", spec));
      return;
    case 0x1fb9b:
      mask.fill(edgeTriangle("left", spec));
      mask.fill(edgeTriangle("right", spec));
      return;
    case 0x1fb9c:
      mask.fill(cornerTriangle("tl", w, h), [], SHADE_MEDIUM);
      return;
    case 0x1fb9d:
      mask.fill(cornerTriangle("tr", w, h), [], SHADE_MEDIUM);
      return;
    case 0x1fb9e:
      mask.fill(cornerTriangle("br", w, h), [], SHADE_MEDIUM);
      return;
    case 0x1fb9f:
      mask.fill(cornerTriangle("bl", w, h), [], SHADE_MEDIUM);
      return;
    case 0x1fbaf:
      drawLines(mask, spec, LINE_HEAVY, LINE_LIGHT, LINE_HEAVY, LINE_LIGHT);
      return;
    case 0x1fbbd:
      diagonalUpperRightToLowerLeft(mask, spec);
      diagonalUpperLeftToLowerRight(mask, spec);
      mask.invert();
      return;
    case 0x1fbbe:
      cornerDiagonals(mask, spec, BR);
      mask.invert();
      return;
    case 0x1fbbf:
      cornerDiagonals(mask, spec, TL | TR | BL | BR);
      mask.invert();
      return;
    case 0x1fbce:
      fillBlock(mask, spec, "left", "top", 2 / 3, 1);
      return;
    case 0x1fbcf:
      fillBlock(mask, spec, "left", "top", 1 / 3, 1);
      return;
    case 0x1fbe0:
      circle(mask, spec, UC, false);
      return;
    case 0x1fbe1:
      circle(mask, spec, MR, false);
      return;
    case 0x1fbe2:
      circle(mask, spec, LC, false);
      return;
    case 0x1fbe3:
      circle(mask, spec, ML, false);
      return;
    case 0x1fbe4:
      fillBlock(mask, spec, "center", "top", 0.5, 0.5);
      return;
    case 0x1fbe5:
      fillBlock(mask, spec, "center", "bottom", 0.5, 0.5);
      return;
    case 0x1fbe6:
      fillBlock(mask, spec, "left", "middle", 0.5, 0.5);
      return;
    case 0x1fbe7:
      fillBlock(mask, spec, "right", "middle", 0.5, 0.5);
      return;
    case 0x1fbe8:
      circle(mask, spec, UC, true);
      return;
    case 0x1fbe9:
      circle(mask, spec, MR, true);
      return;
    case 0x1fbea:
      circle(mask, spec, LC, true);
      return;
    case 0x1fbeb:
      circle(mask, spec, ML, true);
      return;
    case 0x1fbec:
      circle(mask, spec, UR, true);
      return;
    case 0x1fbed:
      circle(mask, spec, LL, true);
      return;
    case 0x1fbee:
      circle(mask, spec, LR, true);
      return;
    case 0x1fbef:
      circle(mask, spec, UL, true);
      return;
  }
  if (codepoint >= 0x1fba0 && codepoint <= 0x1fbae) {
    cornerDiagonals(mask, spec, CORNER_DIAGONALS[codepoint - 0x1fba0]);
    return;
  }
  if (codepoint >= 0x1fbd0 && codepoint <= 0x1fbdf) {
    const chain = CELL_DIAGONALS[codepoint - 0x1fbd0];
    for (let index = 0; index + 1 < chain.length; index += 1) {
      mask.line(
        chain[index][0] * w,
        chain[index][1] * h,
        chain[index + 1][0] * w,
        chain[index + 1][1] * h,
        thickness,
      );
    }
  }
}
