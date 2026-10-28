import { describe, expect, it } from "vitest";
import {
  compactWebGpuCellCapacity,
  MAX_WEBGPU_SURFACE_CELLS,
  nextWebGpuCellCapacity,
  packSearchMask,
} from "./WebGpuCellBuffer";

describe("WebGPU cell buffer capacity", () => {
  it("uses bounded growth without power-of-two over-allocation", () => {
    expect(nextWebGpuCellCapacity(0, 4_800)).toBe(5_632);
    expect(nextWebGpuCellCapacity(5_632, 5_000)).toBe(5_632);
    expect(nextWebGpuCellCapacity(5_632, 6_000)).toBe(8_448);
    expect(() =>
      nextWebGpuCellCapacity(0, MAX_WEBGPU_SURFACE_CELLS + 1),
    ).toThrow(RangeError);
  });

  it("compacts only after a materially oversized viewport", () => {
    expect(compactWebGpuCellCapacity(8_448, 4_800)).toBeNull();
    expect(compactWebGpuCellCapacity(16_384, 4_800)).toBe(5_632);
    expect(compactWebGpuCellCapacity(16_384, 8_000)).toBeNull();
  });
});

describe("search mask packing", () => {
  it("pads the per-cell mask to whole words and reuses scratch memory", () => {
    const scratch = new Uint8Array(16);
    scratch.fill(9);
    const packed = packSearchMask(Uint8Array.of(1, 2, 0, 1, 2), scratch);
    expect([...packed]).toEqual([1, 2, 0, 1, 2, 0, 0, 0]);
    expect(packed.buffer).toBe(scratch.buffer);
  });

  it("never produces a zero-sized binding", () => {
    expect(packSearchMask(new Uint8Array(0), new Uint8Array(0))).toHaveLength(
      4,
    );
  });
});
