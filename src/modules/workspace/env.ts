import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setLastWslDistro } from "@/modules/settings/store";

export type SshConnection = {
  host: string;
  user?: string;
  port?: number;
  key_path?: string;
  password?: string;
  label?: string;
};

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; host: string; user?: string; port?: number; key_path?: string; password?: string };

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

export type DetectedShell = {
  kind: string;
  label: string;
  icon: string;
  path: string;
};

type State = {
  env: WorkspaceEnv;
  distros: WslDistro[];
  shells: DetectedShell[];
  loading: boolean;
  error: string | null;
  setEnv: (env: WorkspaceEnv) => void;
  refreshDistros: () => Promise<WslDistro[]>;
  refreshShells: () => Promise<DetectedShell[]>;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };

export function workspaceLabel(env: WorkspaceEnv): string {
  switch (env.kind) {
    case "local":
      return "Local";
    case "wsl":
      return `WSL: ${env.distro}`;
    case "ssh":
      return env.user ? `SSH: ${env.user}@${env.host}` : `SSH: ${env.host}`;
  }
}

export function workspaceIcon(env: WorkspaceEnv): string {
  switch (env.kind) {
    case "local":
      return "terminal";
    case "wsl":
      return "wsl";
    case "ssh":
      return "ssh";
  }
}

export const useWorkspaceEnvStore = create<State>((set) => ({
  env: LOCAL_WORKSPACE,
  distros: [],
  shells: [],
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
  refreshShells: async () => {
    try {
      const shells = await invoke<DetectedShell[]>("list_available_shells");
      set({ shells });
      return shells;
    } catch {
      return [];
    }
  },
}));

export function currentWorkspaceEnv(): WorkspaceEnv {
  return useWorkspaceEnvStore.getState().env;
}

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

export async function sshTestConnection(
  host: string,
  user?: string,
  port?: number,
  key_path?: string,
  password?: string,
): Promise<boolean> {
  return invoke<boolean>("ssh_test_connection", {
    host,
    user: user ?? null,
    port: port ?? null,
    keyPath: key_path ?? null,
    password: password ?? null,
  });
}
