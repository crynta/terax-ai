import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PREPAINT_BG } from "./vibrancy";

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

  it("paints exactly the colors the vibrancy bridge repaints with", () => {
    const hexLiterals = [...html.matchAll(/#(?:[0-9a-fA-F]{6})\b/g)].map(
      (m) => m[0].toLowerCase(),
    );
    expect(new Set(hexLiterals)).toEqual(
      new Set(Object.values(PREPAINT_BG)),
    );
  });

  it("assigns dark to dark and light to light, matching the bridge keys", () => {
    const ternary = html.match(
      /resolved\s*===\s*"dark"\s*\?\s*"(#[0-9a-fA-F]{6})"\s*:\s*"(#[0-9a-fA-F]{6})"/,
    );
    expect(ternary).not.toBeNull();
    expect(ternary?.[1]).toBe(PREPAINT_BG.dark);
    expect(ternary?.[2]).toBe(PREPAINT_BG.light);
  });
});
