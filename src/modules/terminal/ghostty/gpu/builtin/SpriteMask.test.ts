import { describe, expect, it } from "vitest";
import { flattenCubic, SpriteMask } from "./SpriteMask";

function sum(mask: SpriteMask): number {
  return mask.data.reduce((total, value) => total + value, 0) / 255;
}

/** One string per row: `.` empty, `#` full, `?` partial. */
function art(mask: SpriteMask): string[] {
  return Array.from({ length: mask.height }, (_, y) =>
    Array.from(mask.data.subarray(y * mask.width, (y + 1) * mask.width))
      .map((value) => (value === 0 ? "." : value === 255 ? "#" : "?"))
      .join(""),
  );
}

describe("SpriteMask rectangles", () => {
  it("overwrites whole pixels and clips to the cell", () => {
    const mask = new SpriteMask(6, 4);
    mask.box(-3, -3, 2, 2);
    mask.box(4, 3, 99, 99);
    expect(art(mask)).toEqual(["##....", "##....", "......", "....##"]);
    // Coordinates in either order, and a later box replaces an earlier shade.
    mask.box(5, 1, 3, 0, 128);
    expect(mask.data[0 * 6 + 3]).toBe(128);
    expect(mask.data[0 * 6 + 4]).toBe(128);
    expect(mask.data[0 * 6 + 5]).toBe(0);
  });

  it("flips and inverts", () => {
    const mask = new SpriteMask(3, 2);
    mask.box(0, 0, 1, 2, 200);
    mask.flipHorizontal();
    expect(Array.from(mask.data)).toEqual([0, 0, 200, 0, 0, 200]);
    mask.invert();
    expect(Array.from(mask.data)).toEqual([255, 255, 55, 255, 255, 55]);
  });
});

describe("SpriteMask polygons", () => {
  it("covers axis-aligned pixel squares exactly, whatever the winding", () => {
    for (const ring of [
      [1, 1, 3, 1, 3, 3, 1, 3],
      [1, 1, 1, 3, 3, 3, 3, 1],
    ]) {
      const mask = new SpriteMask(4, 4);
      mask.fill(ring);
      expect(art(mask)).toEqual(["....", ".##.", ".##.", "...."]);
    }
  });

  it("fills a half pixel to 50% and a diagonal triangle to its exact area", () => {
    const half = new SpriteMask(2, 2);
    half.fill([0.5, 0, 1.5, 0, 1.5, 2, 0.5, 2]);
    expect(Array.from(half.data)).toEqual([128, 128, 128, 128]);

    const triangle = new SpriteMask(8, 8);
    triangle.fill([0, 0, 8, 0, 0, 8]);
    expect(sum(triangle)).toBeCloseTo(32, 0);
    // The hypotenuse pixels are half covered, the rest full or empty.
    expect(triangle.data[0 * 8 + 0]).toBe(255);
    expect(triangle.data[0 * 8 + 7]).toBe(128);
    expect(triangle.data[7 * 8 + 0]).toBe(128);
    expect(triangle.data[7 * 8 + 7]).toBe(0);
  });

  it("clips shapes that extend past the cell", () => {
    const mask = new SpriteMask(4, 4);
    mask.fill([-10, -10, 20, -10, 20, 20, -10, 20]);
    expect(mask.data.every((value) => value === 255)).toBe(true);
    const corner = new SpriteMask(4, 4);
    corner.fill([2, 2, 40, 2, 40, 40, 2, 40]);
    expect(sum(corner)).toBe(4);
  });

  it("subtracts holes and composites source-over", () => {
    const mask = new SpriteMask(6, 6);
    mask.fill([0, 0, 6, 0, 6, 6, 0, 6], [[2, 2, 4, 2, 4, 4, 2, 4]]);
    expect(sum(mask)).toBe(32);
    expect(mask.data[3 * 6 + 3]).toBe(0);
    const layered = new SpriteMask(2, 2);
    layered.fill([0, 0, 2, 0, 2, 2, 0, 2], [], 128);
    layered.fill([0, 0, 2, 0, 2, 2, 0, 2], [], 128);
    // 128 over 128 is 192, not 255 and not 128.
    expect(layered.data[0]).toBe(192);
  });

  it("ignores degenerate polygons", () => {
    const mask = new SpriteMask(4, 4);
    mask.fill([1, 1, 2, 2]);
    mask.fill([1, 1, 3, 3, 2, 2]);
    expect(sum(mask)).toBe(0);
  });
});

describe("SpriteMask strokes", () => {
  it("strokes an axis-aligned segment with butt caps as an exact band", () => {
    const mask = new SpriteMask(8, 6);
    mask.line(0, 3, 8, 3, 2);
    for (let y = 0; y < 6; y += 1) {
      const expected = y === 2 || y === 3 ? 255 : 0;
      for (let x = 0; x < 8; x += 1) {
        expect(mask.data[y * 8 + x]).toBe(expected);
      }
    }
    // Short of the cell edge: no cap past the end point.
    const short = new SpriteMask(8, 6);
    short.line(2, 3, 6, 3, 2);
    expect(short.data[2 * 8 + 1]).toBe(0);
    expect(short.data[2 * 8 + 2]).toBe(255);
    expect(short.data[2 * 8 + 5]).toBe(255);
    expect(short.data[2 * 8 + 6]).toBe(0);
  });

  it("joins a right-angle turn with a mitred outer corner", () => {
    const mask = new SpriteMask(8, 8);
    mask.stroke([1, 6, 1, 1, 6, 1], 2);
    // The outer corner pixel is filled, the inner one is not.
    expect(mask.data[0 * 8 + 0]).toBe(255);
    expect(mask.data[2 * 8 + 2]).toBe(0);
    expect(mask.data[0 * 8 + 5]).toBe(255);
    expect(mask.data[5 * 8 + 0]).toBe(255);
  });

  it("offsets a stroke sideways by `inset`, to the right of travel", () => {
    const mask = new SpriteMask(8, 8);
    // Travelling right along y = 2 with 2px width, moved 1px to the right of
    // travel (downwards on screen): rows 2 and 3.
    mask.stroke([0, 2, 8, 2], 2, 1);
    expect(Array.from({ length: 8 }, (_, y) => mask.data[y * 8 + 4])).toEqual([
      0, 0, 255, 255, 0, 0, 0, 0,
    ]);
  });

  it("falls back to a bevel past the miter limit instead of spiking", () => {
    const mask = new SpriteMask(40, 40);
    // A hairpin: the miter would be enormous.
    mask.stroke([2, 20, 36, 20, 2, 21], 2);
    expect(sum(mask)).toBeLessThan(200);
  });

  it("insets a ring by a distance, and gives up when it collapses", () => {
    const mask = new SpriteMask(10, 10);
    mask.outline([0, 0, 10, 0, 10, 10, 0, 10], 2);
    // A square frame two pixels wide.
    expect(sum(mask)).toBe(100 - 36);
    expect(mask.data[1 * 10 + 1]).toBe(255);
    expect(mask.data[2 * 10 + 2]).toBe(0);
    // Thicker than the shape is wide: the whole shape is the outline.
    const solid = new SpriteMask(4, 4);
    solid.outline([0, 0, 4, 0, 4, 4, 0, 4], 3);
    expect(sum(solid)).toBe(16);
    const triangle = new SpriteMask(4, 8);
    triangle.outline([0, 0, 0, 8, 4, 0], 2);
    expect(sum(triangle)).toBeCloseTo(16, 0);
  });
});

describe("flattenCubic", () => {
  it("ends at the last control point and stays on the curve", () => {
    const points: number[] = [];
    flattenCubic(points, 0, 0, 0, 10, 10, 10, 10, 0, 8);
    expect(points).toHaveLength(16);
    expect(points.slice(-2)).toEqual([10, 0]);
    // The midpoint of this symmetric curve is (5, 7.5).
    expect(points[3 * 2]).toBeCloseTo(5, 9);
    expect(points[3 * 2 + 1]).toBeCloseTo(7.5, 9);
  });
});
