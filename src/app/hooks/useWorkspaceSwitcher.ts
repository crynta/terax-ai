import { native } from "@/modules/ai/lib/native";
import type { PreparedWorkspace } from "@/modules/spaces";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";

async function resolveEnvHome(env: WorkspaceEnv): Promise<string> {
  return env.kind === "wsl"
    ? getWslHome(env.distro)
    : (await homeDir()).replace(/\\/g, "/");
}

type Params = {
  setWorkspaceEnv: (env: WorkspaceEnv) => void;
};

export function useWorkspaceSwitcher({ setWorkspaceEnv }: Params) {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);

  useEffect(() => {
    homeDir()
      .then(async (p) => {
        const normalized = p.replace(/\\/g, "/");
        setHome(normalized);
        try {
          await native.workspaceAuthorize(normalized);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const prepareWorkspaceEnv = useCallback(async (env: WorkspaceEnv) => {
    const nextHome = await resolveEnvHome(env);
    await native.workspaceAuthorize(nextHome, env);
    return {
      env: env.kind === "local" ? LOCAL_WORKSPACE : env,
      home: nextHome,
    };
  }, []);

  const applyWorkspaceEnv = useCallback(
    (prepared: PreparedWorkspace) => {
      setWorkspaceEnv(prepared.env);
      setHome(prepared.home);
      setLaunchCwd(prepared.home);
    },
    [setWorkspaceEnv],
  );

  const adoptWorkspaceEnv = useCallback(
    async (env: WorkspaceEnv): Promise<string | null> => {
      try {
        const prepared = await prepareWorkspaceEnv(env);
        applyWorkspaceEnv(prepared);
        return prepared.home;
      } catch {
        return null;
      }
    },
    [prepareWorkspaceEnv, applyWorkspaceEnv],
  );

  return {
    home,
    launchCwd,
    launchCwdResolved,
    prepareWorkspaceEnv,
    applyWorkspaceEnv,
    adoptWorkspaceEnv,
  };
}
