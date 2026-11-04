import { describe, expect, it } from "vitest";
import {
  clampScrollSpeed,
  cursorKeySequence,
  DEFAULT_SCROLL_SPEED,
  MAX_SCROLL_SPEED,
  MIN_SCROLL_SPEED,
  WheelAccumulator,
  wheelLines,
  wheelRoute,
} from "./terminalWheel";

describe("wheelLines", () => {
  it.each([
    [40, 0, 20, 24, 1, 2],
    [-30, 0, 20, 24, 1, -1.5],
    [3, 1, 20, 24, 1, 3],
    [-1, 2, 20, 24, 1, -24],
    [40, 0, 20, 24, 0.5, 1],
    [3, 1, 20, 24, 2, 6],
    [100, 0, 0, 24, 1, 100],
    [10, 0, 20, 24, 0, 0],
  ])(
    "%s px/lines in mode %s -> %s lines",
    (delta, mode, cell, rows, speed, lines) => {
      expect(wheelLines(delta, mode, cell, rows, speed)).toBeCloseTo(lines);
    },
  );

  it("treats non-finite input as no motion", () => {
    for (const delta of [Number.NaN, Infinity, -Infinity])
      expect(wheelLines(delta, 0, 20, 24, 1)).toBe(0);
    expect(wheelLines(10, 0, 20, 24, Number.NaN)).toBe(0);
  });
});

describe("wheelRoute", () => {
  const base = {
    mouseTracking: false,
    shiftKey: false,
    alternateScreen: false,
    alternateScroll: false,
  };

  it.each([
    [{}, "scrollback"],
    [{ mouseTracking: true }, "report"],
    [{ mouseTracking: true, shiftKey: true }, "scrollback"],
    [{ alternateScreen: true }, "scrollback"],
    [{ alternateScreen: true, alternateScroll: true }, "arrows"],
    [
      { alternateScreen: true, alternateScroll: true, mouseTracking: true },
      "report",
    ],
    [
      {
        alternateScreen: true,
        alternateScroll: true,
        mouseTracking: true,
        shiftKey: true,
      },
      "arrows",
    ],
    [{ alternateScroll: true }, "scrollback"],
  ] as const)("%j -> %s", (state, route) => {
    expect(wheelRoute({ ...base, ...state })).toBe(route);
  });
});

describe("WheelAccumulator", () => {
  it("emits whole lines and keeps the fraction", () => {
    const wheel = new WheelAccumulator();
    expect(wheel.push("report", 0.4)).toBe(0);
    expect(wheel.push("report", 0.4)).toBe(0);
    expect(wheel.push("report", 0.4)).toBe(1);
    expect(wheel.push("report", 2.3)).toBe(2);
    expect(wheel.push("report", 0.7)).toBe(1);
  });

  it("is exact over a long trackpad stream", () => {
    const wheel = new WheelAccumulator();
    let total = 0;
    for (let i = 0; i < 1000; i++) total += wheel.push("report", 0.05);
    expect(total).toBeGreaterThanOrEqual(49);
    expect(total).toBeLessThanOrEqual(50);
  });

  it("drops the fraction on reversal", () => {
    const wheel = new WheelAccumulator();
    wheel.push("report", 0.75);
    expect(wheel.push("report", -0.5)).toBe(0);
    expect(wheel.push("report", -0.5)).toBe(-1);
  });

  it("drops the fraction when the route changes", () => {
    const wheel = new WheelAccumulator();
    wheel.push("report", 0.75);
    expect(wheel.push("scrollback", 0.5)).toBe(0);
    expect(wheel.push("report", 0.5)).toBe(0);
  });

  it("caps a burst and never queues the excess", () => {
    const wheel = new WheelAccumulator();
    expect(wheel.push("arrows", 500, 10)).toBe(10);
    expect(wheel.push("arrows", -500, 10)).toBe(-10);
    expect(wheel.push("arrows", 0.5, 10)).toBe(0);
    expect(wheel.push("arrows", 0.5, 10)).toBe(1);
  });

  it("ignores non-finite and zero motion", () => {
    const wheel = new WheelAccumulator();
    wheel.push("report", 0.5);
    for (const lines of [0, Number.NaN, Infinity, -Infinity])
      expect(wheel.push("report", lines)).toBe(0);
    expect(wheel.push("report", 0.5)).toBe(1);
  });

  it("forgets everything on reset", () => {
    const wheel = new WheelAccumulator();
    wheel.push("report", 0.75);
    wheel.reset();
    expect(wheel.push("report", 0.5)).toBe(0);
  });
});

describe("cursorKeySequence", () => {
  it.each([
    ["up", false, "\x1b[A"],
    ["down", false, "\x1b[B"],
    ["up", true, "\x1bOA"],
    ["down", true, "\x1bOB"],
  ] as const)(
    "%s (application cursor keys: %s)",
    (direction, application, sequence) => {
      expect(cursorKeySequence(direction, application)).toBe(sequence);
    },
  );
});

describe("clampScrollSpeed", () => {
  it.each([
    [1, 1],
    [0.25, 0.25],
    [2.345, 2.35],
    [0, MIN_SCROLL_SPEED],
    [-3, MIN_SCROLL_SPEED],
    [1000, MAX_SCROLL_SPEED],
    [Number.NaN, DEFAULT_SCROLL_SPEED],
    [Infinity, DEFAULT_SCROLL_SPEED],
    ["2", DEFAULT_SCROLL_SPEED],
    [null, DEFAULT_SCROLL_SPEED],
    [undefined, DEFAULT_SCROLL_SPEED],
  ])("%s -> %s", (value, expected) => {
    expect(clampScrollSpeed(value)).toBe(expected);
  });
});
