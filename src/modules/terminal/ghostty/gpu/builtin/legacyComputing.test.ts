import { beforeAll, describe, expect, it } from "vitest";
import { loadLazyBuiltin } from "./lazyGlyphs";
import { SpriteMask } from "./SpriteMask";

type Helpers = typeof import("./legacyComputing");
let helpers: Helpers;

// The module takes its drawing helpers from `lazyGlyphs.ts` once it has loaded.
beforeAll(async () => {
  await loadLazyBuiltin();
  helpers = await import("./legacyComputing");
});

function sum(mask: SpriteMask): number {
  return mask.data.reduce((total, value) => total + value, 0) / 255;
}

describe("legacy computing mask helpers", () => {
  it("inverts every pixel", () => {
    const mask = new SpriteMask(3, 2);
    mask.box(0, 0, 1, 2, 200);
    helpers.invertMask(mask);
    expect(Array.from(mask.data)).toEqual([55, 255, 255, 55, 255, 255]);
  });

  it("insets a ring by a distance, and gives up when it collapses", () => {
    const mask = new SpriteMask(10, 10);
    helpers.outlineRing(mask, [0, 0, 10, 0, 10, 10, 0, 10], 2);
    // A square frame two pixels wide.
    expect(sum(mask)).toBe(100 - 36);
    expect(mask.data[1 * 10 + 1]).toBe(255);
    expect(mask.data[2 * 10 + 2]).toBe(0);
    // Thicker than the shape is wide: the whole shape is the outline.
    const solid = new SpriteMask(4, 4);
    helpers.outlineRing(solid, [0, 0, 4, 0, 4, 4, 0, 4], 3);
    expect(sum(solid)).toBe(16);
    const triangle = new SpriteMask(4, 8);
    helpers.outlineRing(triangle, [0, 0, 0, 8, 4, 0], 2);
    expect(sum(triangle)).toBeCloseTo(16, 0);
  });
});
