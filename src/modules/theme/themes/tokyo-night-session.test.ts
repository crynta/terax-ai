import { describe, expect, it } from "vitest";
import { getBuiltinTheme } from "./index";
import { tokyoNightSession } from "./tokyo-night-session";

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 0xff, value & 0xff].map(
    (channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    },
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("Tokyo Night Session theme", () => {
  const dark = tokyoNightSession.variants.dark;
  const terminal = dark?.terminal;

  it("is registered", () => {
    expect(getBuiltinTheme("tokyo-night-session")).toBe(tokyoNightSession);
  });

  it("keeps terminal text and dim agent text readable on the background", () => {
    const background = terminal?.background ?? "";
    expect(contrast(terminal?.foreground ?? "", background)).toBeGreaterThan(
      4.5,
    );
    expect(contrast(terminal?.ansi?.[8] ?? "", background)).toBeGreaterThan(
      3.5,
    );
    expect(
      contrast(dark?.colors?.mutedForeground ?? "", background),
    ).toBeGreaterThan(4.5);
  });

  it("leaves the terminal font to the user's preference", () => {
    expect(terminal?.fontFamily).toBeUndefined();
  });
});
