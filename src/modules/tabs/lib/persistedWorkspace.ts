import type { PaneNode } from "@/modules/terminal/lib/panes";
import { leafIds } from "@/modules/terminal/lib/panes";
import { LazyStore } from "@tauri-apps/plugin-store";

type PersistedTerminalTab = {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
};

type PersistedWorkspace = {
  version: 1;
  activeId: number | null;
  nextId: number;
  tabs: PersistedTerminalTab[];
};

const KEY_WORKSPACE = "terminalWorkspace";
const store = new LazyStore("terax-workspace.json", {
  defaults: {},
  autoSave: 200,
});

export async function loadPersistedWorkspace(): Promise<PersistedWorkspace | null> {
  const saved = await store.get<unknown>(KEY_WORKSPACE);
  if (!saved || typeof saved !== "object") return null;

  const raw = saved as Partial<PersistedWorkspace>;
  if (raw.version !== 1 || !Array.isArray(raw.tabs) || raw.tabs.length === 0) {
    return null;
  }

  const tabs = raw.tabs.flatMap((tab) => {
    try {
      if (!tab || typeof tab !== "object" || tab.kind !== "terminal") return [];
      const leaves = leafIds(tab.paneTree).filter(isPositiveInt);
      if (!isPositiveInt(tab.id) || leaves.length === 0) return [];
      const cwd = text(tab.cwd);
      return [
        {
          id: tab.id,
          kind: "terminal" as const,
          title: text(tab.title) ?? "shell",
          ...(cwd ? { cwd } : {}),
          paneTree: tab.paneTree,
          activeLeafId:
            isPositiveInt(tab.activeLeafId) && leaves.includes(tab.activeLeafId)
              ? tab.activeLeafId
              : leaves[0],
        },
      ];
    } catch {
      return [];
    }
  });

  if (tabs.length === 0) return null;

  const activeId =
    isPositiveInt(raw.activeId) && tabs.some((tab) => tab.id === raw.activeId)
      ? raw.activeId
      : tabs[0].id;

  return {
    version: 1,
    activeId,
    nextId:
      tabs.reduce(
        (max, tab) => Math.max(max, tab.id, ...leafIds(tab.paneTree)),
        0,
      ) + 1,
    tabs,
  };
}

export async function savePersistedWorkspace(
  workspace: Omit<PersistedWorkspace, "nextId"> | null,
): Promise<void> {
  await (
    workspace?.tabs.length
      ? store.set(KEY_WORKSPACE, workspace)
      : store.delete(KEY_WORKSPACE)
  );
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
