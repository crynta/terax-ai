import { describe, expect, it } from "vitest";
import {
  gestureBackingBound,
  type GestureBackingEnvironment,
} from "./GestureBacking";

function environment(
  overrides: Partial<GestureBackingEnvironment> = {},
): GestureBackingEnvironment {
  return {
    host: { width: 1000, height: 600 },
    scale: 2,
    windowResized: true,
    area: { width: 1100, height: 700 },
    windowInner: { width: 1200, height: 800 },
    screenAvailable: { width: 1728, height: 1079 },
    maxDimension: 16384,
    ...overrides,
  };
}

describe("gestureBackingBound", () => {
  it("lets a window drag grow a pane by at most the room the screen leaves", () => {
    expect(gestureBackingBound(environment())).toEqual({
      width: (1000 + (1728 - 1200)) * 2,
      height: (600 + (1079 - 800)) * 2,
    });
  });

  it("has no room to grow when the window already fills the screen", () => {
    expect(
      gestureBackingBound(
        environment({ windowInner: { width: 1728, height: 1100 } }),
      ),
    ).toEqual({ width: 2000, height: 1200 });
  });

  it("bounds a layout change in a window that keeps its size by the terminal area", () => {
    expect(
      gestureBackingBound(
        environment({
          windowResized: false,
          host: { width: 540, height: 700 },
        }),
      ),
    ).toEqual({ width: 1100 * 2, height: 700 * 2 });
  });

  it("falls back to the window when the terminal area cannot be found", () => {
    expect(
      gestureBackingBound(environment({ windowResized: false, area: null })),
    ).toEqual({ width: 1200 * 2, height: 800 * 2 });
  });

  it("never exceeds what the device can allocate", () => {
    expect(
      gestureBackingBound(
        environment({
          screenAvailable: { width: 6000, height: 6000 },
          maxDimension: 8192,
        }),
      ),
    ).toEqual({ width: 8192, height: 8192 });
  });

  it("rounds fractional device sizes up so the pane always fits", () => {
    const bound = gestureBackingBound(
      environment({ scale: 1.25, host: { width: 801.3, height: 500.1 } }),
    );
    expect(bound.width).toBe(Math.ceil((801.3 + 528) * 1.25));
    expect(Number.isInteger(bound.height)).toBe(true);
  });

  it("falls back to the host size instead of producing NaN when the browser state is unreadable", () => {
    const bound = gestureBackingBound(
      environment({
        windowInner: { width: Number.NaN, height: Number.NaN },
        screenAvailable: { width: Number.NaN, height: 0 },
      }),
    );
    expect(bound).toEqual({ width: 2000, height: 1200 });
  });
});
