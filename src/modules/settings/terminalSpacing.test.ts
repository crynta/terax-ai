import { describe, expect, it } from "vitest";
import {
  clampTerminalLineHeight,
  clampTerminalPanePadding,
  DEFAULT_PREFERENCES,
  TERMINAL_LINE_HEIGHT_DEFAULT,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_MIN,
  TERMINAL_PANE_PADDING_MAX,
} from "./store";

describe("clampTerminalPanePadding", () => {
  it("rounds and clamps to 0–24 px", () => {
    expect(clampTerminalPanePadding(9.6)).toBe(10);
    expect(clampTerminalPanePadding(-3)).toBe(0);
    expect(clampTerminalPanePadding(80)).toBe(TERMINAL_PANE_PADDING_MAX);
  });

  it("falls back to no padding for nonsense", () => {
    expect(clampTerminalPanePadding(Number.NaN)).toBe(0);
    expect(DEFAULT_PREFERENCES.terminalPanePadding).toBe(0);
  });
});

describe("clampTerminalLineHeight", () => {
  it("steps to 0.05 and clamps to 1.0–1.6", () => {
    expect(clampTerminalLineHeight(1.33)).toBe(1.35);
    expect(clampTerminalLineHeight(0.4)).toBe(TERMINAL_LINE_HEIGHT_MIN);
    expect(clampTerminalLineHeight(3)).toBe(TERMINAL_LINE_HEIGHT_MAX);
  });

  it("keeps the historical 1.2 as the default", () => {
    expect(clampTerminalLineHeight(Number.POSITIVE_INFINITY)).toBe(
      TERMINAL_LINE_HEIGHT_DEFAULT,
    );
    expect(DEFAULT_PREFERENCES.terminalLineHeight).toBe(1.2);
  });
});
