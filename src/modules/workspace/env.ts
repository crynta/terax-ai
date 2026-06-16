import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setLastWslDistro } from "@/modules/settings/store";

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | {
      kind: "ssh";
      host: string;
      user?: string | null;
      port?: number | null;
      root?: string | null;
    };

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

type State = {
  env: WorkspaceEnv;
  distros: WslDistro[];
  loading: boolean;
  error: string | null;
  setEnv: (env: WorkspaceEnv) => void;
  refreshDistros: () => Promise<WslDistro[]>;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };

export const useWorkspaceEnvStore = create<State>((set) => ({
  env: LOCAL_WORKSPACE,
  distros: [],
  loading: false,
  error: null,
  setEnv: (env) => {
    set({ env });
    if (env.kind === "wsl") void setLastWslDistro(env.distro);
  },
  refreshDistros: async () => {
    set({ loading: true, error: null });
    try {
      const distros = await invoke<WslDistro[]>("wsl_list_distros");
      set({ distros, loading: false });
      return distros;
    } catch (e) {
      set({ distros: [], loading: false, error: String(e) });
      return [];
    }
  },
}));

export function currentWorkspaceEnv(): WorkspaceEnv {
  return useWorkspaceEnvStore.getState().env;
}

export function workspaceScopeKey(env: WorkspaceEnv): string {
  if (env.kind === "wsl") return `wsl:${env.distro}`;
  if (env.kind === "ssh") {
    const user = env.user ? `${env.user}@` : "";
    const port = env.port ? `:${env.port}` : "";
    return `ssh:${user}${env.host}${port}`;
  }
  return "local";
}

export function currentWorkspaceScopeKey(): string {
  return workspaceScopeKey(currentWorkspaceEnv());
}

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

export async function getSshHome(env: Extract<WorkspaceEnv, { kind: "ssh" }>): Promise<string> {
  return invoke<string>("ssh_home", { workspace: env });
}

export async function getSshDefaultRoot(
  env: Extract<WorkspaceEnv, { kind: "ssh" }>,
): Promise<string> {
  return invoke<string>("ssh_default_root", { workspace: env });
}

export function sshLabel(env: Extract<WorkspaceEnv, { kind: "ssh" }>): string {
  const user = env.user ? `${env.user}@` : "";
  const port = env.port ? `:${env.port}` : "";
  return `${user}${env.host}${port}`;
}
