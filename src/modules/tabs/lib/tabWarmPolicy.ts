import type { SpaceRootIssues } from "@/modules/spaces/lib/spaceRoot";
import { findLeafCwd, setLeafCwd } from "@/modules/terminal/lib/panes";
import type { Tab } from "./useTabs";

export type SpaceRoots = Readonly<Record<string, string | null | undefined>>;

export function canWarmTab(tab: Tab, rootIssues: SpaceRootIssues): boolean {
  return tab.kind !== "terminal" || !rootIssues[tab.spaceId];
}

export function warmColdTab(
  tab: Tab,
  rootIssues: SpaceRootIssues,
  spaceRoots: SpaceRoots,
): Tab {
  if (!tab.cold || !canWarmTab(tab, rootIssues)) return tab;
  if (tab.kind !== "terminal") return { ...tab, cold: false };

  const existingCwd = tab.cwd ?? findLeafCwd(tab.paneTree, tab.activeLeafId);
  if (existingCwd) return { ...tab, cold: false };

  const root = spaceRoots[tab.spaceId];
  if (!root) return tab;
  return {
    ...tab,
    cold: false,
    cwd: root,
    paneTree: setLeafCwd(tab.paneTree, tab.activeLeafId, root),
  };
}
