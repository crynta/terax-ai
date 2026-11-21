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
 * Drains the files passed via the OS "Open With" action (CLI args on
 * Linux/Windows, macOS open-files event). Drained once so HMR / re-mounts
 * can't replay them. Returns [] when the app wasn't launched with a file.
 */
export async function consumeLaunchFiles(): Promise<string[]> {
  const files = await invoke<string[]>("get_launch_files").catch(() => []);
  return files.map((f) => f.replace(/\\/g, "/"));
}

/**
 * Drains the directories opened via the OS action on a cold start (macOS
 * `open -a Terax <dir>`, or a directory launch argument), so they can land as
 * fresh terminal tabs after boot rather than only seeding the workspace cwd.
 * Drained until the backend reports none left, so two rapid opens are not
 * collapsed to the last one. Returns [] when no directory was opened, so the
 * launch cwd context still applies without adding a tab.
 */
export async function consumeLaunchOpenDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (;;) {
    const dir = await invoke<string | null>("get_launch_open_dir").catch(() => null);
    if (!dir) break;
    dirs.push(dir.replace(/\\/g, "/"));
  }
  return dirs;
}
