import { atomone } from "@uiw/codemirror-theme-atomone";
import { aura } from "@uiw/codemirror-theme-aura";
import { copilot } from "@uiw/codemirror-theme-copilot";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { gruvboxDark } from "@uiw/codemirror-theme-gruvbox-dark";
import { nord } from "@uiw/codemirror-theme-nord";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { xcodeDark, xcodeLight } from "@uiw/codemirror-theme-xcode";
import type { Extension } from "@codemirror/state";
import type { EditorThemeId } from "@/modules/settings/store";
import {
  catppuccinLatte,
  catppuccinMocha,
  dracula,
  everforestDark,
  everforestLight,
  kanagawa,
  kanagawaDragon,
  kanagawaLotus,
  rosePine,
  rosePineDawn,
  solarizedDark,
  solarizedLight,
} from "./cmThemes";

export const EDITOR_THEME_EXT: Record<EditorThemeId, Extension> = {
  kanagawa,
  "kanagawa-lotus": kanagawaLotus,
  "kanagawa-dragon": kanagawaDragon,
  "tokyo-night": tokyoNight,
  "catppuccin-mocha": catppuccinMocha,
  "catppuccin-latte": catppuccinLatte,
  "rose-pine": rosePine,
  "rose-pine-dawn": rosePineDawn,
  everforest: everforestDark,
  "everforest-light": everforestLight,
  dracula,
  "solarized-dark": solarizedDark,
  "solarized-light": solarizedLight,
  nord,
  "gruvbox-dark": gruvboxDark,
  atomone,
  aura,
  copilot,
  "github-dark": githubDark,
  "github-light": githubLight,
  "xcode-dark": xcodeDark,
  "xcode-light": xcodeLight,
};
