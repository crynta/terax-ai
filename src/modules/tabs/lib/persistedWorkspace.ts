import type { PaneNode } from "@/modules/terminal/lib/panes";
import { leafIds } from "@/modules/terminal/lib/panes";
import { LazyStore } from "@tauri-apps/plugin-store";

export type PersistedTerminalTab = {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
};

export type PersistedWorkspace = {
  version: 1;
  activeId: number | null;
  nextId: number;
  tabs: PersistedTerminalTab[];
};

const STORE_PATH = "terax-workspace.json";
const KEY_WORKSPACE = "terminalWorkspace";
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadPersistedWorkspace(): Promise<PersistedWorkspace | null> {
  return normalizeWorkspace(await store.get<unknown>(KEY_WORKSPACE));
}

export async function savePersistedWorkspace(
  workspace: PersistedWorkspace | null,
): Promise<void> {
  if (!workspace || workspace.tabs.length === 0) {
    await store.delete(KEY_WORKSPACE);
    return;
  }
  await store.set(KEY_WORKSPACE, workspace);
}

function normalizeWorkspace(value: unknown): PersistedWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  const nextId = asInt(raw.nextId);
  if (nextId === null) return null;
  if (!Array.isArray(raw.tabs)) return null;

  const tabs = raw.tabs
    .map(normalizeTerminalTab)
    .filter((tab): tab is PersistedTerminalTab => tab !== null);
  if (tabs.length === 0) return null;

  const activeId = asInt(raw.activeId);
  const resolvedActiveId = tabs.some((tab) => tab.id === activeId)
    ? activeId
    : tabs[0].id;

  return {
    version: 1,
    activeId: resolvedActiveId,
    nextId: Math.max(nextId, maxNodeId(tabs) + 1),
    tabs,
  };
}

function normalizeTerminalTab(value: unknown): PersistedTerminalTab | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "terminal") return null;

  const id = asInt(raw.id);
  const paneTree = normalizePaneNode(raw.paneTree);
  if (id === null || paneTree === null) return null;

  const leaves = leafIds(paneTree);
  if (leaves.length === 0) return null;

  const activeLeafId = asInt(raw.activeLeafId);
  return {
    id,
    kind: "terminal",
    title: typeof raw.title === "string" && raw.title.length > 0 ? raw.title : "shell",
    ...(typeof raw.cwd === "string" && raw.cwd.length > 0 ? { cwd: raw.cwd } : {}),
    paneTree,
    activeLeafId:
      activeLeafId !== null && leaves.includes(activeLeafId)
        ? activeLeafId
        : leaves[0],
  };
}

function normalizePaneNode(value: unknown): PaneNode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "leaf") {
    const id = asInt(raw.id);
    if (id === null) return null;
    return {
      kind: "leaf",
      id,
      ...(typeof raw.cwd === "string" && raw.cwd.length > 0 ? { cwd: raw.cwd } : {}),
    };
  }
  if (raw.kind === "split") {
    const id = asInt(raw.id);
    const dir = raw.dir;
    if (id === null || (dir !== "row" && dir !== "col")) return null;
    if (!Array.isArray(raw.children)) return null;
    const children = raw.children
      .map(normalizePaneNode)
      .filter((child): child is PaneNode => child !== null);
    if (children.length < 2) return null;
    return {
      kind: "split",
      id,
      dir,
      children,
    };
  }
  return null;
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function maxNodeId(tabs: PersistedTerminalTab[]): number {
  let maxId = 0;
  for (const tab of tabs) {
    maxId = Math.max(maxId, tab.id, ...leafIds(tab.paneTree));
    if (tab.paneTree.kind === "split") {
      maxId = Math.max(maxId, maxSplitId(tab.paneTree));
    }
  }
  return maxId;
}

function maxSplitId(node: PaneNode): number {
  if (node.kind === "leaf") return node.id;
  return Math.max(node.id, ...node.children.map(maxSplitId));
}
