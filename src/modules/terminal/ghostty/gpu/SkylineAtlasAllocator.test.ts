import { describe, expect, it } from "vitest";
import { SkylineAtlasAllocator } from "./SkylineAtlasAllocator";

describe("SkylineAtlasAllocator", () => {
  it("packs bounded regions without overlap", () => {
    const allocator = new SkylineAtlasAllocator(16, 16);
    const regions = [
      allocator.allocate(8, 4),
      allocator.allocate(4, 8),
      allocator.allocate(4, 4),
      allocator.allocate(8, 4),
    ];

    const allocated = regions.filter((region) => region !== null);
    expect(allocated).toHaveLength(regions.length);
    for (let left = 0; left < allocated.length; left += 1) {
      for (let right = left + 1; right < allocated.length; right += 1) {
        expect(overlaps(allocated[left], allocated[right])).toBe(false);
      }
    }
  });

  it("refuses overflow and reuses the full budget after reset", () => {
    const allocator = new SkylineAtlasAllocator(8, 8);
    expect(allocator.allocate(8, 8)).not.toBeNull();
    expect(allocator.allocate(1, 1)).toBeNull();
    allocator.reset();
    expect(allocator.allocate(8, 8)).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
  });
});

describe("SkylineAtlasAllocator growth", () => {
  it("extends the free area without moving existing regions", () => {
    const allocator = new SkylineAtlasAllocator(8, 8);
    const first = allocator.allocate(8, 8);
    expect(first).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(allocator.allocate(1, 1)).toBeNull();

    allocator.grow(16, 16);
    expect(allocator.width).toBe(16);
    expect(allocator.height).toBe(16);
    const regions = [
      allocator.allocate(8, 8),
      allocator.allocate(8, 8),
      allocator.allocate(8, 8),
    ];
    expect(regions.every((region) => region !== null)).toBe(true);
    for (const region of regions) {
      if (region && first) expect(overlaps(region, first)).toBe(false);
    }
    expect(allocator.allocate(8, 8)).toBeNull();
  });

  it("keeps the larger area after a reset and refuses to shrink", () => {
    const allocator = new SkylineAtlasAllocator(4, 4);
    allocator.grow(8, 8);
    allocator.allocate(8, 8);
    allocator.reset();
    expect(allocator.allocate(8, 8)).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    expect(() => allocator.grow(4, 4)).toThrow(RangeError);
  });
});

type Region = { x: number; y: number; width: number; height: number };

function overlaps(left: Region, right: Region): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}
