import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { useEffect, useRef } from "react";
import {
  activeSpaceEnv,
  applyExplicitLaunchDir,
  freshTabCwd,
} from "./activeSpace";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import { loadAll, type SpaceMeta, saveActiveId, saveSpacesList } from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  explicitLaunchDir: string | null;
  home: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
};

type BootParams = Omit<Params, "ready" | "markBooted">;

type BootDependencies = {
  loadAll: typeof loadAll;
  saveSpacesList: typeof saveSpacesList;
  saveActiveId: typeof saveActiveId;
  workspaceAuthorize: typeof native.workspaceAuthorize;
  hydrate: (
    spaces: SpaceMeta[],
    activeId: string | null,
    initialActiveIndex?: Record<string, number>,
  ) => void;
};

function uniqueCwds(tabs: Tab[]): string[] {
  const set = new Set<string>();
  const walk = (n: PaneNode) => {
    if (isLeaf(n)) {
      if (n.cwd) set.add(n.cwd);
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const t of tabs) if (t.kind === "terminal") walk(t.paneTree);
  return [...set];
}

const defaultBootDependencies: BootDependencies = {
  loadAll,
  saveSpacesList,
  saveActiveId,
  workspaceAuthorize: (path) => native.workspaceAuthorize(path),
  hydrate: (spaces, activeId, initialActiveIndex) =>
    useSpaces.getState().hydrate(spaces, activeId, initialActiveIndex),
};

export async function bootSpaces(
  {
    launchCwd,
    explicitLaunchDir,
    home,
    allocId,
    replaceTabs,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  }: BootParams,
  deps: BootDependencies = defaultBootDependencies,
): Promise<void> {
  const { spaces, activeId, states } = await deps.loadAll();

  if (spaces.length === 0) {
    const root = launchCwd ?? home ?? null;
    // Hydrate prefs before reading the saved workspace env.
    await usePreferencesStore
      .getState()
      .init()
      .catch(() => {});
    const meta: SpaceMeta = {
      id: DEFAULT_SPACE_ID,
      name: "Default",
      root,
      env: explicitLaunchDir
        ? { kind: "local" }
        : parseWorkspaceScopeKey(
            usePreferencesStore.getState().defaultWorkspaceEnv,
          ),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await deps.saveSpacesList([meta]);
    await deps.saveActiveId(DEFAULT_SPACE_ID);
    setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
    deps.hydrate([meta], DEFAULT_SPACE_ID);
    return;
  }

  const restored: Tab[] = [];
  for (const space of spaces) {
    const st = states.get(space.id);
    if (!st) continue;
    restored.push(...hydrateTabs(st.tabs, space.id, allocId));
  }

  const active =
    activeId && spaces.some((s) => s.id === activeId)
      ? activeId
      : spaces[0].id;

  const initialActiveIndex: Record<string, number> = {};
  for (const [id, st] of states)
    initialActiveIndex[id] = st.activeTabIndex;

  if (explicitLaunchDir) {
    const launched = applyExplicitLaunchDir({
      spaces,
      tabs: restored,
      launchDir: explicitLaunchDir,
      allocId,
    });
    setActiveSpaceForNewTabs(launched.activeSpaceId);
    await adoptWorkspaceEnv({ kind: "local" }).catch(() => null);
    const authorizeCwds = [
      ...new Set([explicitLaunchDir, ...uniqueCwds(launched.tabs)]),
    ];
    await Promise.allSettled([
      deps.saveSpacesList(launched.spaces),
      deps.saveActiveId(launched.activeSpaceId),
      ...authorizeCwds.map((cwd) => deps.workspaceAuthorize(cwd)),
    ]);
    deps.hydrate(
      launched.spaces,
      launched.activeSpaceId,
      initialActiveIndex,
    );
    replaceTabs(launched.tabs, launched.activeTabId);
    return;
  }

  setActiveSpaceForNewTabs(active);

  // Apply the space's env+home before the fresh-tab fallback and spawns
  // below; env is set synchronously so cwd resolution picks WSL vs local.
  const env = activeSpaceEnv(spaces, active);
  const restoredHome = await adoptWorkspaceEnv(env);

  // Active space must never be empty, else its tab list shows nothing.
  if (!restored.some((t) => t.spaceId === active)) {
    const cwd = freshTabCwd(env, restoredHome, launchCwd, home);
    restored.push(freshTerminalTab(active, cwd, allocId));
  }

  await Promise.allSettled(
    uniqueCwds(restored).map((cwd) => deps.workspaceAuthorize(cwd)),
  );

  deps.hydrate(spaces, active, initialActiveIndex);

  const inActive = restored.filter((t) => t.spaceId === active);
  const idx = states.get(active)?.activeTabIndex ?? 0;
  const activeTab = inActive[idx] ?? inActive[0] ?? restored[0];
  replaceTabs(restored, activeTab.id);
}

export function useSpacesBoot({
  ready,
  launchCwd,
  explicitLaunchDir,
  home,
  allocId,
  replaceTabs,
  markBooted,
  setActiveSpaceForNewTabs,
  adoptWorkspaceEnv,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void bootSpaces({
      launchCwd,
      explicitLaunchDir,
      home,
      allocId,
      replaceTabs,
      setActiveSpaceForNewTabs,
      adoptWorkspaceEnv,
    })
      .catch((e) => {
        console.error("[terax] spaces boot failed:", e);
      })
      .finally(markBooted);
  }, [
    ready,
    launchCwd,
    explicitLaunchDir,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  ]);
}
