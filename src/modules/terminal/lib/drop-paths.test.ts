import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDroppedPathInput } from "./drop-paths.ts";

test("formats dropped Unix paths as shell-safe terminal input", () => {
  assert.equal(
    buildDroppedPathInput(
      ["/Users/roman/Desktop/my screenshot.png", "/tmp/quote's.png"],
      "unix",
    ),
    "'/Users/roman/Desktop/my screenshot.png' '/tmp/quote'\\''s.png' ",
  );
});

test("formats dropped Windows paths as shell-safe terminal input", () => {
  assert.equal(
    buildDroppedPathInput(
      ["C:\\Users\\Roman\\Desktop\\my screenshot.png", 'C:\\tmp\\a"b.png'],
      "windows",
    ),
    '"C:\\Users\\Roman\\Desktop\\my screenshot.png" "C:\\tmp\\a`"b.png" ',
  );
});

test("returns null when no paths are dropped", () => {
  assert.equal(buildDroppedPathInput([], "unix"), null);
});
