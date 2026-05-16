import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setLastWslDistro, setLastSshProfileId } from "@/modules/settings/store";

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; profileId: string };

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
    if (env.kind === "ssh") void setLastSshProfileId(env.profileId);
    if (env.kind === "local") void setLastSshProfileId(null);
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

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}
