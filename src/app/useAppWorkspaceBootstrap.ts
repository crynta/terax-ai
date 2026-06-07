import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

type UseAppWorkspaceBootstrapInput = {
  resetWorkspace: (cwd?: string) => void;
};

export function useAppWorkspaceBootstrap({
  resetWorkspace,
}: UseAppWorkspaceBootstrapInput) {
  const [home, setHome] = useState<string | null>(null);
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (workspaceEnv.kind !== "wsl") return;
    getWslHome(workspaceEnv.distro)
      .then(async (nextHome) => {
        if (cancelled || !nextHome) return;
        setHome(nextHome);
        setLaunchCwd(nextHome);
        try {
          await native.workspaceAuthorize(nextHome);
        } catch {
          // Non-fatal - git panel will surface "not authorized" if needed.
        }
        resetWorkspace(nextHome);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceEnv(LOCAL_WORKSPACE);
      });
    return () => {
      cancelled = true;
    };
  }, [resetWorkspace, setWorkspaceEnv, workspaceEnv]);

  const switchWorkspace = useCallback(
    async (next: WorkspaceEnv) => {
      if (next.kind === "local" && workspaceEnv.kind === "local") return;
      if (
        next.kind === "wsl" &&
        workspaceEnv.kind === "wsl" &&
        next.distro === workspaceEnv.distro
      ) {
        return;
      }
      if (next.kind === "local") {
        setWorkspaceEnv(LOCAL_WORKSPACE);
        const localHome = await homeDir().catch(() => null);
        setHome(localHome);
        setLaunchCwd(localHome);
        resetWorkspace(localHome ?? undefined);
        return;
      }

      const nextHome = await getWslHome(next.distro);
      if (!nextHome)
        throw new Error(`Could not resolve WSL home for ${next.distro}`);
      setWorkspaceEnv(next);
      setHome(nextHome);
      setLaunchCwd(nextHome);
      if (nextHome) {
        try {
          await native.workspaceAuthorize(nextHome);
        } catch {
          // Non-fatal - git panel will surface "not authorized" if needed.
        }
      }
      resetWorkspace(nextHome ?? undefined);
    },
    [workspaceEnv, setWorkspaceEnv, resetWorkspace],
  );

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  return {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
  };
}
