import type { Theme, ThemeMode } from "./types";

export type TerminalFont = {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

export function resolveTerminalFont(
  preferences: TerminalFont,
  theme: Theme,
  mode: ThemeMode,
): TerminalFont {
  const variant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light;
  const terminal = variant?.terminal;
  return {
    fontFamily: terminal?.fontFamily ?? preferences.fontFamily,
    fontWeight: terminal?.fontWeight ?? preferences.fontWeight,
    fontSize: terminal?.fontSize ?? preferences.fontSize,
  };
}
