import { DEFAULT_THEME_ID, type Theme } from "../types";
import { caffeine } from "./caffeine";
import { catppuccin } from "./catppuccin";
import { claude } from "./claude";
import { gruvbox } from "./gruvbox";
import { nord } from "./nord";
import { rosePine } from "./rose-pine";
import { sage } from "./sage";
import { teraxDefault } from "./terax-default";
import { tide } from "./tide";
import { tokyoNight } from "./tokyo-night";

const BUILTIN: Theme[] = [
  teraxDefault,
  claude,
  tokyoNight,
  nord,
  tide,
  sage,
  catppuccin,
  gruvbox,
  rosePine,
  caffeine,
];

const BY_ID = new Map<string, Theme>(BUILTIN.map((t) => [t.id, t]));

export function listBuiltinThemes(): Theme[] {
  return BUILTIN;
}

export function getBuiltinTheme(id: string): Theme | undefined {
  return BY_ID.get(id);
}

export function getDefaultTheme(): Theme {
  return BY_ID.get(DEFAULT_THEME_ID) ?? BUILTIN[0];
}
