import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("borderless chrome", () => {
  it.each(["dialog-overlay", "alert-dialog-overlay", "sheet-overlay"])(
    "rounds the %s to the window silhouette, as it portals past #root's clip",
    (slot) => {
      // Full-screen overlays mount to `body`, outside `#root`'s rounded
      // `overflow: hidden` box; without their own radius they paint a dark
      // square over the window's transparent corners (issue #1495).
      const rule = new RegExp(
        `html\\[data-chrome="borderless"\\] \\[data-slot="${slot}"\\][\\s\\S]*?\\{[^}]*?border-radius:\\s*12px;`,
      );
      expect(css).toMatch(rule);
    },
  );
});
