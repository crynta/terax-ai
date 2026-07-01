import { describe, expect, it } from "vitest";
import {
  clampComposerHeight,
  DEFAULT_COMPOSER_HEIGHT,
  MAX_COMPOSER_HEIGHT,
  MIN_COMPOSER_HEIGHT,
} from "./composerLayout";

describe("terminal composer layout", () => {
  it("uses a bounded default height", () => {
    expect(DEFAULT_COMPOSER_HEIGHT).toBeGreaterThan(MIN_COMPOSER_HEIGHT);
    expect(DEFAULT_COMPOSER_HEIGHT).toBeLessThan(MAX_COMPOSER_HEIGHT);
  });

  it("clamps resized heights", () => {
    expect(clampComposerHeight(MIN_COMPOSER_HEIGHT - 80)).toBe(
      MIN_COMPOSER_HEIGHT,
    );
    expect(clampComposerHeight(MAX_COMPOSER_HEIGHT + 80)).toBe(
      MAX_COMPOSER_HEIGHT,
    );
    expect(clampComposerHeight(180)).toBe(180);
  });
});
