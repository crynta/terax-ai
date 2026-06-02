import type { TabBehavior } from "@/modules/settings/store";
import type { Tab } from "./useTabs";

/**
 * Appends `tab` to the strip, or — when the user's `tabBehavior` preference is
 * "afterCurrent" — inserts it immediately after the currently active tab.
 * Falls back to appending if the active id isn't found. Pure: callers pass the
 * active id and behavior so this stays usable inside `setTabs` updaters.
 */
export function placeTab(
  curr: Tab[],
  tab: Tab,
  activeId: number,
  behavior: TabBehavior,
): Tab[] {
  if (behavior === "afterCurrent") {
    const idx = curr.findIndex((t) => t.id === activeId);
    if (idx >= 0) {
      return [...curr.slice(0, idx + 1), tab, ...curr.slice(idx + 1)];
    }
  }
  return [...curr, tab];
}
