import { findLeafCwd, leafIds } from "@/modules/terminal/lib/panes";
import type { Tab, TerminalTab } from "./useTabs";

export const PANE_LABEL_SEPARATOR = " | ";

export type PaneLabel = { leafId: number; name: string; active: boolean };

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/** One name per pane of a terminal tab, in tree order. */
export function paneLabels(t: TerminalTab): PaneLabel[] {
  return leafIds(t.paneTree).map((leafId) => {
    const active = leafId === t.activeLeafId;
    const cwd = findLeafCwd(t.paneTree, leafId) ?? (active ? t.cwd : undefined);
    return { leafId, name: cwd ? lastSegment(cwd) : t.title, active };
  });
}

/** Per-pane names when a split terminal tab shows them all; null otherwise. */
export function splitPaneLabels(t: Tab): PaneLabel[] | null {
  if (t.kind !== "terminal" || t.customTitle) return null;
  if (t.paneTree.kind === "leaf") return null;
  const labels = paneLabels(t);
  return labels.length > 1 ? labels : null;
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then list every pane's cwd name for a
 * split, then fall back to the last segment of the cwd. Keeping this pure makes
 * the "custom name survives a cd" invariant testable without rendering the bar.
 */
export function labelFor(t: Tab): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.customTitle) return t.customTitle;
  const split = splitPaneLabels(t);
  if (split) return split.map((p) => p.name).join(PANE_LABEL_SEPARATOR);
  if (!t.cwd) return t.title;
  return lastSegment(t.cwd);
}
