import dagre from "dagre";
import type { WorkflowDocument, WorkflowNode } from "./schema";

export type AutoLayoutOptions = {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  padding?: number;
  rankSep?: number;
};

const DEFAULT_OPTIONS: AutoLayoutOptions = {
  direction: "LR",
  nodeWidth: 280,
  nodeHeight: 170,
  padding: 40,
  rankSep: 120,
};

export function autoLayoutWorkflow(
  document: WorkflowDocument,
  options: AutoLayoutOptions = {},
): WorkflowDocument {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: opts.direction,
    nodesep: opts.padding,
    ranksep: opts.rankSep,
    marginx: opts.padding,
    marginy: opts.padding,
  });

  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of document.nodes) {
    nodeMap.set(node.id, node);
    g.setNode(node.id, {
      width: node.size.width ?? opts.nodeWidth!,
      height: node.size.height ?? opts.nodeHeight!,
    });
  }

  for (const edge of document.edges) {
    if (nodeMap.has(edge.sourceNodeId) && nodeMap.has(edge.targetNodeId)) {
      g.setEdge(edge.sourceNodeId, edge.targetNodeId);
    }
  }

  dagre.layout(g);

  const layoutNodes = document.nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    const n = g.node(node.id);
    return {
      ...node,
      position: {
        x: n.x - (node.size.width ?? opts.nodeWidth!) / 2,
        y: n.y - (node.size.height ?? opts.nodeHeight!) / 2,
      },
    };
  });

  return { ...document, nodes: layoutNodes };
}
