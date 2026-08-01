import { describe, expect, it } from "vitest";
import { blockIndexAt, computeRange, type MarkerLike } from "./blockRange";

const marker = (line: number, isDisposed = false): MarkerLike => ({
  line,
  isDisposed,
});

describe("computeRange", () => {
  it("derives the range from current marker positions", () => {
    expect(computeRange(marker(10), marker(14))).toEqual({
      start: 10,
      end: 14,
    });
  });

  it("tracks markers after the buffer scrolls (eviction shifts lines down)", () => {
    const start = marker(10);
    const end = marker(14);
    start.line = 2;
    end.line = 6;
    expect(computeRange(start, end)).toEqual({ start: 2, end: 6 });
  });

  it("returns null once a marker is disposed", () => {
    expect(computeRange(marker(10, true), marker(14))).toBeNull();
    expect(computeRange(marker(10), marker(14, true))).toBeNull();
  });

  it("returns null for an invalid (-1) marker line", () => {
    expect(computeRange(marker(-1), marker(4))).toBeNull();
  });

  it("never returns an inverted range", () => {
    expect(computeRange(marker(8), marker(5))).toEqual({ start: 8, end: 8 });
  });
});

describe("blockIndexAt", () => {
  const ranges = [{ start: 0, end: 4 }, null, { start: 5, end: 9 }];

  it("finds the block containing a line", () => {
    expect(blockIndexAt(ranges, 2)).toBe(0);
    expect(blockIndexAt(ranges, 7)).toBe(2);
  });

  it("skips disposed (null) ranges", () => {
    expect(blockIndexAt([null, null], 3)).toBe(-1);
  });

  it("returns -1 when no block contains the line", () => {
    expect(blockIndexAt(ranges, 20)).toBe(-1);
  });

  it("resolves to the newest block on overlap", () => {
    expect(
      blockIndexAt(
        [
          { start: 0, end: 10 },
          { start: 5, end: 10 },
        ],
        7,
      ),
    ).toBe(1);
  });
});
