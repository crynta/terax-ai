import type { SidebarSlotId } from "./layout";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

export const SIDEBAR_STORAGE_KEYS = {
  primaryWidth: "terax.sidebar.width",
  primaryView: "terax.sidebar.view",
  secondaryWidth: "terax.secondarySidebar.width",
  secondaryView: "terax.secondarySidebar.view",
  secondaryVisible: "terax.secondarySidebar.visible",
} as const;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function widthKeyForSlot(slot: SidebarSlotId): string {
  return slot === "primary"
    ? SIDEBAR_STORAGE_KEYS.primaryWidth
    : SIDEBAR_STORAGE_KEYS.secondaryWidth;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export function readStoredSidebarWidth(
  storage: StorageLike,
  slot: SidebarSlotId,
): number {
  try {
    const stored = storage.getItem(widthKeyForSlot(slot));
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function writeStoredSidebarWidth(
  storage: StorageLike,
  slot: SidebarSlotId,
  width: number,
): void {
  storage.setItem(widthKeyForSlot(slot), String(clampSidebarWidth(width)));
}
