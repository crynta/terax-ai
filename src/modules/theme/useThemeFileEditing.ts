import { setThemeId as persistThemeId } from "@/modules/settings/store";
import type { Tab } from "@/modules/tabs";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type RefObject, useEffect } from "react";
import { listCustomThemes, saveCustomTheme } from "./customThemes";
import {
  isThemeFilePath,
  onThemeEdit,
  parseThemeFile,
  starterTheme,
  themeFilePath,
  writeThemeFile,
} from "./themeFiles";

type Params = {
  tabsRef: RefObject<Tab[]>;
  openFileTab: (path: string) => void;
};

/**
 * A custom theme is materialized to a real file and edited in the code editor.
 * Saving it re-ingests into the runtime store + applies live; the edit request
 * channel opens (or creates) the theme file for editing.
 */
export function useThemeFileEditing({ tabsRef, openFileTab }: Params) {
  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source !== "editor") return;
          if (!isThemeFilePath(event.payload.path)) return;
          void (async () => {
            try {
              const res = await invoke<{ kind: string; content?: string }>(
                "fs_read_file",
                { path: event.payload.path, workspace: currentWorkspaceEnv() },
              );
              if (res.kind !== "text" || typeof res.content !== "string")
                return;
              const parsed = parseThemeFile(res.content);
              if (!parsed.ok) {
                console.warn("[terax] theme not applied:", parsed.error);
                return;
              }
              await saveCustomTheme(parsed.theme);
            } catch (e) {
              console.warn("[terax] theme ingest failed:", e);
            }
          })();
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    void onThemeEdit(async (req) => {
      const theme =
        req.action === "create"
          ? starterTheme()
          : (await listCustomThemes()).find((t) => t.id === req.id);
      if (!theme) return;
      if (req.action === "create") await saveCustomTheme(theme);
      const path = await themeFilePath(theme.id);
      const open = tabsRef.current.some(
        (t) => t.kind === "editor" && t.path === path,
      );
      if (!open) await writeThemeFile(theme);
      void persistThemeId(theme.id);
      openFileTab(path);
      void getCurrentWebviewWindow().setFocus();
    }).then((fn) => {
      if (alive) unsub = fn;
      else fn();
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [openFileTab, tabsRef]);
}
