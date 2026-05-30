import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const viteConfig = readFileSync(path.join(here, "..", "vite.config.ts"), "utf8");

describe("Vite dev watch exclusions", () => {
  it("does not reload the app when notebooks are saved from Terax", () => {
    expect(viteConfig).toContain('"**/*.ipynb"');
  });
});
