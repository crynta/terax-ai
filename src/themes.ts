import type { ITheme } from "@xterm/xterm";

/**
 * xterm.js themes are 18 colors:
 *   background, foreground, cursor, cursorAccent, selectionBackground
 *   + ANSI 16: black/red/green/yellow/blue/magenta/cyan/white  (× normal + bright)
 *
 * Programs decide which ANSI slot to use; the theme decides what those slots look like.
 * E.g. `ls` colors directories with "blue" — what blue *means* is up to your theme.
 */

/**
 * Nord — official palette per https://www.nordtheme.com/docs/colors-and-palettes
 *
 * Polar Night (backgrounds, dark UI):
 *   nord0 #2E3440  nord1 #3B4252  nord2 #434C5E  nord3 #4C566A
 * Snow Storm (foregrounds, light UI):
 *   nord4 #D8DEE9  nord5 #E5E9F0  nord6 #ECEFF4
 * Frost (cool accents — primary brand colors):
 *   nord7 #8FBCBB  nord8 #88C0D0  nord9 #81A1C1  nord10 #5E81AC
 * Aurora (warm accents — semantic):
 *   nord11 #BF616A red    nord12 #D08770 orange  nord13 #EBCB8B yellow
 *   nord14 #A3BE8C green  nord15 #B48EAD purple
 *
 * Background uses nord0 darkened ~6% for a cleaner, less-blue macOS feel
 * while keeping every accent canonical.
 */
export const nord: ITheme = {
  background: "#272c36",
  foreground: "#d8dee9",
  cursor: "#88c0d0",
  cursorAccent: "#2e3440",
  selectionBackground: "#434c5e",

  black: "#3b4252",
  red: "#bf616a",
  green: "#a3be8c",
  yellow: "#ebcb8b",
  blue: "#81a1c1",
  magenta: "#b48ead",
  cyan: "#88c0d0",
  white: "#e5e9f0",

  brightBlack: "#4c566a",
  brightRed: "#bf616a",
  brightGreen: "#a3be8c",
  brightYellow: "#ebcb8b",
  brightBlue: "#81a1c1",
  brightMagenta: "#b48ead",
  brightCyan: "#8fbcbb",
  brightWhite: "#eceff4",
};

export const tokyoNight: ITheme = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  cursorAccent: "#1a1b26",
  selectionBackground: "#33467c",

  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",

  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

export const catppuccinMocha: ITheme = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e2e",
  selectionBackground: "#585b70",

  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",

  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

/**
 * Shadcn Dark — matches the design tokens in App.css (dark mode).
 * Background tracks shadcn's `--background` (oklch 0.148 / hue 228 → near-black with
 * a faint cool cast). ANSI slots use Tailwind's 400/500 scales so colored output
 * sits naturally next to shadcn UI components.
 */
export const shadcnDark: ITheme = {
  background: "#0a0d12",
  foreground: "#fafafa",
  cursor: "#fafafa",
  cursorAccent: "#0a0d12",
  selectionBackground: "#27272a",

  black: "#18181b",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#e4e4e7",

  brightBlack: "#52525b",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#fafafa",
};

export const themes = {
  shadcnDark,
  nord,
  tokyoNight,
  catppuccinMocha,
} as const;

export type ThemeName = keyof typeof themes;
