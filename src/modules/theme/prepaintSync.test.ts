import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function findIndexHtml(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "index.html");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("index.html not found above the test file");
}

describe("pre-paint background colors", () => {
  const html = readFileSync(findIndexHtml(), "utf8");

  it("keeps index.html in sync with the documented opaque colors", () => {
    expect(html).toContain("#141414");
    expect(html).toContain("#ffffff");
  });

  it("uses exactly the two colors the vibrancy bridge repaints with", () => {
    const hexLiterals = [...html.matchAll(/#(?:[0-9a-fA-F]{6})\b/g)].map(
      (m) => m[0].toLowerCase(),
    );
    expect(new Set(hexLiterals)).toEqual(new Set(["#141414", "#ffffff"]));
  });
});
