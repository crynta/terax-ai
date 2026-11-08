import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentWorkspaceEnv, type WorkspaceEnv } from "@/modules/workspace";

export { parentDir } from "./pathParent";

const FS_CHANGED_EVENT = "fs:changed";

type FsChangedPayload = { paths: string[] };

/**
 * `paths` are directories. `files` (open editor buffers) are reported by their
 * own path when their size or mtime moves, because the native watcher only
 * reports which directory changed.
 */
export function watchAdd(
  paths: string[],
  files: string[] = [],
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): void {
  if (paths.length === 0 && files.length === 0) return;
  void invoke("fs_watch_add", {
    paths,
    files,
    workspace,
  }).catch(() => {});
}

export function watchRemove(
  paths: string[],
  files: string[] = [],
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): void {
  if (paths.length === 0 && files.length === 0) return;
  void invoke("fs_watch_remove", {
    paths,
    files,
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
