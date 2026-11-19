import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
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

export function activeSpaceEnv(
  spaces: SpaceMeta[],
  activeId: string | null,
): WorkspaceEnv {
  return findActiveSpace(spaces, activeId)?.env ?? { kind: "local" };
}

// A WSL space falls back to null, not the local cwd, so its first tab opens at
// the WSL home instead of a Windows path.
export function freshTabCwd(
  env: WorkspaceEnv,
  restoredHome: string | null,
  launchCwd: string | null,
  home: string | null,
): string | null {
  return restoredHome ?? (env.kind === "local" ? (launchCwd ?? home) : null);
}

/** Live tasks can move only where their sessions and paths keep the same meaning. */
export function canMoveBetweenProjects(
  spaces: readonly SpaceMeta[],
  fromId: string,
  toId: string,
): boolean {
  if (fromId === toId) return true;
  const from = spaces.find((p) => p.id === fromId)?.env;
  const to = spaces.find((p) => p.id === toId)?.env;
  return !!from && !!to && workspaceScopeKey(from) === workspaceScopeKey(to);
}
