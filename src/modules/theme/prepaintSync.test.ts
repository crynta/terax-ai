import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

describe("pre-paint background colors", () => {
  it("keeps index.html in sync with the documented opaque colors", () => {
    const html = readFileSync(`${repoRoot}index.html`, "utf8");
    expect(html).toContain('#141414');
    expect(html).toContain('#ffffff');
  });

  it("uses exactly the two colors the vibrancy bridge repaints with", () => {
    const html = readFileSync(`${repoRoot}index.html`, "utf8");
    const hexLiterals = [...html.matchAll(/#(?:[0-9a-fA-F]{6})\b/g)].map(
      (m) => m[0].toLowerCase(),
    );
    expect(new Set(hexLiterals)).toEqual(
      new Set(["#141414", "#ffffff"]),
    );
  });
});
