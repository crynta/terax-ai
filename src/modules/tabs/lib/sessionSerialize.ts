import type { PaneNode } from "@/modules/terminal/lib/panes";
import {
  SESSION_SCHEMA_VERSION,
  type SerializedPaneNode,
  type SerializedTab,
  type SessionV1,
} from "./sessionSchema";
import type { Tab } from "./useTabs";

function serializePaneNode(node: PaneNode): SerializedPaneNode {
  if (node.kind === "leaf") {
    return { kind: "leaf", id: node.id, cwd: node.cwd ?? null };
  }
  const out: SerializedPaneNode = {
    kind: "split",
    id: node.id,
    dir: node.dir,
    children: node.children.map(serializePaneNode),
  };
  if (node.sizes) out.sizes = node.sizes;
  return out;
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (tab.kind === "terminal") {
    const serialized: SerializedTab = {
      kind: "terminal",
      id: tab.id,
      title: tab.title,
      cwd: tab.cwd ?? null,
      paneTree: serializePaneNode(tab.paneTree),
      activeLeafId: tab.activeLeafId,
    };
    if (tab.private) serialized.private = true;
    return serialized;
  }
  if (tab.kind === "editor") {
    if (tab.preview) return null; // preview = ephemeral, don't restore
    return { kind: "editor", id: tab.id, path: tab.path };
  }
  if (tab.kind === "markdown") {
    return { kind: "markdown", id: tab.id, path: tab.path };
  }
  // ai-diff, git-diff, git-history, git-commit-file, preview: dropped.
  return null;
}

export function serializeSession(tabs: Tab[], activeId: number): SessionV1 {
  const serialized: SerializedTab[] = [];
  for (const tab of tabs) {
    const out = serializeTab(tab);
    if (out !== null) serialized.push(out);
  }
  return {
    version: SESSION_SCHEMA_VERSION,
    updatedAt: Date.now(),
    activeTabId: tabs.length > 0 ? activeId : null,
    tabs: serialized,
  };
}
