import type { PaneNode } from "@/modules/terminal/lib/panes";
import {
  SESSION_SCHEMA_VERSION,
  type SerializedPaneNode,
  type SerializedTab,
  type SessionV1,
} from "./sessionSchema";
import type { EditorTab, MarkdownTab, Tab, TerminalTab } from "./useTabs";

export interface RestoredInitial {
  tabs: Tab[];
  activeId: number;
  /** Next free id; assign to nextIdRef.current after restore. */
  nextId: number;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function isSessionV1(input: unknown): input is SessionV1 {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  if (o.version !== SESSION_SCHEMA_VERSION) return false;
  if (typeof o.updatedAt !== "number") return false;
  if (o.activeTabId !== null && typeof o.activeTabId !== "number") return false;
  if (!Array.isArray(o.tabs)) return false;
  return true;
}

function firstLeafId(node: PaneNode): number {
  if (node.kind === "leaf") return node.id;
  for (const c of node.children) {
    const x = firstLeafId(c);
    if (x !== -1) return x;
  }
  return -1;
}

function remapPaneNode(
  node: SerializedPaneNode,
  alloc: () => number,
  leafMap: Map<number, number>,
): PaneNode {
  if (node.kind === "leaf") {
    const newId = alloc();
    leafMap.set(node.id, newId);
    const leaf: PaneNode = { kind: "leaf", id: newId };
    if (node.cwd !== null && node.cwd !== undefined) leaf.cwd = node.cwd;
    // Display-only scrollback; optional + backward-compatible (old saves omit
    // it). Carried onto the live leaf so the pane repaints it once on mount.
    if (typeof node.snapshot === "string" && node.snapshot.length > 0) {
      leaf.snapshot = node.snapshot;
    }
    return leaf;
  }
  const split: PaneNode = {
    kind: "split",
    id: alloc(),
    dir: node.dir,
    children: node.children.map((c) => remapPaneNode(c, alloc, leafMap)),
  };
  // Only carry sizes through if they match children.length — defensive guard
  // against malformed saves that survive the shape check (e.g. someone
  // hand-edits the JSON and trims children but leaves sizes).
  if (
    node.sizes &&
    Array.isArray(node.sizes) &&
    node.sizes.length === node.children.length
  ) {
    split.sizes = node.sizes;
  }
  return split;
}

function restoreTab(
  s: SerializedTab,
  alloc: () => number,
  tabMap: Map<number, number>,
): Tab {
  const newId = alloc();
  tabMap.set(s.id, newId);
  if (s.kind === "terminal") {
    const leafMap = new Map<number, number>();
    const paneTree = remapPaneNode(s.paneTree, alloc, leafMap);
    const activeLeafId = leafMap.get(s.activeLeafId);
    const tab: TerminalTab = {
      id: newId,
      kind: "terminal",
      title: s.title,
      paneTree,
      activeLeafId:
        activeLeafId ??
        (paneTree.kind === "leaf" ? paneTree.id : firstLeafId(paneTree)),
    };
    if (s.cwd) tab.cwd = s.cwd;
    if (s.private) tab.private = true;
    return tab;
  }
  if (s.kind === "editor") {
    const tab: EditorTab = {
      id: newId,
      kind: "editor",
      title: basename(s.path),
      path: s.path,
      dirty: false,
      preview: false,
    };
    return tab;
  }
  const tab: MarkdownTab = {
    id: newId,
    kind: "markdown",
    title: basename(s.path),
    path: s.path,
  };
  return tab;
}

export function deserializeSession(
  input: unknown,
  startId: number,
): RestoredInitial | null {
  if (!isSessionV1(input)) return null;

  let next = startId;
  const alloc = () => next++;
  const tabMap = new Map<number, number>();
  const tabs: Tab[] = [];
  for (const s of input.tabs) {
    try {
      tabs.push(restoreTab(s, alloc, tabMap));
    } catch (e) {
      console.warn("[session] skipping malformed tab", e);
    }
  }
  const activeId =
    input.activeTabId !== null && tabMap.has(input.activeTabId)
      ? tabMap.get(input.activeTabId)!
      : (tabs[0]?.id ?? 0);

  return { tabs, activeId, nextId: next };
}
