import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { leafHasForegroundProcess } from "@/modules/terminal";
import { snapshot } from "@/modules/workbench/store";
import {
  currentWorkspaceEnv,
  getWslHome,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { evaluateCloseHazards } from "./tabCloseGuards";

async function resolveEnvHome(env: WorkspaceEnv): Promise<string> {
  return env.kind === "wsl"
    ? getWslHome(env.distro)
    : (await homeDir()).replace(/\\/g, "/");
}

type Params = {
  workspaceEnv: WorkspaceEnv;
  setWorkspaceEnv: (env: WorkspaceEnv) => void;
  /** Replaces only the originating project's tasks. */
  resetWorkspace: (projectId: string, home: string, env: WorkspaceEnv) => void;
};

/**
 * Owns the resolved home / launch cwd. switchWorkspace runs an interactive
 * local⇄WSL switch (tears down sessions, re-authorizes home, resets tabs);
 * adoptWorkspaceEnv applies a space's env + home on restore, without teardown.
 */
export function useWorkspaceSwitcher({
  workspaceEnv,
  setWorkspaceEnv,
  resetWorkspace,
}: Params) {
  const operation = useRef(0);
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(async (p) => {
        const normalized = p.replace(/\\/g, "/");
        if (currentWorkspaceEnv().kind === "local") setHome(normalized);
        try {
          await native.workspaceAuthorize(normalized, LOCAL_WORKSPACE);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => {
        if (currentWorkspaceEnv().kind === "local") setHome(null);
      });
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const authorizeHome = useCallback(
    async (nextHome: string, env: WorkspaceEnv) => {
      try {
        await native.workspaceAuthorize(nextHome, env);
      } catch {
        // Non-fatal — git panel will surface "not authorized" if needed.
      }
    },
    [],
  );

  const switchWorkspace = useCallback(
    async (projectId: string, env: WorkspaceEnv): Promise<boolean> => {
      const token = ++operation.current;
      const current = () =>
        operation.current === token &&
        snapshot().activeProjectId === projectId &&
        useSpaces.getState().activeId === projectId;
      if (!current()) return false;
      const capture = () => {
        const tabs = snapshot().tabs.filter((t) => t.spaceId === projectId);
        return {
          dirtyIds: tabs
            .filter((t) => t.kind === "editor" && t.dirty)
            .map((t) => t.id),
          leafIds: tabs.filter((t) => t.kind === "terminal").map((t) => t.id),
        };
      };
      const previous =
        useSpaces.getState().spaces.find((s) => s.id === projectId)?.env ??
        workspaceEnv;
      if (
        env.kind === previous.kind &&
        (env.kind === "local" ||
          (previous.kind === "wsl" && env.distro === previous.distro))
      )
        return false;
      const rejectDirty = () => {
        if (!capture().dirtyIds.length) return false;
        window.alert(
          "Save or close unsaved editor tabs before switching workspace.",
        );
        return true;
      };
      if (rejectDirty()) return false;
      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(env);
      } catch (e) {
        if (current()) window.alert(String(e));
        return false;
      }
      if (!current()) return false;
      await authorizeHome(nextHome, env);
      if (!current()) return false;
      const hazards = await evaluateCloseHazards(
        capture,
        leafHasForegroundProcess,
        usePreferencesStore.getState().confirmCloseRunningTerminal,
      );
      if (!current() || rejectDirty()) return false;
      if (
        hazards.busyLeafIds.length &&
        !window.confirm(
          "Running processes will stop when this project's environment changes. Continue?",
        )
      )
        return false;
      if (!current() || rejectDirty()) return false;
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      setHome(nextHome);
      setLaunchCwd(nextHome);
      resetWorkspace(projectId, nextHome, env);
      return true;
    },
    [workspaceEnv, setWorkspaceEnv, resetWorkspace, authorizeHome],
  );

  const adoptWorkspaceEnv = useCallback(
    async function adopt(
      env: WorkspaceEnv,
      projectId?: string,
    ): Promise<string | null> {
      const token = ++operation.current;
      const current = () =>
        operation.current === token &&
        (!projectId || useSpaces.getState().activeId === projectId);
      if (!current()) return null;
      toast.dismiss("workspace-home");
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      setHome(null);
      setLaunchCwd(null);
      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(env);
      } catch (error) {
        if (current())
          toast.error("Could not resolve the project home directory.", {
            id: "workspace-home",
            description: String(error),
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Retry",
              onClick: () => {
                if (current()) void adopt(env, projectId);
              },
            },
          });
        return null;
      }
      if (!current()) return null;
      await authorizeHome(nextHome, env);
      if (!current()) return null;
      setHome(nextHome);
      setLaunchCwd(nextHome);
      return nextHome;
    },
    [setWorkspaceEnv, authorizeHome],
  );

  return {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  };
}
