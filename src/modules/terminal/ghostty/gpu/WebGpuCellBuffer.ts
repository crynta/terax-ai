import type { GlyphEntry } from "./GlyphAtlas";

export const CELL_INSTANCE_BYTES = 32;
export const GLYPH_INSTANCE_BYTES = 32;
export const PACKED_INSTANCE_BYTES = CELL_INSTANCE_BYTES + GLYPH_INSTANCE_BYTES;
export const SCREEN_UNIFORM_BYTES = 64;
export const MAX_WEBGPU_SURFACE_CELLS = 262_144;

export const CELL_FLAG_UNDERLINE_MASK = 0x7;
export const CELL_FLAG_STRIKETHROUGH = 1 << 3;
export const CELL_FLAG_OVERLINE = 1 << 4;

export const GLYPH_FLAG_INTRINSIC_COLOR = 1;
export const GLYPH_FLAG_BLINK = 1 << 1;
export const GLYPH_FLAG_COVERAGE_RED = 1 << 2;

const CAPACITY_ALIGNMENT = 256;
const MIN_CELL_CAPACITY = 1_024;

export function nextWebGpuCellCapacity(
  current: number,
  required: number,
): number {
  if (!Number.isInteger(required) || required < 0) {
    throw new RangeError("WebGPU cell capacity must be a non-negative integer");
  }
  if (required > MAX_WEBGPU_SURFACE_CELLS) {
    throw new RangeError(
      `Terminal surface exceeds ${MAX_WEBGPU_SURFACE_CELLS} cells`,
    );
  }
  if (required <= current) return current;
  const target =
    current > 0
      ? Math.max(required, Math.ceil(current * 1.5))
      : Math.max(MIN_CELL_CAPACITY, Math.ceil(required * 1.125));
  return Math.min(
    MAX_WEBGPU_SURFACE_CELLS,
    Math.ceil(target / CAPACITY_ALIGNMENT) * CAPACITY_ALIGNMENT,
  );
}

export function writeCellInstance(
  view: DataView,
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
  background: number,
  underline: number,
  foreground: number,
  flags: number,
): void {
  const offset = index * PACKED_INSTANCE_BYTES;
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, width, true);
  view.setFloat32(offset + 12, height, true);
  writePackedColor(view, offset + 16, background, 1);
  writePackedColor(view, offset + 20, underline, 1);
  writePackedColor(view, offset + 24, foreground, 1);
  view.setUint32(offset + 28, flags, true);
}

export function clearCellInstance(bytes: Uint8Array, index: number): void {
  const offset = index * PACKED_INSTANCE_BYTES;
  bytes.fill(0, offset, offset + CELL_INSTANCE_BYTES);
}

export function writeGlyphInstance(
  view: DataView,
  index: number,
  x: number,
  y: number,
  width: number,
  glyph: GlyphEntry,
  uvMinX: number,
  color: number,
  alpha: number,
  flags: number,
): void {
  const offset = index * PACKED_INSTANCE_BYTES + CELL_INSTANCE_BYTES;
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, width, true);
  view.setFloat32(offset + 12, glyph.height, true);
  view.setUint16(offset + 16, normalizedUint16(uvMinX), true);
  view.setUint16(offset + 18, normalizedUint16(glyph.uvMinY), true);
  view.setUint16(offset + 20, normalizedUint16(glyph.uvMaxX), true);
  view.setUint16(offset + 22, normalizedUint16(glyph.uvMaxY), true);
  writePackedColor(view, offset + 24, color, alpha);
  view.setUint32(offset + 28, flags, true);
}

export function clearGlyphInstance(bytes: Uint8Array, index: number): void {
  const offset = index * PACKED_INSTANCE_BYTES + CELL_INSTANCE_BYTES;
  bytes.fill(0, offset, offset + GLYPH_INSTANCE_BYTES);
}

function writePackedColor(
  view: DataView,
  offset: number,
  color: number,
  alpha: number,
): void {
  view.setUint8(offset, (color >> 16) & 0xff);
  view.setUint8(offset + 1, (color >> 8) & 0xff);
  view.setUint8(offset + 2, color & 0xff);
  view.setUint8(offset + 3, Math.round(clamp01(alpha) * 255));
}

function normalizedUint16(value: number): number {
  return Math.round(clamp01(value) * 65_535);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
