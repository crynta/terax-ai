/**
 * The procedural glyphs that load on first use (`lazyGlyphs.ts`): geometric
 * corner triangles (U+25E2..U+25E5, U+25F8..U+25FF), sextants (U+1FB00..U+1FB3B),
 * octants (U+1CD00..U+1CDE5) and the parts of Symbols for Legacy Computing
 * (U+1FB3C..U+1FBEF) that terminal UIs actually draw with: smooth mosaics,
 * one-eighth bars, half shades, checkerboards, diagonal fills and quarter
 * circles. Geometry follows Ghostty's sprite font
 * (`draw/symbols_for_legacy_computing.zig`, `geometric_shapes.zig`, MIT).
 */
import type { BuiltinTools } from "./lazyGlyphs";
import type { SpriteMask } from "./SpriteMask";
import type { SpriteSpec } from "./spriteSpec";

// The shared drawing helpers arrive from `lazyGlyphs.ts` (`bindBuiltinTools`). Importing
// them here would make the bundler cut the modules that hold them into a third chunk,
// shared by the terminal and this file, instead of leaving them where the terminal is.
let SHADE_MEDIUM: BuiltinTools["SHADE_MEDIUM"];
let LINE_HEAVY: BuiltinTools["LINE_HEAVY"];
let LINE_LIGHT: BuiltinTools["LINE_LIGHT"];
let fillBlock: BuiltinTools["fillBlock"];
let fillFractions: BuiltinTools["fillFractions"];
let drawLines: BuiltinTools["drawLines"];
let diagonalUpperLeftToLowerRight: BuiltinTools["diagonalUpperLeftToLowerRight"];
let diagonalUpperRightToLowerLeft: BuiltinTools["diagonalUpperRightToLowerLeft"];
let signedArea: BuiltinTools["signedArea"];

export function bindBuiltinTools(tools: BuiltinTools): void {
  ({
    SHADE_MEDIUM,
    LINE_HEAVY,
    LINE_LIGHT,
    fillBlock,
    fillFractions,
    drawLines,
    diagonalUpperLeftToLowerRight,
    diagonalUpperRightToLowerLeft,
    signedArea,
  } = tools);
}

type Ring = readonly number[];

/** Replaces every pixel with its complement. */
export function invertMask(mask: SpriteMask): void {
  const data = mask.data;
  for (let index = 0; index < data.length; index += 1) {
    data[index] = 255 - data[index];
  }
}

/**
 * `ring` moved inward by `distance` with mitered corners (exact for convex
 * shapes); null when the inset turns it inside out.
 */
function insetRing(ring: Ring, distance: number): number[] | null {
  const count = ring.length / 2;
  if (count < 3) return null;
  // With a y-down axis a positive area means the interior is right of travel.
  const side = signedArea(ring) >= 0 ? 1 : -1;
  const normals: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const dx = ring[next * 2] - ring[index * 2];
    const dy = ring[next * 2 + 1] - ring[index * 2 + 1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    normals.push((-dy * side) / length, (dx * side) / length);
  }
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = ((index + count - 1) % count) * 2;
    const after = index * 2;
    const dot =
      normals[before] * normals[after] +
      normals[before + 1] * normals[after + 1];
    const scale = distance / (1 + dot);
    result.push(
      ring[index * 2] + (normals[before] + normals[after]) * scale,
      ring[index * 2 + 1] + (normals[before + 1] + normals[after + 1]) * scale,
    );
  }
  // A collapsed inset has turned inside out: some edge now runs backwards.
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const before =
      (ring[next * 2] - ring[index * 2]) *
        (result[next * 2] - result[index * 2]) +
      (ring[next * 2 + 1] - ring[index * 2 + 1]) *
        (result[next * 2 + 1] - result[index * 2 + 1]);
    if (before <= 0) return null;
  }
  return result;
}

/**
 * Fills a closed outline of the given weight lying inside `ring`; a shape too
 * small to have an inside is filled solid.
 */
export function outlineRing(
  mask: SpriteMask,
  ring: Ring,
  thickness: number,
): void {
  const inner = insetRing(ring, thickness);
  mask.fill(ring, inner ? [inner] : []);
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
      outlineRing(mask, cornerTriangle("tl", w, h), thickness);
      return;
    case 0x25f9:
      outlineRing(mask, cornerTriangle("tr", w, h), thickness);
      return;
    case 0x25fa:
      outlineRing(mask, cornerTriangle("bl", w, h), thickness);
      return;
    case 0x25ff:
      outlineRing(mask, cornerTriangle("br", w, h), thickness);
      return;
  }
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
  if (inverted) invertMask(mask);
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
      invertMask(mask);
      return;
    case 0x1fbbe:
      cornerDiagonals(mask, spec, BR);
      invertMask(mask);
      return;
    case 0x1fbbf:
      cornerDiagonals(mask, spec, TL | TR | BL | BR);
      invertMask(mask);
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
