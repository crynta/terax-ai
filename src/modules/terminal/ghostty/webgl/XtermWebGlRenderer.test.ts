import { describe, expect, it } from "vitest";
import type { TerminalGpuTheme } from "../gpu/terminalVisuals";
import {
  nextWebGlCellCapacity,
  rendererProfileKey,
  resetGlyphGrid,
  type WebGlRendererProfile,
} from "./XtermWebGlRenderer";

const theme: TerminalGpuTheme = {
  background: [0, 0, 0],
  foreground: [255, 255, 255],
  cursor: [255, 255, 255],
  selection: { color: [80, 100, 200], alpha: 0.4 },
  palette: [],
};

function profile(scale = 2): WebGlRendererProfile {
  return {
    metrics: {
      font: {
        family: "JetBrains Mono",
        size: 14,
        lineHeight: 1.2,
        letterSpacing: 0,
        weight: "400",
      },
      cellWidth: 9,
      cellHeight: 18,
      baseline: 14,
    },
    theme,
    scale,
  };
}

describe("rendererProfileKey", () => {
  it("reuses monochrome atlases across terminal color themes", () => {
    const first = profile();
    const second: WebGlRendererProfile = {
      ...first,
      theme: {
        ...theme,
        foreground: [120, 200, 40],
        background: [20, 25, 30],
      },
    };

    expect(rendererProfileKey(first)).toBe(rendererProfileKey(second));
  });

  it("separates atlases when device scale or font geometry changes", () => {
    expect(rendererProfileKey(profile(1))).not.toBe(
      rendererProfileKey(profile(2)),
    );
    expect(rendererProfileKey(profile())).not.toBe(
      rendererProfileKey({
        ...profile(),
        metrics: { ...profile().metrics, cellWidth: 10 },
      }),
    );
  });
});

describe("resetGlyphGrid", () => {
  it("restores every static cell position after renderer reuse", () => {
    const attributes = new Float32Array(4 * 15);
    attributes.fill(7);

    resetGlyphGrid(attributes, 2, 2);

    expect([...attributes.subarray(0, 13)]).toEqual(Array(13).fill(0));
    expect([...attributes.subarray(13, 15)]).toEqual([0, 0]);
    expect([...attributes.subarray(28, 30)]).toEqual([0.5, 0]);
    expect([...attributes.subarray(43, 45)]).toEqual([0, 0.5]);
    expect([...attributes.subarray(58, 60)]).toEqual([0.5, 0.5]);
  });

  it("rejects a grid whose retained storage does not match its dimensions", () => {
    expect(() => resetGlyphGrid(new Float32Array(13), 1, 1)).toThrow(
      RangeError,
    );
  });

  it("accepts retained capacity larger than the active terminal grid", () => {
    const attributes = new Float32Array(8 * 15);
    attributes.fill(7);

    resetGlyphGrid(attributes, 2, 2);

    expect([...attributes.subarray(0, 13)]).toEqual(Array(13).fill(0));
    expect([...attributes.subarray(58, 60)]).toEqual([0.5, 0.5]);
    expect([...attributes.subarray(60)]).toEqual(Array(60).fill(7));
  });
});

describe("nextWebGlCellCapacity", () => {
  it("retains adjacent resize capacity instead of reallocating every step", () => {
    const initial = nextWebGlCellCapacity(0, 80 * 24);
    const wider = nextWebGlCellCapacity(initial, 81 * 24);
    const smaller = nextWebGlCellCapacity(wider, 79 * 23);

    expect(initial).toBeGreaterThanOrEqual(80 * 24);
    expect(wider).toBe(initial);
    expect(smaller).toBe(initial);
  });

  it("grows with bounded headroom and enforces the surface limit", () => {
    const initial = nextWebGlCellCapacity(0, 1_000);
    expect(initial).toBe(1_280);
    expect(nextWebGlCellCapacity(initial, 2_000)).toBe(2_048);
    expect(() => nextWebGlCellCapacity(0, 262_145)).toThrow(RangeError);
  });
});
