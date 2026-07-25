import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;
let explicitCached: string | undefined;

export async function initLaunchDir(): Promise<void> {
  const explicit = await invoke<string | null>("get_launch_dir").catch(
    () => null,
  );
  if (explicit) {
    explicitCached = explicit.replace(/\\/g, "/");
    cached = explicitCached;
    return;
  }

  const dir = await invoke<string>("workspace_current_dir").catch(() => null);
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}

export function getExplicitLaunchDir(): string | undefined {
  return explicitCached;
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
