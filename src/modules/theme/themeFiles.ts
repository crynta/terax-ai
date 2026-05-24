import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { appConfigDir, join } from "@tauri-apps/api/path";
import type { Theme } from "./types";
import { validateTheme, type ValidationResult } from "./validateTheme";

const THEME_FILE_EXT = ".termax-theme";
const THEME_EDIT_EVENT = "termax://theme-edit";

export type ThemeEditRequest =
  | { action: "create" }
  | { action: "edit"; id: string };

export function isThemeFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(THEME_FILE_EXT);
}

async function themesDir(): Promise<string> {
  return join(await appConfigDir(), "themes");
}

export async function themeFilePath(id: string): Promise<string> {
  return join(await themesDir(), `${id}${THEME_FILE_EXT}`);
}

export async function writeThemeFile(theme: Theme): Promise<string> {
  const dir = await themesDir();
  const ws = currentWorkspaceEnv();
  const dirExists = await invoke("fs_stat", { path: dir, workspace: ws })
    .then(() => true)
    .catch(() => false);
  if (!dirExists) {
    await invoke("fs_create_dir", { path: dir, workspace: ws });
  }
  const path = await join(dir, `${theme.id}${THEME_FILE_EXT}`);
  await invoke("fs_write_file", {
    path,
    content: JSON.stringify(theme, null, 2),
    workspace: ws,
    source: "theme",
  });
  return path;
}

export async function deleteThemeFile(id: string): Promise<void> {
  try {
    const path = await themeFilePath(id);
    await invoke("fs_delete", { path, workspace: currentWorkspaceEnv() });
  } catch {
    /* file may not exist yet — nothing to clean up */
  }
}

export function parseThemeFile(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "invalid JSON",
    };
  }
  return validateTheme(parsed);
}

export function starterTheme(): Theme {
  const id = `my-theme-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: "My Theme",
    description: "Custom theme.",
    variants: {
      dark: {
        colors: {
          background: "#0d0d10",
          foreground: "#e8e8ea",
          card: "#15151a",
          cardForeground: "#e8e8ea",
          popover: "#15151a",
          popoverForeground: "#e8e8ea",
          primary: "#7dd3fc",
          primaryForeground: "#0d0d10",
          muted: "#1c1c22",
          mutedForeground: "#a0a0a8",
          accent: "#1c1c22",
          accentForeground: "#e8e8ea",
          border: "rgba(255,255,255,0.08)",
          input: "rgba(255,255,255,0.12)",
          ring: "#7dd3fc",
          sidebar: "#0a0a0d",
          sidebarForeground: "#e8e8ea",
          sidebarPrimary: "#7dd3fc",
          sidebarAccent: "#1c1c22",
          sidebarBorder: "rgba(255,255,255,0.08)",
          sidebarRing: "#7dd3fc",
        },
        terminal: {
          background: "#0d0d10",
          foreground: "#e8e8ea",
          cursor: "#e8e8ea",
          cursorAccent: "#0d0d10",
          selection: "rgba(125,211,252,0.22)",
        },
      },
    },
  };
}

export function emitThemeEdit(req: ThemeEditRequest): Promise<void> {
  return emit(THEME_EDIT_EVENT, req);
}

export function onThemeEdit(
  cb: (req: ThemeEditRequest) => void,
): Promise<UnlistenFn> {
  return listen<ThemeEditRequest>(THEME_EDIT_EVENT, (e) => cb(e.payload));
}
