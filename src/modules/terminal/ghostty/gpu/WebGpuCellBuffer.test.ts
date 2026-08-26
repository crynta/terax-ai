import { describe, expect, it } from "vitest";
import type { GlyphEntry } from "./GlyphAtlas";
import {
  CELL_FLAG_OVERLINE,
  CELL_FLAG_STRIKETHROUGH,
  GLYPH_FLAG_BLINK,
  GLYPH_FLAG_INTRINSIC_COLOR,
  MAX_WEBGPU_SURFACE_CELLS,
  nextWebGpuCellCapacity,
  PACKED_INSTANCE_BYTES,
  writeCellInstance,
  writeGlyphInstance,
} from "./WebGpuCellBuffer";

describe("WebGPU packed cell buffers", () => {
  it("uses bounded growth without power-of-two over-allocation", () => {
    expect(nextWebGpuCellCapacity(0, 4_800)).toBe(5_632);
    expect(nextWebGpuCellCapacity(5_632, 5_000)).toBe(5_632);
    expect(nextWebGpuCellCapacity(5_632, 6_000)).toBe(8_448);
    expect(() =>
      nextWebGpuCellCapacity(0, MAX_WEBGPU_SURFACE_CELLS + 1),
    ).toThrow(RangeError);
  });

  it("packs one complete cell into 32 bytes", () => {
    const buffer = new ArrayBuffer(PACKED_INSTANCE_BYTES);
    const view = new DataView(buffer);
    writeCellInstance(
      view,
      0,
      10,
      20,
      9,
      18,
      0x123456,
      0xabcdef,
      0x102030,
      CELL_FLAG_STRIKETHROUGH | CELL_FLAG_OVERLINE,
    );

    expect(view.getFloat32(0, true)).toBe(10);
    expect([...new Uint8Array(buffer, 16, 4)]).toEqual([0x12, 0x34, 0x56, 255]);
    expect([...new Uint8Array(buffer, 20, 4)]).toEqual([0xab, 0xcd, 0xef, 255]);
    expect(view.getUint32(28, true)).toBe(
      CELL_FLAG_STRIKETHROUGH | CELL_FLAG_OVERLINE,
    );
  });

  it("packs quantized UVs, color, alpha, and glyph flags into 32 bytes", () => {
    const buffer = new ArrayBuffer(PACKED_INSTANCE_BYTES);
    const view = new DataView(buffer);
    const glyph: GlyphEntry = {
      originOffsetX: 0,
      originOffsetY: 0,
      width: 10,
      height: 20,
      uvMinX: 0.25,
      uvMinY: 0.5,
      uvMaxX: 0.75,
      uvMaxY: 1,
      intrinsicColor: true,
    };
    writeGlyphInstance(
      view,
      0,
      1,
      2,
      10,
      glyph,
      glyph.uvMinX,
      0xabcdef,
      0.5,
      GLYPH_FLAG_INTRINSIC_COLOR | GLYPH_FLAG_BLINK,
    );

    expect(view.getUint16(48, true)).toBeCloseTo(16_384, -1);
    expect(view.getUint16(54, true)).toBe(65_535);
    expect([...new Uint8Array(buffer, 56, 4)]).toEqual([0xab, 0xcd, 0xef, 128]);
    expect(view.getUint32(60, true)).toBe(3);
  });
});
