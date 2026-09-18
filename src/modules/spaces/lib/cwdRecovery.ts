import type { Tab } from "@/modules/tabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import type { SpaceMeta } from "./store";

/** Collect every terminal cwd that might be authorized / spawned on boot. */
export function uniqueCwds(tabs: Tab[]): string[] {
  const set = new Set<string>();
  const walk = (n: PaneNode) => {
    if (isLeaf(n)) {
      if (n.cwd) set.add(n.cwd);
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const t of tabs) {
    if (t.kind !== "terminal") continue;
    if (t.cwd) set.add(t.cwd);
    walk(t.paneTree);
  }
  return [...set];
}

/** Rewrite broken terminal cwds in place so hydration does not re-stick them. */
export function fixBrokenCwds(
  tabs: Tab[],
  broken: Set<string>,
  fallback: string | null,
): void {
  const fix = (node: PaneNode) => {
    if (isLeaf(node)) {
      if (node.cwd && broken.has(node.cwd)) node.cwd = fallback ?? undefined;
      return;
    }
    for (const child of node.children) fix(child);
  };

  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    fix(tab.paneTree);
    if (tab.cwd && broken.has(tab.cwd)) tab.cwd = fallback ?? undefined;
  }
}

/**
 * Replace space roots that failed authorization with the boot fallback.
 * Returns a new array when any root changed; otherwise the input array.
 */
export function fixBrokenSpaceRoots(
  spaces: SpaceMeta[],
  broken: Set<string>,
  fallback: string | null,
): SpaceMeta[] {
  let changed = false;
  const next = spaces.map((space) => {
    if (!space.root || !broken.has(space.root)) return space;
    changed = true;
    return { ...space, root: fallback, updatedAt: Date.now() };
  });
  return changed ? next : spaces;
}
