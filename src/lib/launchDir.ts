import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;
let explicit: string | undefined;

export async function initLaunchDir(): Promise<void> {
  const requested = await invoke<string | null>("get_launch_dir").catch(
    () => null,
  );
  explicit = requested ? requested.replace(/\\/g, "/") : undefined;
  if (explicit) {
    cached = explicit;
    return;
  }
  const fallback = await invoke<string>("workspace_current_dir").catch(
    () => null,
  );
  cached = fallback ? fallback.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}

export function getExplicitLaunchDir(): string | undefined {
  return explicit;
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
