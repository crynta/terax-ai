import type { ExplorerPathRename } from "@/modules/explorer";
import type { SpaceMeta } from "@/modules/spaces";
import type { Tab } from "@/modules/tabs";
import { workspaceScopeKey } from "@/modules/workspace";

export function pathAtOrUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function projectRenamedPath(
  path: string,
  changes: readonly ExplorerPathRename[],
): string {
  let projected = path;
  for (const change of changes) {
    if (!pathAtOrUnder(projected, change.from)) continue;
    projected = `${change.to}${projected.slice(change.from.length)}`;
  }
  return projected;
}

export function spaceIdsForWorkspace(
  spaces: readonly SpaceMeta[],
  workspaceKey: string,
): Set<string> {
  return new Set(
    spaces
      .filter((space) => workspaceScopeKey(space.env) === workspaceKey)
      .map((space) => space.id),
  );
}

export function hasOpenEditorAtPath(
  tabs: readonly Tab[],
  path: string,
  completed: readonly ExplorerPathRename[],
  spaceIds: ReadonlySet<string>,
): boolean {
  return tabs.some(
    (tab) =>
      tab.kind === "editor" &&
      spaceIds.has(tab.spaceId) &&
      pathAtOrUnder(projectRenamedPath(tab.path, completed), path),
  );
}
