export const SIDEBAR_POSITIONS = ["left", "right"] as const;

export type SidebarPosition = (typeof SIDEBAR_POSITIONS)[number];

export function normalizeSidebarPosition(value: unknown): SidebarPosition {
  return value === "right" ? "right" : "left";
}

export function tooltipSideForSidebar(
  position: SidebarPosition,
): "left" | "right" {
  return position === "right" ? "left" : "right";
}
