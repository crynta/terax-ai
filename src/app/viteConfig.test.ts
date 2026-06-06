import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vite manual chunks", () => {
  it("keeps xyflow out of the eager react vendor chunk", () => {
    const source = readFileSync("vite.config.ts", "utf8");
    const xyflowIndex = source.indexOf('id.includes("@xyflow/")');
    const reactIndex = source.indexOf('id.includes("/react/")');

    expect(xyflowIndex).toBeGreaterThanOrEqual(0);
    expect(reactIndex).toBeGreaterThanOrEqual(0);
    expect(xyflowIndex).toBeLessThan(reactIndex);
  });
});
