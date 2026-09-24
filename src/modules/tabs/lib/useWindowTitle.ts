import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "./useTabs";
import { labelFor } from "./tabLabel";

const APP_NAME = "Terax";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/**
 * Drives the OS window title from the focused tab + project folder, the way
 * Spotify shows the current track instead of just the app name. Without this
 * the window keeps the build-time default ("Tauri App" on Linux).
 *
 * Format: `<project> — <tab>` (e.g. `terax-ai — src`), collapsing to just the
 * project when the focused terminal sits at the project root. Falls back to the
 * app name when there's nothing to show.
 */
export function useWindowTitle(
  activeTab: Tab | undefined,
  explorerRoot: string | null,
): void {
  const project = explorerRoot ? basename(explorerRoot) : "";
  const terminalShell = usePreferencesStore((s) => s.terminalShell);
  const label = activeTab ? labelFor(activeTab, terminalShell) : "";

  useEffect(() => {
    let title: string;
    if (project && label && label !== project) title = `${project} — ${label}`;
    else title = project || label || APP_NAME;

    document.title = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  }, [project, label]);
}
