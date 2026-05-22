import { invoke } from "@tauri-apps/api/core";

let cachedDir: string | undefined;
let cachedFile: string | undefined;

export async function initLaunchDir(): Promise<void> {
  const [dir, file] = await Promise.all([
    invoke<string | null>("get_launch_dir").catch(() => null),
    invoke<string | null>("get_launch_file").catch(() => null),
  ]);
  cachedDir = dir ? dir.replace(/\\/g, "/") : undefined;
  cachedFile = file ? file.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cachedDir;
}

export function getLaunchFile(): string | undefined {
  return cachedFile;
}
