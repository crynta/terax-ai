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

type Region = { x: number; y: number; width: number; height: number };

function overlaps(left: Region, right: Region): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}
