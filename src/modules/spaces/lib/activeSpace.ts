import type { WorkspaceEnv } from "@/modules/workspace";
import type { SpaceRootIssues } from "./spaceRoot";
import type { SpaceMeta } from "./store";

export function findActiveSpace(
  spaces: SpaceMeta[],
  activeId: string | null,
): SpaceMeta | null {
  if (activeId) {
    const found = spaces.find((s) => s.id === activeId);
    if (found) return found;
  }
  return spaces[0] ?? null;
}

export function usableActiveSpaceRoot(
  activeSpace: SpaceMeta | null,
  issues: SpaceRootIssues,
): string | null {
  if (!activeSpace?.root?.trim() || issues[activeSpace.id]) return null;
  return activeSpace.root;
}

export function activeSpaceEnv(
  spaces: SpaceMeta[],
  activeId: string | null,
): WorkspaceEnv {
  return findActiveSpace(spaces, activeId)?.env ?? { kind: "local" };
}
