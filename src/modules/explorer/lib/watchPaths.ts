import type { WorkspaceEnv } from "@/modules/workspace";

// The native watcher canonicalises before reporting: a WSL directory arrives as
// `//wsl.localhost/<distro>/home/x` (or the legacy `//wsl$/...` share) and a
// drvfs directory as `C:/Users/x`. Every consumer keys by the workspace's own
// spelling instead, so without this the reported paths never match and a WSL
// tree only ever updates on a manual refresh.
const WSL_SHARE = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i;
const DRIVE = /^([A-Za-z]):\/(.*)$/;

/** Maps a watcher-reported (host-canonical) path back to the workspace's own spelling. */
export function toWorkspacePath(path: string, workspace: WorkspaceEnv): string {
  if (workspace.kind !== "wsl") return path;
  // `\\wsl.localhost\...` is the same share spelled with host separators.
  const p = path.replace(/\\/g, "/");
  const share = WSL_SHARE.exec(p);
  if (share) {
    // A different distro is not this workspace's filesystem, so it stays as
    // reported rather than being mangled into an unrelated in-distro path.
    if (share[1].toLowerCase() !== workspace.distro.toLowerCase()) return path;
    return share[2] || "/";
  }
  const drive = DRIVE.exec(p);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`;
  return path;
}
