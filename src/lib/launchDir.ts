import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;

export async function initLaunchDir(): Promise<void> {
  const dir =
    (await invoke<string | null>("get_launch_dir").catch(() => null)) ??
    (await invoke<string>("workspace_current_dir").catch(() => null));
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}

/**
 * Drains the file passed via the OS "Open With" action (CLI arg on
 * Linux/Windows, macOS open-files event). Drained once so HMR / re-mounts
 * can't replay it. Returns undefined when the app wasn't launched with a file.
 */
export async function consumeLaunchFile(): Promise<string | undefined> {
  const file = await invoke<string | null>("get_launch_file").catch(() => null);
  return file ? file.replace(/\\/g, "/") : undefined;
}
