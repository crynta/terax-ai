import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setLastWslDistro } from "@/modules/settings/store";

export type SshWorkspaceProfile = {
  id: string;
  label: string;
  host: string;
  user: string | null;
  port: number | null;
  rootPath: string;
};

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | ({ kind: "ssh"; password?: string | null } & SshWorkspaceProfile);

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

export function sameWorkspaceEnv(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "local") return true;
  if (a.kind === "wsl") {
    return a.distro === (b as Extract<WorkspaceEnv, { kind: "wsl" }>).distro;
  }
  const lhs = a as Extract<WorkspaceEnv, { kind: "ssh" }>;
  const rhs = b as Extract<WorkspaceEnv, { kind: "ssh" }>;
  return (
    lhs.id === rhs.id &&
    lhs.host === rhs.host &&
    lhs.user === rhs.user &&
    lhs.port === rhs.port
  );
}

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
    const user = env.user ?? "";
    const port = env.port ? `:${env.port}` : "";
    return `ssh:${user}@${env.host}${port}`;
  }
  return "local";
}

export function currentWorkspaceScopeKey(): string {
  return workspaceScopeKey(currentWorkspaceEnv());
}

export function workspaceDisplayLabel(env: WorkspaceEnv): string {
  if (env.kind === "local") return "Local";
  if (env.kind === "wsl") return `WSL: ${env.distro}`;
  const user = env.user ? `${env.user}@` : "";
  const port = env.port ? `:${env.port}` : "";
  return env.label.trim() || `SSH: ${user}${env.host}${port}`;
}

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

export function normalizeHostName(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/\.local$/, "");
}

export function isLocalHost(
  remoteHost: string | null | undefined,
  localHost: string | null | undefined,
): boolean {
  const remote = normalizeHostName(remoteHost);
  const local = normalizeHostName(localHost);
  if (!remote || !local) return false;
  return remote === local;
}
