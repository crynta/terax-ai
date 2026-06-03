import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WorkspaceEnv } from "@/modules/workspace";

const FS_CHANGED_EVENT = "fs:changed";

type FsChangedPayload = { paths: string[] };

export function watchAdd(paths: string[], workspace: WorkspaceEnv): void {
  if (paths.length === 0) return;
  void invoke("fs_watch_add", {
    paths,
    workspace,
  }).catch(() => {});
}

export function watchRemove(paths: string[], workspace: WorkspaceEnv): void {
  if (paths.length === 0) return;
  void invoke("fs_watch_remove", {
    paths,
    workspace,
  }).catch(() => {});
}

export function listenFsChanged(
  handler: (paths: string[]) => void,
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<FsChangedPayload>(
    FS_CHANGED_EVENT,
    (e) => handler(e.payload.paths),
  );
}

export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return path.slice(0, i + 1) || path;
  return path.slice(0, i);
}
