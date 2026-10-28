import { describe, expect, it } from "vitest";
import {
  canvasOriginDevice,
  clampToCanvas,
  cssRectsEqual,
  deviceRectsEqual,
  snapPaneRect,
} from "./PaneRects";

const AREA = { left: 250.5, top: 40.25, width: 900, height: 600 };

describe("snapPaneRect", () => {
  it.each([1, 1.25, 1.5, 1.75, 2, 3])(
    "returns whole device pixels relative to the canvas origin at %s",
    (scale) => {
      const rect = snapPaneRect(
        { left: 250.5 + 13.3, top: 40.25 + 7.9, width: 301.7, height: 222.2 },
        AREA,
        scale,
      );
      for (const value of Object.values(rect))
        expect(Number.isInteger(value)).toBe(true);
      const origin = canvasOriginDevice(AREA, scale);
      expect(rect.x).toBe(Math.round((250.5 + 13.3) * scale) - origin.x);
      expect(rect.y).toBe(Math.round((40.25 + 7.9) * scale) - origin.y);
    },
  );

  it("puts a pane that fills the area at the canvas origin with the area's size", () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
      const rect = snapPaneRect(AREA, AREA, scale);
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.width).toBe(
        Math.round((AREA.left + AREA.width) * scale) -
          Math.round(AREA.left * scale),
      );
    }
  });

  it("keeps neighbours apart by exactly the divider between them, at fractional ratios", () => {
    // A 2x2 split with a 1 CSS pixel divider and fractional pane sizes (percent layout).
    for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
      const area = { left: 100.3, top: 20.7, width: 801, height: 601 };
      const half = (800 - 1) / 2;
      const left = { left: 100.3, top: 20.7, width: half + 1, height: 300 };
      const right = {
        left: 100.3 + half + 1 + 1,
        top: 20.7,
        width: half,
        height: 300,
      };
      const a = snapPaneRect(left, area, scale);
      const b = snapPaneRect(right, area, scale);
      // No overlap, and the gap is the divider's device width (within the rounding of its edges).
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
      expect(b.x - (a.x + a.width)).toBeLessThanOrEqual(Math.ceil(scale) + 1);
    }
  });

  it("never reports a negative size for a degenerate pane", () => {
    const rect = snapPaneRect(
      { left: 10, top: 10, width: -5, height: Number.NaN },
      AREA,
      2,
    );
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });
});

describe("clampToCanvas", () => {
  it("keeps a rectangle that fits unchanged", () => {
    expect(
      clampToCanvas({ x: 10, y: 20, width: 100, height: 50 }, 800, 600),
    ).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("cuts what leaves the canvas so a viewport or scissor stays valid", () => {
    expect(
      clampToCanvas({ x: 700, y: 500, width: 200, height: 200 }, 800, 600),
    ).toEqual({ x: 700, y: 500, width: 100, height: 100 });
    expect(
      clampToCanvas({ x: -3, y: -2, width: 100, height: 100 }, 800, 600),
    ).toEqual({ x: 0, y: 0, width: 97, height: 98, clipX: 3, clipY: 2 });
  });

  it("reports only the side that is cut off at the left or top, never the right or bottom", () => {
    expect(
      clampToCanvas({ x: -5, y: 10, width: 100, height: 700 }, 800, 600),
    ).toEqual({ x: 0, y: 10, width: 95, height: 590, clipX: 5, clipY: 0 });
    const right = clampToCanvas(
      { x: 700, y: 500, width: 200, height: 200 },
      800,
      600,
    );
    expect(right?.clipX).toBeUndefined();
    expect(right?.clipY).toBeUndefined();
  });

  it("returns null when nothing is inside", () => {
    expect(
      clampToCanvas({ x: 800, y: 0, width: 10, height: 10 }, 800, 600),
    ).toBeNull();
    expect(
      clampToCanvas({ x: 0, y: 0, width: 0, height: 10 }, 800, 600),
    ).toBeNull();
  });
});

describe("equality", () => {
  it("compares rectangles by value and treats null as unequal to any rectangle", () => {
    expect(
      deviceRectsEqual(
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 1, y: 2, width: 3, height: 4 },
      ),
    ).toBe(true);
    expect(
      deviceRectsEqual(
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 1, y: 2, width: 3, height: 5 },
      ),
    ).toBe(false);
    // A pane clipped by a different amount is a different rectangle even at the same viewport.
    expect(
      deviceRectsEqual(
        { x: 0, y: 0, width: 3, height: 4, clipX: 2 },
        { x: 0, y: 0, width: 3, height: 4, clipX: 3 },
      ),
    ).toBe(false);
    expect(
      deviceRectsEqual(
        { x: 0, y: 0, width: 3, height: 4, clipX: 0 },
        { x: 0, y: 0, width: 3, height: 4 },
      ),
    ).toBe(true);
    expect(deviceRectsEqual(null, null)).toBe(true);
    expect(deviceRectsEqual(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(
      false,
    );
    expect(
      cssRectsEqual(
        { left: 1, top: 2, width: 3, height: 4 },
        { left: 1, top: 2, width: 3, height: 4 },
      ),
    ).toBe(true);
    expect(cssRectsEqual({ left: 1, top: 2, width: 3, height: 4 }, null)).toBe(
      false,
    );
  });
});
