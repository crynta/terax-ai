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

/**
 * Drains the files passed via the OS "Open With" action (CLI args on
 * Linux/Windows, macOS open-files event). Drained once so HMR / re-mounts
 * can't replay them. Returns [] when the app wasn't launched with a file.
 */
export async function consumeLaunchFiles(): Promise<string[]> {
  const files = await invoke<string[]>("get_launch_files").catch(() => []);
  return files.map((f) => f.replace(/\\/g, "/"));
}
