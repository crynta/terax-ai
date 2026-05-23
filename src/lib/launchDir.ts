import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;

export async function initLaunchDir(): Promise<void> {
  // get_launch_dir is drained after first read (prevents HMR replay).
  // On webview refresh it returns null, so fall back to workspace_current_dir
  // which uses the process-level LAUNCH_CWD snapshot and always returns the
  // correct project directory (never System32 on Windows).
  const dir =
    (await invoke<string | null>("get_launch_dir").catch(() => null)) ??
    (await invoke<string>("workspace_current_dir").catch(() => null));
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}
