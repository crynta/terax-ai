import { labelFor } from "@/modules/tabs/lib/tabLabel";
import type { Tab } from "@/modules/tabs";
import { findLeafCwd, leafIds } from "@/modules/terminal/lib/panes";

export type TerminalLeafSnapshot = {
  leafId: number;
  cwd: string | null;
  active: boolean;
};

export type TerminalTabSnapshot = {
  tabId: number;
  title: string;
  label: string;
  cwd: string | null;
  active: boolean;
  private: boolean;
  activeLeafId: number | null;
  leafIds: number[];
  leaves: TerminalLeafSnapshot[];
};

export type TerminalInventory = {
  activeTabId: number | null;
  activeTerminalTabId: number | null;
  activeTerminalLeafId: number | null;
  tabs: TerminalTabSnapshot[];
};

export type TerminalTarget = {
  tab: TerminalTabSnapshot;
  leafId: number;
};

export function buildTerminalInventory(
  tabs: Tab[],
  activeId: number,
): TerminalInventory {
  const terminalTabs = tabs.filter((t): t is Extract<Tab, { kind: "terminal" }> =>
    t.kind === "terminal",
  );

  const activeTerminal = terminalTabs.find((t) => t.id === activeId) ?? null;
  return {
    activeTabId: activeId,
    activeTerminalTabId: activeTerminal?.id ?? null,
    activeTerminalLeafId: activeTerminal?.private
      ? null
      : activeTerminal?.activeLeafId ?? null,
    tabs: terminalTabs.map((t) => {
      const leafs = leafIds(t.paneTree);
      const activeLeafId = t.private ? null : t.activeLeafId;
      const activeLeafCwd = activeLeafId
        ? findLeafCwd(t.paneTree, activeLeafId) ?? null
        : null;
      return {
        tabId: t.id,
        title: t.title,
        label: labelFor(t),
        cwd: t.private ? null : activeLeafCwd ?? t.cwd ?? null,
        active: t.id === activeId,
        private: t.private === true,
        activeLeafId,
        leafIds: t.private ? [] : leafs,
        leaves: t.private
          ? []
          : leafs.map((leafId) => ({
              leafId,
              cwd: findLeafCwd(t.paneTree, leafId) ?? null,
              active: leafId === t.activeLeafId,
            })),
      };
    }),
  };
}

export function redactTerminalInventory(
  inventory: TerminalInventory,
): TerminalInventory {
  return {
    ...inventory,
    tabs: inventory.tabs.map((tab) =>
      tab.private
        ? {
            ...tab,
            cwd: null,
            activeLeafId: null,
            leafIds: [],
            leaves: [],
          }
        : tab,
    ),
  };
}

export function resolveTerminalTarget(
  inventory: TerminalInventory,
  input: { tabId?: number | null; leafId?: number | null },
): { ok: true; target: TerminalTarget } | { ok: false; error: string } {
  const { tabId, leafId } = input;

  if (leafId != null) {
    for (const tab of inventory.tabs) {
      if (tab.private) continue;
      const idx = tab.leafIds.indexOf(leafId);
      if (idx >= 0) {
        if (tabId != null && tab.tabId !== tabId) {
          return {
            ok: false,
            error: `leaf ${leafId} does not belong to terminal tab ${tabId}`,
          };
        }
        return {
          ok: true,
          target: { tab, leafId },
        };
      }
    }
    return { ok: false, error: `unknown terminal leaf ${leafId}` };
  }

  if (tabId == null) {
    if (inventory.activeTerminalTabId == null || inventory.activeTerminalLeafId == null) {
      return { ok: false, error: "no active terminal tab" };
    }
    const tab = inventory.tabs.find((t) => t.tabId === inventory.activeTerminalTabId);
    if (!tab) return { ok: false, error: "no active terminal tab" };
    return { ok: true, target: { tab, leafId: inventory.activeTerminalLeafId } };
  }

  const tab = inventory.tabs.find((t) => t.tabId === tabId);
  if (!tab) return { ok: false, error: `unknown terminal tab ${tabId}` };
  if (tab.private) {
    return {
      ok: false,
      error: `terminal tab ${tabId} is in Privacy mode; its buffer is withheld`,
    };
  }
  const targetLeafId = tab.activeLeafId ?? tab.leafIds[0] ?? null;
  if (targetLeafId == null) {
    return { ok: false, error: `terminal tab ${tabId} has no visible leaves` };
  }
  return { ok: true, target: { tab, leafId: targetLeafId } };
}
