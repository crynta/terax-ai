import assert from "node:assert/strict";
import { test } from "node:test";
import { isDropPointInsideRect } from "./drop-hitbox.ts";

const rect = { left: 0, top: 0, right: 1_000, bottom: 600 };
const viewport = { width: 1_200, height: 800 };

test("keeps logical drop coordinates at the terminal right edge", () => {
  assert.equal(
    isDropPointInsideRect({ x: 950, y: 300 }, rect, viewport, 2),
    true,
  );
});

test("converts high-DPI physical coordinates that exceed the logical viewport", () => {
  assert.equal(
    isDropPointInsideRect({ x: 1_900, y: 600 }, rect, viewport, 2),
    true,
  );
});

test("does not treat logical points outside the terminal as inside after scaling", () => {
  assert.equal(
    isDropPointInsideRect({ x: 1_100, y: 300 }, rect, viewport, 2),
    false,
  );
});
