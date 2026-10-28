import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Locks the animation-cost invariants documented in TERAX.md: nothing in the
// global stylesheet animates forever at display rate, and an inactive window
// pauses every CSS animation.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** Every declaration value that makes an animation repeat forever. */
function infiniteAnimations(source: string): string[] {
  return [
    ...source.matchAll(
      /(--animate-[\w-]+|animation)\s*:\s*([^;]*infinite[^;]*);/g,
    ),
  ].map((m) => `${m[1]}: ${m[2].trim()}`);
}

describe("global motion budget", () => {
  it("only repeats animations forever with stepped timing", () => {
    const infinite = infiniteAnimations(css);
    expect(infinite.length).toBeGreaterThan(0);
    for (const declaration of infinite) {
      expect(declaration, "infinite animation must use steps()").toMatch(
        /steps\(/,
      );
    }
  });

  it("covers the spinner and pulse utilities and the shimmer", () => {
    const names = infiniteAnimations(css).join("\n");
    expect(names).toContain("--animate-spin");
    expect(names).toContain("--animate-pulse");
    expect(names).toContain("terax-shimmer");
    expect(names).toContain("terax-blink");
  });

  it("pauses all animations while the window is inactive", () => {
    expect(css).toMatch(
      /html\[data-window-inactive\] \*[^{]*\{[^}]*animation-play-state:\s*paused\s*!important/,
    );
    expect(css).toMatch(/html\[data-window-inactive\] \*::before/);
    expect(css).toMatch(/html\[data-window-inactive\] \*::after/);
  });

  it("keeps a pending approval's pulse finite", () => {
    const rule = css.match(/\.terax-attention-pulse\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/animation:/);
    expect(rule).not.toMatch(/infinite/);
  });

  it("removes the repeating indicators under prefers-reduced-motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"));
    expect(reduced).toMatch(/\.terax-shimmer\s*\{[^}]*animation:\s*none/);
    expect(reduced).toMatch(/\.terax-blink[^{]*\{[^}]*animation:\s*none/);
  });
});
