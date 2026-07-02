import { invoke } from "@tauri-apps/api/core";

let cached: { path: string | undefined; isExplicit: boolean } = { path: undefined, isExplicit: false };

export async function initLaunchDir(): Promise<void> {
  const explicitDir = await invoke<string | null>("get_launch_dir").catch(() => null);
  const fallbackDir = await invoke<string>("workspace_current_dir").catch(() => null);
  const dir = explicitDir ?? fallbackDir;
  cached = {
    path: dir ? dir.replace(/\\/g, "/") : undefined,
    isExplicit: !!explicitDir,
  };
}

export function getLaunchDir(): { path: string | undefined; isExplicit: boolean } {
  return cached;
}
