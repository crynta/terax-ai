import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { activeSpaceEnv, freshTabCwd } from "@/modules/spaces/lib/activeSpace";
import {
  loadAll,
  type SpaceMeta,
  saveActiveId,
  saveSpacesList,
  saveWorkbenchBackup,
} from "@/modules/spaces/lib/store";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import type { Tab } from "@/modules/tabs/lib/tabs";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { useEffect, useRef } from "react";
import { ensureProjectHasMain } from "./actions";
import { restoreProject } from "./model/restore";
import type { Task } from "./model/workbench";
import { allocId, hydrateWorkbench, markBooted, snapshot } from "./store";
import { rememberLegacyFingerprint } from "./useWorkbenchPersistence";

const loadMigration = () =>
  import("./model/legacyMigration").then((m) => m.migrateLegacySpace);

export const DEFAULT_PROJECT_ID = "default";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  home: string | null;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
};

function terminalCwds(tabs: readonly Tab[]): string[] {
  const set = new Set<string>();
  for (const tab of tabs)
    if (tab.kind === "terminal" && tab.cwd) set.add(tab.cwd);
  return [...set];
}

/**
 * Restores projects and their tasks once the launch directory is known.
 * Projects saved before the workbench existed, or changed by an older build
 * since, are migrated from their legacy tab list, which this build never
 * writes. A stored state it cannot read in full is backed up first.
 */
export function useWorkbenchBoot({
  ready,
  launchCwd,
  home,
  adoptWorkspaceEnv,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const { spaces, activeId, workbench, legacy } = await loadAll();

        if (spaces.length === 0) {
          const root = launchCwd ?? home ?? null;
          await usePreferencesStore
            .getState()
            .init()
            .catch(() => {});
          const meta: SpaceMeta = {
            id: DEFAULT_PROJECT_ID,
            name: "Default",
            root,
            env: parseWorkspaceScopeKey(
              usePreferencesStore.getState().defaultWorkspaceEnv,
            ),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await saveSpacesList([meta]);
          await saveActiveId(DEFAULT_PROJECT_ID);
          useSpaces.getState().hydrate([meta], DEFAULT_PROJECT_ID);
          hydrateWorkbench({
            tabs: [],
            tasks: [],
            activeProjectId: DEFAULT_PROJECT_ID,
            activeTaskByProject: {},
          });
          ensureProjectHasMain(DEFAULT_PROJECT_ID, root ?? undefined);
          return;
        }

        const tabs: Tab[] = [];
        const tasks: Task[] = [];
        const activeTaskByProject: Record<string, number> = {};
        for (const space of spaces) {
          const stored = workbench.get(space.id);
          const restored = await restoreProject(
            stored,
            legacy.get(space.id),
            space.id,
            allocId,
            loadMigration,
          );
          if (restored.backup) await saveWorkbenchBackup(space.id, stored);
          rememberLegacyFingerprint(space.id, restored.legacy);
          const { project } = restored;
          tabs.push(...project.tabs);
          tasks.push(...project.tasks);
          if (project.activeTaskId !== null)
            activeTaskByProject[space.id] = project.activeTaskId;
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        // Apply the project's env and home before any fallback cwd below, so
        // a WSL project resolves WSL paths.
        const env = activeSpaceEnv(spaces, active);
        const restoredHome = await adoptWorkspaceEnv(env);

        await Promise.allSettled(
          terminalCwds(tabs).map((cwd) => native.workspaceAuthorize(cwd)),
        );

        useSpaces.getState().hydrate(spaces, active);
        hydrateWorkbench({
          tabs,
          tasks,
          activeProjectId: active,
          activeTaskByProject,
        });
        for (const space of spaces) {
          const cwd =
            space.id === active
              ? freshTabCwd(env, restoredHome, launchCwd, home)
              : space.root;
          ensureProjectHasMain(space.id, cwd ?? undefined);
        }
      } catch (e) {
        console.error("[terax] workbench boot failed:", e);
        if (snapshot().tasks.length === 0) {
          const id = useSpaces.getState().activeId ?? DEFAULT_PROJECT_ID;
          hydrateWorkbench({
            tabs: [],
            tasks: [],
            activeProjectId: id,
            activeTaskByProject: {},
          });
          ensureProjectHasMain(id, launchCwd ?? home ?? undefined);
        }
      } finally {
        markBooted();
      }
    })();
  }, [ready, launchCwd, home, adoptWorkspaceEnv]);
}
