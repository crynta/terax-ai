import type { Tab } from "@/modules/tabs";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import type { WorkspaceEnv } from "@/modules/workspace";
import { freshTerminalTab } from "./serialize";
import type { SpaceMeta } from "./store";

export function findActiveSpace(
  spaces: SpaceMeta[],
  activeId: string | null,
): SpaceMeta | null {
  if (activeId) {
    const found = spaces.find((s) => s.id === activeId);
    if (found) return found;
  }
  return spaces[0] ?? null;
}

export function activeSpaceEnv(
  spaces: SpaceMeta[],
  activeId: string | null,
): WorkspaceEnv {
  return findActiveSpace(spaces, activeId)?.env ?? { kind: "local" };
}

// A WSL space falls back to null, not the local cwd, so its first tab opens at
// the WSL home instead of a Windows path.
export function freshTabCwd(
  env: WorkspaceEnv,
  restoredHome: string | null,
  launchCwd: string | null,
  home: string | null,
): string | null {
  return restoredHome ?? (env.kind === "local" ? (launchCwd ?? home) : null);
}

function comparableCwd(path: string): string {
  // A backslash in a POSIX segment is a literal filename character.
  const normalized = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(path)
    ? path.replace(/\\/g, "/")
    : path;
  if (/^[a-z]:\/+$/i.test(normalized)) return normalized.slice(0, 3);
  return normalized.replace(/([^/])\/+$/, "$1");
}

export function selectLaunchTab(
  tabs: Tab[],
  spaceId: string,
  env: WorkspaceEnv,
  cwd: string | undefined,
  allocId: () => number,
) {
  if (!cwd || env.kind !== "local") return undefined;
  const requested = comparableCwd(cwd);
  return (
    tabs.find((tab) => {
      if (tab.kind !== "terminal" || tab.spaceId !== spaceId) return false;
      const leafCwd = findLeafCwd(tab.paneTree, tab.activeLeafId);
      return leafCwd !== undefined && comparableCwd(leafCwd) === requested;
    }) ?? freshTerminalTab(spaceId, cwd, allocId)
  );
}
