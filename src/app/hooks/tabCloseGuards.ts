import type { CloseTabsPlan } from "@/modules/tabs";

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
