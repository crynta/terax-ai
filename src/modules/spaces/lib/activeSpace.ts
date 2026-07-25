import type { WorkspaceEnv } from "@/modules/workspace";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { freshTerminalTab } from "./serialize";
import { newSpaceId as makeDefaultSpaceId, type SpaceMeta } from "./store";

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

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function localPathKey(path: string | null): string | null {
  if (!path) return null;
  let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  normalized = normalized.replace(
    /^([a-z]):/,
    (_, drive: string) => `${drive.toUpperCase()}:`,
  );
  return normalized || path;
}

type ExplicitLaunchDirInput = {
  spaces: SpaceMeta[];
  tabs: Tab[];
  launchDir: string;
  allocId: () => number;
  now?: () => number;
  newSpaceId?: () => string;
};

export function applyExplicitLaunchDir({
  spaces,
  tabs,
  launchDir,
  allocId,
  now = Date.now,
  newSpaceId: makeSpaceId = makeDefaultSpaceId,
}: ExplicitLaunchDirInput): {
  spaces: SpaceMeta[];
  activeSpaceId: string;
  tabs: Tab[];
  activeTabId: number;
} {
  const launchKey = localPathKey(launchDir);
  const existing = spaces.find(
    (s) => s.env.kind === "local" && localPathKey(s.root) === launchKey,
  );
  const nextSpaces = [...spaces];
  let target = existing;

  if (!target) {
    const timestamp = now();
    target = {
      id: makeSpaceId(),
      name: basename(launchDir),
      root: launchDir,
      env: { kind: "local" },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    nextSpaces.push(target);
  }

  const existingTab = tabs.find(
    (t) =>
      t.kind === "terminal" &&
      t.spaceId === target.id &&
      localPathKey(t.cwd ?? null) === launchKey,
  );
  if (existingTab) {
    return {
      spaces: nextSpaces,
      activeSpaceId: target.id,
      tabs,
      activeTabId: existingTab.id,
    };
  }

  const tab = freshTerminalTab(target.id, launchDir, allocId);
  return {
    spaces: nextSpaces,
    activeSpaceId: target.id,
    tabs: [...tabs, tab],
    activeTabId: tab.id,
  };
}
