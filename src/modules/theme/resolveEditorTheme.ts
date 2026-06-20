import {
  EDITOR_THEME_AUTO,
  isEditorThemeId,
  type EditorThemeId,
  type EditorThemePref,
} from "@/modules/settings/store";
import { getBuiltinTheme, getDefaultTheme } from "./themes";
import type { Theme } from "./types";

const FALLBACK: Record<"light" | "dark", EditorThemeId> = {
  light: "github-light",
  dark: "atomone",
};

/**
 * Resolve the concrete CodeMirror theme to apply. In "auto" the editor follows
 * the active app theme's editorTheme pairing for the current mode (live, so it
 * never goes stale); an explicit pref always wins.
 */
export function resolveEditorThemeId(
  pref: EditorThemePref,
  themeId: string,
  customThemes: Theme[],
  mode: "light" | "dark",
): EditorThemeId {
  if (pref !== EDITOR_THEME_AUTO) return pref;
  const theme =
    customThemes.find((t) => t.id === themeId) ??
    getBuiltinTheme(themeId) ??
    getDefaultTheme();
  const mapped =
    theme.editorTheme?.[mode] ??
    theme.editorTheme?.dark ??
    theme.editorTheme?.light;
  return isEditorThemeId(mapped) ? mapped : FALLBACK[mode];
}
