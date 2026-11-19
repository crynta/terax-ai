import { expect, it } from "vitest";
import { nativeDropClientPoint } from "./nativeDropPoint";

it("converts Windows drag coordinates even when the physical point fits inside the CSS viewport", () => {
  expect(nativeDropClientPoint({ x: 300, y: 150 }, true, 1.5)).toEqual({
    x: 200,
    y: 100,
  });
});

it("leaves logical Cocoa and GTK drag coordinates unchanged on scaled displays", () => {
  const position = { x: 300, y: 150 };
  expect(nativeDropClientPoint(position, false, 2)).toBe(position);
});

it.each([0, 1, Number.NaN])(
  "preserves coordinates when the scale is %s",
  (ratio) => {
    const position = { x: 300, y: 150 };
    expect(nativeDropClientPoint(position, true, ratio)).toBe(position);
  },
);
