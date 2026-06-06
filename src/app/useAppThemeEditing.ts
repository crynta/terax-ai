import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type MutableRefObject, useEffect } from "react";
import { setThemeId as persistThemeId } from "@/modules/settings/store";
import type { Tab } from "@/modules/tabs";
import {
  listCustomThemes,
  saveCustomTheme,
} from "@/modules/theme/customThemes";
import {
  isThemeFilePath,
  onThemeEdit,
  parseThemeFile,
  starterTheme,
  themeFilePath,
  writeThemeFile,
} from "@/modules/theme/themeFiles";
import { currentWorkspaceEnv } from "@/modules/workspace";

type UseAppThemeEditingInput = {
  openFileTab: (path: string, pin?: boolean) => number | null;
  tabsRef: MutableRefObject<Tab[]>;
};

export function useAppThemeEditing({
  openFileTab,
  tabsRef,
}: UseAppThemeEditingInput) {
  // Theme editing: a custom theme is materialized to a real file and edited in
  // the code editor. Saving it re-ingests into the runtime store + applies live.
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
              if (res.kind !== "text" || typeof res.content !== "string") {
                return;
              }
              const parsed = parseThemeFile(res.content);
              if (!parsed.ok) {
                console.warn("[terax] theme not applied:", parsed.error);
                return;
              }
              await saveCustomTheme(parsed.theme);
            } catch (error) {
              console.warn("[terax] theme ingest failed:", error);
            }
          })();
        },
      );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    void onThemeEdit(async (request) => {
      const theme =
        request.action === "create"
          ? starterTheme()
          : (await listCustomThemes()).find(
              (candidate) => candidate.id === request.id,
            );
      if (!theme) return;
      if (request.action === "create") await saveCustomTheme(theme);
      const path = await themeFilePath(theme.id);
      const open = tabsRef.current.some(
        (tab) => tab.kind === "editor" && tab.path === path,
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
