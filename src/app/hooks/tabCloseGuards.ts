import type { CloseTabsPlan, Tab } from "@/modules/tabs";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function pathAtOrUnder(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

export function renamedPath(
  path: string,
  from: string,
  to: string,
): string | null {
  const normalizedPath = normalizePath(path);
  const normalizedFrom = normalizePath(from);
  if (!pathAtOrUnder(normalizedPath, normalizedFrom)) return null;
  return `${normalizePath(to)}${normalizedPath.slice(normalizedFrom.length)}`;
}

export function hasOpenPathTab(tabs: readonly Tab[], path: string): boolean {
  return tabs.some(
    (tab) =>
      (tab.kind === "editor" || tab.kind === "markdown") &&
      pathAtOrUnder(tab.path, path),
  );
}

export type CloseManyKind = "right" | "other";

export type CloseManyHazards = {
  dirtyIds: number[];
  busyLeafIds: number[];
};

export type CloseManyPending = CloseManyHazards & {
  kind: CloseManyKind;
  anchorId: number;
  plan: CloseTabsPlan;
};

export function hasCloseManyHazards(hazards: CloseManyHazards): boolean {
  return hazards.dirtyIds.length > 0 || hazards.busyLeafIds.length > 0;
}

export function hasNewCloseManyHazards(
  acknowledged: CloseManyHazards,
  current: CloseManyHazards,
): boolean {
  const dirty = new Set(acknowledged.dirtyIds);
  if (current.dirtyIds.some((id) => !dirty.has(id))) return true;
  const busy = new Set(acknowledged.busyLeafIds);
  return current.busyLeafIds.some((id) => !busy.has(id));
}

export type CloseHazardSnapshot = {
  dirtyIds: number[];
  leafIds: number[];
};

export function deletedPathTabs(
  tabs: readonly Tab[],
  paths: readonly string[],
): { dirtyIds: number[]; cleanIds: number[] } {
  const dirtyIds: number[] = [];
  const cleanIds: number[] = [];
  for (const tab of tabs) {
    if (tab.kind !== "editor" && tab.kind !== "markdown") continue;
    if (!paths.some((path) => pathAtOrUnder(tab.path, path))) continue;
    (tab.kind === "editor" && tab.dirty ? dirtyIds : cleanIds).push(tab.id);
  }
  return { dirtyIds, cleanIds };
}

export function spacesEmptiedByTabs(
  tabs: readonly Tab[],
  closeIds: readonly number[],
): string[] {
  const closing = new Set(closeIds);
  const spaces = new Set(
    tabs.filter((tab) => closing.has(tab.id)).map((tab) => tab.spaceId),
  );
  return [...spaces].filter(
    (spaceId) =>
      !tabs.some((tab) => tab.spaceId === spaceId && !closing.has(tab.id)),
  );
}

const MAX_HAZARD_PASSES = 3;

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Busy detection costs one IPC per leaf, so opting out skips it outright rather
 * than running it and discarding the answer. Dirty editors are never gated:
 * killing a process is what the user asked for, losing a buffer is not.
 *
 * Leaves can appear or vanish while the checks are in flight, so re-snapshot
 * until the set is stable, then fall back to assuming every leaf is busy.
 */
export async function evaluateCloseHazards(
  capture: () => CloseHazardSnapshot,
  isBusy: (leafId: number) => Promise<boolean>,
  confirmRunningTerminal: boolean,
): Promise<CloseManyHazards> {
  if (!confirmRunningTerminal) {
    return { dirtyIds: capture().dirtyIds, busyLeafIds: [] };
  }
  let checkedLeafIds = capture().leafIds;
  for (let pass = 0; pass < MAX_HAZARD_PASSES; pass += 1) {
    const checks = await Promise.all(checkedLeafIds.map(isBusy));
    const latest = capture();
    if (sameIds(checkedLeafIds, latest.leafIds)) {
      return {
        dirtyIds: latest.dirtyIds,
        busyLeafIds: checkedLeafIds.filter((_, index) => checks[index]),
      };
    }
    checkedLeafIds = latest.leafIds;
  }
  const latest = capture();
  return { dirtyIds: latest.dirtyIds, busyLeafIds: latest.leafIds };
}
