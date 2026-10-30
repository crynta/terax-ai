/** A directory the explorer has read at least once, keyed by its path. */
export type ChildrenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: DirEntry[] }
  | { status: "error"; message: string };

export type TreeState = Record<string, ChildrenState>;

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  gitignored: boolean;
};

/**
 * Every directory the tree currently shows: the root, every loaded listing, and every
 * expanded path (an expanded-but-not-yet-loaded dir still needs its read).
 */
export function refreshTargets(
  rootPath: string | null,
  nodes: TreeState,
  expanded: Iterable<string>,
): string[] {
  if (!rootPath) return [];
  const targets = new Set<string>([rootPath]);
  for (const [path, state] of Object.entries(nodes)) {
    if (state.status === "loaded") targets.add(path);
  }
  for (const path of expanded) targets.add(path);
  targets.delete(rootPath);
  return [rootPath, ...[...targets].sort()];
}
