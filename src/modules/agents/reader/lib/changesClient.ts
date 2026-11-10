/** Git reads and reverts behind the Reader's "Changes" panel. */
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { repoRelative } from "./changes";
import { repoFor } from "./contextClient";

export type HeadFileChange = {
  /** Repo-relative path. */
  path: string;
  inHead: boolean;
  added: number;
  removed: number;
  binary: boolean;
  diffText: string;
  truncated: boolean;
};

/** Live `git diff HEAD` facts for `paths` (absolute), keyed by absolute path. */
export async function headChanges(
  cwd: string,
  paths: readonly string[],
): Promise<{ repoRoot: string; byPath: Map<string, HeadFileChange> } | null> {
  const repo = await repoFor(cwd);
  if (!repo) return null;
  const rels = new Map<string, string>();
  for (const path of paths) {
    const rel = repoRelative(path, repo.repoRoot);
    if (rel) rels.set(rel, path);
  }
  if (rels.size === 0) return { repoRoot: repo.repoRoot, byPath: new Map() };
  const changes = await invoke<HeadFileChange[]>("git_head_file_changes", {
    repoRoot: repo.repoRoot,
    paths: [...rels.keys()],
    workspace: currentWorkspaceEnv(),
  });
  const byPath = new Map<string, HeadFileChange>();
  for (const change of changes) {
    const absolute = rels.get(change.path);
    if (absolute) byPath.set(absolute, change);
  }
  return { repoRoot: repo.repoRoot, byPath };
}

/**
 * Puts the file back to `HEAD`, or deletes it when it is new since `HEAD` and
 * `deleteNew` confirms that. Resolves to "restored" or "deleted".
 */
export function revertFile(
  repoRoot: string,
  absolutePath: string,
  deleteNew: boolean,
): Promise<string> {
  const path = repoRelative(absolutePath, repoRoot);
  if (!path)
    return Promise.reject(new Error("The file is outside the repository."));
  return invoke<string>("git_revert_file", {
    repoRoot,
    path,
    deleteNew,
    workspace: currentWorkspaceEnv(),
  });
}
