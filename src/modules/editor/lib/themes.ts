import { atomone } from "@uiw/codemirror-theme-atomone";
import { aura } from "@uiw/codemirror-theme-aura";
import { copilot } from "@uiw/codemirror-theme-copilot";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { nord } from "@uiw/codemirror-theme-nord";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { xcodeDark, xcodeLight } from "@uiw/codemirror-theme-xcode";
import type { Extension } from "@codemirror/state";
import type { EditorThemeId } from "@/modules/settings/store";

export const EDITOR_THEME_EXT: Record<EditorThemeId, Extension> = {
  atomone,
  aura,
  copilot,
  "github-dark": githubDark,
  "github-light": githubLight,
  nord,
  "tokyo-night": tokyoNight,
  "xcode-dark": xcodeDark,
  "xcode-light": xcodeLight,
};
