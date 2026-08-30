import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import {
  parseWorkspaceScopeKey,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import { useEffect, useRef } from "react";
import { activeSpaceEnv } from "./activeSpace";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import {
  hasUsableSpaceRoot,
  migrateSpaceRoots,
  SPACE_SCHEMA_VERSION,
  type SpaceRootIssues,
  validatePersistedSpaceRoots,
} from "./spaceRoot";
import {
  loadAll,
  type SpaceMeta,
  type SpaceState,
  saveActiveId,
  saveSchemaVersion,
  saveSpacesList,
} from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  home: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
};

async function validateSpaceRoot(
  candidate: string,
  env: WorkspaceEnv,
): Promise<string> {
  const root = await native.canonicalize(candidate, env);
  await native.workspaceAuthorize(root, env);
  return root;
}

export function restoreBootTabs(
  spaces: SpaceMeta[],
  states: Map<string, SpaceState>,
  active: string,
  rootIssues: SpaceRootIssues,
  allocId: () => number,
): Tab[] {
  const restored: Tab[] = [];
  for (const space of spaces) {
    const state = states.get(space.id);
    if (!state) continue;
    restored.push(...hydrateTabs(state.tabs, space.id, allocId));
  }

  const activeSpace = spaces.find((space) => space.id === active);
  if (!restored.some((tab) => tab.spaceId === active) && activeSpace) {
    restored.push(
      freshTerminalTab(
        active,
        hasUsableSpaceRoot(activeSpace, rootIssues) ? activeSpace.root : null,
        allocId,
      ),
    );
  }
  return restored;
}

async function recoverUnavailableRootsToHome(
  spaces: SpaceMeta[],
  rootIssues: SpaceRootIssues,
  homeForEnv: (env: WorkspaceEnv) => Promise<string | null>,
): Promise<{ spaces: SpaceMeta[]; rootIssues: SpaceRootIssues }> {
  const recovered = [...spaces];
  const remaining = { ...rootIssues };

  for (let index = 0; index < recovered.length; index += 1) {
    const space = recovered[index];
    if (!remaining[space.id]) continue;

    const home = await homeForEnv(space.env);
    if (!home) continue;
    try {
      const root = await validateSpaceRoot(home, space.env);
      recovered[index] = { ...space, root, updatedAt: Date.now() };
      delete remaining[space.id];
    } catch (error) {
      remaining[space.id] = {
        candidate: home,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { spaces: recovered, rootIssues: remaining };
}

export function workspaceCwdsForTabs(
  tabs: Tab[],
  spaces: SpaceMeta[],
): Array<{ cwd: string; env: WorkspaceEnv }> {
  const bySpace = new Map(spaces.map((space) => [space.id, space.env]));
  const pairs = new Map<string, { cwd: string; env: WorkspaceEnv }>();

  const walk = (node: PaneNode, env: WorkspaceEnv) => {
    if (isLeaf(node)) {
      if (node.cwd) {
        pairs.set(`${workspaceScopeKey(env)}\0${node.cwd}`, {
          cwd: node.cwd,
          env,
        });
      }
      return;
    }
    for (const child of node.children) walk(child, env);
  };

  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    const env = bySpace.get(tab.spaceId);
    if (env) walk(tab.paneTree, env);
  }
  return [...pairs.values()];
}

export async function authorizeWorkspaceCwds(
  tabs: Tab[],
  spaces: SpaceMeta[],
  authorize: (
    cwd: string,
    env: WorkspaceEnv,
  ) => Promise<unknown> = native.workspaceAuthorize,
): Promise<void> {
  await Promise.allSettled(
    workspaceCwdsForTabs(tabs, spaces).map(({ cwd, env }) =>
      authorize(cwd, env),
    ),
  );
}

export function useSpacesBoot({
  ready,
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

    void (async () => {
      try {
        const loaded = await loadAll();
        let { spaces, activeId, states } = loaded;

        if (spaces.length === 0) {
          await usePreferencesStore
            .getState()
            .init()
            .catch(() => {});
          const env = parseWorkspaceScopeKey(
            usePreferencesStore.getState().defaultWorkspaceEnv,
          );
          const envHome = await adoptWorkspaceEnv(env);
          const candidate = envHome ?? (env.kind === "local" ? home : null);
          let root: string | null = null;
          let rootIssues: SpaceRootIssues = {};
          if (candidate) {
            try {
              root = await validateSpaceRoot(candidate, env);
            } catch (error) {
              rootIssues = {
                [DEFAULT_SPACE_ID]: {
                  candidate,
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              };
            }
          } else {
            rootIssues = {
              [DEFAULT_SPACE_ID]: {
                candidate: null,
                message: "No directory is available",
              },
            };
          }
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root,
            env,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await saveSpacesList([meta]);
          await Promise.all([
            saveActiveId(DEFAULT_SPACE_ID),
            saveSchemaVersion(SPACE_SCHEMA_VERSION),
          ]);
          const tab = freshTerminalTab(DEFAULT_SPACE_ID, root, allocId);
          setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
          useSpaces
            .getState()
            .hydrate([meta], DEFAULT_SPACE_ID, {}, rootIssues);
          replaceTabs([tab], tab.id);
          return;
        }

        let rootIssues: SpaceRootIssues = {};
        if (loaded.schemaVersion < SPACE_SCHEMA_VERSION) {
          const migration = await migrateSpaceRoots(
            loaded,
            (env) => adoptWorkspaceEnv(env),
            validateSpaceRoot,
          );
          spaces = migration.spaces;
          rootIssues = migration.issues;
          if (spaces.some((space, index) => space !== loaded.spaces[index])) {
            await saveSpacesList(spaces);
          }
          await saveSchemaVersion(SPACE_SCHEMA_VERSION);
        } else {
          rootIssues = await validatePersistedSpaceRoots(
            spaces,
            validateSpaceRoot,
          );
        }

        if (Object.keys(rootIssues).length > 0) {
          const recovery = await recoverUnavailableRootsToHome(
            spaces,
            rootIssues,
            adoptWorkspaceEnv,
          );
          if (recovery.spaces.some((space, index) => space !== spaces[index])) {
            await saveSpacesList(recovery.spaces);
          }
          spaces = recovery.spaces;
          rootIssues = recovery.rootIssues;
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        const restored = restoreBootTabs(
          spaces,
          states,
          active,
          rootIssues,
          allocId,
        );
        setActiveSpaceForNewTabs(active);

        const env = activeSpaceEnv(spaces, active);
        const adoptedHome = await adoptWorkspaceEnv(env);
        let bootTabs = restored;
        if (!adoptedHome) {
          const activeSpace = spaces.find((space) => space.id === active);
          rootIssues = {
            ...rootIssues,
            [active]: {
              candidate: activeSpace?.root ?? null,
              message: "Unable to activate Space environment",
            },
          };
          bootTabs = [freshTerminalTab(active, null, allocId)];
        } else {
          await authorizeWorkspaceCwds(restored, spaces);
        }

        const initialActiveIndex: Record<string, number> = {};
        for (const [id, st] of states)
          initialActiveIndex[id] = st.activeTabIndex;
        useSpaces
          .getState()
          .hydrate(
            spaces,
            active,
            initialActiveIndex,
            rootIssues,
            !adoptedHome,
          );

        const inActive = bootTabs.filter((t) => t.spaceId === active);
        const idx = states.get(active)?.activeTabIndex ?? 0;
        const activeTab = inActive[idx] ?? inActive[0] ?? bootTabs[0];
        replaceTabs(bootTabs, activeTab.id);
      } catch (e) {
        console.error("[terax] spaces boot failed:", e);
      } finally {
        markBooted();
      }
    })();
  }, [
    ready,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  ]);
}
