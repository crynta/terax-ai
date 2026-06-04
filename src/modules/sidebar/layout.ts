import type { SidebarPosition } from "./position";
import type { PrimarySidebarViewId, SecondarySidebarViewId } from "./types";

export type SidebarLayoutSlot =
  | "primary-sidebar"
  | "workspace"
  | "secondary-sidebar";

export type SidebarSlotId = "primary" | "secondary";

export type SidebarViewPair = {
  primary: PrimarySidebarViewId;
  secondary: SecondarySidebarViewId;
};

export type SidebarViewForSlot<T extends SidebarSlotId> = T extends "primary"
  ? PrimarySidebarViewId
  : SecondarySidebarViewId;

export function oppositeSidebarPosition(
  position: SidebarPosition,
): SidebarPosition {
  return position === "left" ? "right" : "left";
}

export function orderSidebarLayout(
  position: SidebarPosition,
): SidebarLayoutSlot[] {
  return position === "right"
    ? ["secondary-sidebar", "workspace", "primary-sidebar"]
    : ["primary-sidebar", "workspace", "secondary-sidebar"];
}

export function defaultSidebarVisibility(
  slot: SidebarSlotId,
  restored: boolean | null | undefined,
): boolean {
  return typeof restored === "boolean" ? restored : slot === "primary";
}

export function resolveSidebarViewSelection(
  current: SidebarViewPair,
  slot: "primary",
  view: PrimarySidebarViewId,
): SidebarViewPair;
export function resolveSidebarViewSelection(
  current: SidebarViewPair,
  slot: "secondary",
  view: SecondarySidebarViewId,
): SidebarViewPair;
export function resolveSidebarViewSelection(
  current: SidebarViewPair,
  slot: SidebarSlotId,
  view: PrimarySidebarViewId | SecondarySidebarViewId,
): SidebarViewPair {
  return { ...current, [slot]: view } as SidebarViewPair;
}
