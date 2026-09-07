import { describe, expect, it } from "vitest";
import { clampTerminalPaneLimit } from "./store";

describe("clampTerminalPaneLimit", () => {
  it("keeps supported pane limits", () => {
    expect(clampTerminalPaneLimit(1)).toBe(1);
    expect(clampTerminalPaneLimit(4)).toBe(4);
    expect(clampTerminalPaneLimit(8)).toBe(8);
  });

  it("clamps persisted values to the supported range", () => {
    expect(clampTerminalPaneLimit(0)).toBe(1);
    expect(clampTerminalPaneLimit(9)).toBe(8);
  });

  it("normalizes fractional and non-finite values", () => {
    expect(clampTerminalPaneLimit(4.6)).toBe(5);
    expect(clampTerminalPaneLimit(Number.NaN)).toBe(8);
  });
});
