import { describe, expect, it } from "vitest";
import {
  CELL_STRIDE,
  PackedCellView,
  writeNormalizedColor,
} from "./packedCells";

describe("PackedCellView", () => {
  it("reads the vendored 16-byte cell ABI without cell objects", () => {
    const bytes = new Uint8Array(CELL_STRIDE);
    new DataView(bytes.buffer).setUint32(0, 0x1f680, true);
    bytes.set([12, 34, 56, 78, 90, 123, 5, 2], 4);
    bytes[14] = 3;

    const cells = new PackedCellView(bytes);
    expect(cells.length).toBe(1);
    expect(cells.codepoint(0)).toBe(0x1f680);
    expect(cells.foreground(0)).toEqual([12, 34, 56]);
    expect(cells.background(0)).toEqual([78, 90, 123]);
    expect(cells.foregroundPacked(0)).toBe(0x0c2238);
    expect(cells.backgroundPacked(0)).toBe(0x4e5a7b);
    expect(cells.flags(0)).toBe(5);
    expect(cells.width(0)).toBe(2);
    expect(cells.graphemeLength(0)).toBe(3);
    expect(cells.underlineStyle(0)).toBe(1);
    expect(cells.underlineColorPacked(0)).toBe(0x0c2238);
    expect(cells.overline(0)).toBe(false);
  });

  it("writes normalized RGB channels into an existing arena", () => {
    const arena = new Float32Array(8);
    writeNormalizedColor(arena, 2, [255, 128, 0], 0.5);
    expect(arena[2]).toBe(1);
    expect(arena[3]).toBeCloseTo(128 / 255);
    expect(arena[4]).toBe(0);
    expect(arena[5]).toBe(0.5);
  });
});
