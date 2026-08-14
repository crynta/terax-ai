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
