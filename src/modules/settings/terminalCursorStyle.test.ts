import { describe, expect, it } from "vitest";
import { coerceTerminalCursorStyle } from "./store";

describe("coerceTerminalCursorStyle", () => {
  it("keeps xterm cursor styles", () => {
    for (const style of ["bar", "block", "underline"]) {
      expect(coerceTerminalCursorStyle(style)).toBe(style);
    }
  });

  it("falls back to bar for invalid persisted values", () => {
    expect(coerceTerminalCursorStyle("outline")).toBe("bar");
    expect(coerceTerminalCursorStyle(1)).toBe("bar");
    expect(coerceTerminalCursorStyle(null)).toBe("bar");
  });
});
