import { describe, expect, it } from "vitest";
import { sameTerminalColors } from "./terminalThemeColors";

const theme = (background: [number, number, number]) => ({
  foreground: [1, 2, 3] as [number, number, number],
  background,
  cursor: [4, 5, 6] as [number, number, number],
  palette: Array.from({ length: 16 }, (_, i) => [i, i, i] as [number, number, number]),
});

describe("sameTerminalColors", () => {
  it("tells an unchanged theme from a flipped one", () => {
    expect(sameTerminalColors(theme([0, 0, 0]), theme([0, 0, 0]))).toBe(true);
    expect(sameTerminalColors(theme([0, 0, 0]), theme([255, 255, 255]))).toBe(
      false,
    );
  });

  it("notices a changed palette entry or cursor", () => {
    const changed = theme([0, 0, 0]);
    changed.palette[9] = [9, 9, 10];
    expect(sameTerminalColors(theme([0, 0, 0]), changed)).toBe(false);
    const cursor = theme([0, 0, 0]);
    cursor.cursor = [4, 5, 7];
    expect(sameTerminalColors(theme([0, 0, 0]), cursor)).toBe(false);
  });
});
