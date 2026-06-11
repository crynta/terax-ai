import type { WorkflowDocument } from "./schema";

/**
 * Toggle a group node's collapsed state.
 * When collapsed, child nodes are hidden from the canvas.
 */
export function toggleGroupCollapse(
  document: WorkflowDocument,
  groupId: string,
): WorkflowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== groupId || node.type !== "group") return node;
      const isCollapsed = node.config.collapsed === true;
      return {
        ...node,
        config: { ...node.config, collapsed: !isCollapsed },
        size: isCollapsed
          ? { width: 400, height: 300 }
          : { width: 240, height: 80 },
      };
    }),
  };
}

/**
 * Get IDs of nodes hidden by collapsed groups.
 */
export function collapsedGroupChildIds(
  document: WorkflowDocument,
): Set<string> {
  const hidden = new Set<string>();
  for (const node of document.nodes) {
    if (node.type === "group" && node.config.collapsed === true) {
      const childIds = node.uiState.childNodeIds as string[] | undefined;
      if (childIds) {
        for (const id of childIds) hidden.add(id);
      }
    }
  }
  return hidden;
}

/**
 * Filter a document's elements for canvas rendering,
 * hiding nodes inside collapsed groups.
 */
export function documentVisibleNodes(
  document: WorkflowDocument,
): WorkflowDocument["nodes"] {
  const hidden = collapsedGroupChildIds(document);
  if (hidden.size === 0) return document.nodes;
  return document.nodes.filter((n) => !hidden.has(n.id));
}

/**
 * Filter edges that connect to hidden nodes.
 */
export function documentVisibleEdges(
  document: WorkflowDocument,
): WorkflowDocument["edges"] {
  const hidden = collapsedGroupChildIds(document);
  if (hidden.size === 0) return document.edges;
  return document.edges.filter(
    (e) => !hidden.has(e.sourceNodeId) && !hidden.has(e.targetNodeId),
  );
}
