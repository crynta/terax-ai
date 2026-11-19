import { describe, expect, it } from "vitest";
import { coerceTerminalRenderer } from "./store";

describe("coerceTerminalRenderer", () => {
  it("keeps the three choices", () => {
    expect(coerceTerminalRenderer("auto")).toBe("auto");
    expect(coerceTerminalRenderer("webgpu")).toBe("webgpu");
    expect(coerceTerminalRenderer("webgl")).toBe("webgl");
  });

  it("reads anything else, including a missing value, as Automatic", () => {
    for (const value of [undefined, null, "", "WebGL", "canvas", 3, {}]) {
      expect(coerceTerminalRenderer(value)).toBe("auto");
    }
  });
});
