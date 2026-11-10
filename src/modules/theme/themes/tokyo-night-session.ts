import type { Theme } from "../types";

/**
 * Tokyo Night tuned for long coding-agent sessions: one background from chrome
 * to terminal, deeper cards for the sidebar, and a brighter "bright black" so
 * the dim grey text agents print stays readable. Truecolor diff backgrounds in
 * Claude Code ignore this palette; pick `/theme dark-ansi` there to use it.
 */
export const tokyoNightSession: Theme = {
  id: "tokyo-night-session",
  name: "Tokyo Night Session",
  description:
    "Tokyo Night tuned for agent sessions: readable greys and calm blue accents.",
  editorTheme: { dark: "tokyo-night" },
  variants: {
    dark: {
      colors: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        card: "#16161e",
        cardForeground: "#c0caf5",
        popover: "#16161e",
        popoverForeground: "#c0caf5",
        primary: "#7aa2f7",
        primaryForeground: "#16161e",
        secondary: "#24283b",
        secondaryForeground: "#c0caf5",
        muted: "#24283b",
        mutedForeground: "#a9b1d6",
        accent: "#292e42",
        accentForeground: "#c0caf5",
        destructive: "#f7768e",
        border: "rgba(169,177,214,0.10)",
        input: "rgba(169,177,214,0.14)",
        ring: "#7aa2f7",
        sidebar: "#16161e",
        sidebarForeground: "#c0caf5",
        sidebarPrimary: "#7aa2f7",
        sidebarPrimaryForeground: "#16161e",
        sidebarAccent: "#24283b",
        sidebarAccentForeground: "#c0caf5",
        sidebarBorder: "rgba(169,177,214,0.10)",
        sidebarRing: "#7aa2f7",
      },
      terminal: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        cursor: "#7aa2f7",
        cursorAccent: "#1a1b26",
        selection: "rgba(122,162,247,0.28)",
        ansi: [
          "#32344a",
          "#f7768e",
          "#9ece6a",
          "#e0af68",
          "#7aa2f7",
          "#bb9af7",
          "#7dcfff",
          "#a9b1d6",
          "#737aa2",
          "#ff899d",
          "#b3e47f",
          "#f2c27c",
          "#8db0ff",
          "#c7a9ff",
          "#a4daff",
          "#c0caf5",
        ],
      },
    },
  },
};
