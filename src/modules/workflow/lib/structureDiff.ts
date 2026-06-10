import type {
  WorkflowDocument,
  WorkflowNode,
  WorkflowEdge,
} from "./schema";

export type WorkflowStructureDiff = {
  addedNodes: WorkflowNode[];
  removedNodes: WorkflowNode[];
  modifiedNodes: WorkflowNodeDiff[];
  addedEdges: WorkflowEdge[];
  removedEdges: WorkflowEdge[];
  unchangedNodes: number;
  unchangedEdges: number;
};

export type WorkflowNodeDiff = {
  nodeId: string;
  title: string;
  nodeType: string;
  changes: WorkflowNodeChange[];
};

export type WorkflowNodeChange = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

/**
 * Compare two workflow documents and produce a structural diff.
 */
export function diffWorkflowDocuments(
  left: WorkflowDocument,
  right: WorkflowDocument,
): WorkflowStructureDiff {
  const leftNodes = new Map(left.nodes.map((n) => [n.id, n]));
  const rightNodes = new Map(right.nodes.map((n) => [n.id, n]));
  const leftEdges = new Map(left.edges.map((e) => [e.id, e]));
  const rightEdges = new Map(right.edges.map((e) => [e.id, e]));

  const allNodeIds = new Set([...leftNodes.keys(), ...rightNodes.keys()]);
  const addedNodes: WorkflowNode[] = [];
  const removedNodes: WorkflowNode[] = [];
  const modifiedNodes: WorkflowNodeDiff[] = [];
  let unchangedNodes = 0;

  for (const nodeId of allNodeIds) {
    const leftNode = leftNodes.get(nodeId);
    const rightNode = rightNodes.get(nodeId);

    if (!leftNode && rightNode) {
      addedNodes.push(rightNode);
      continue;
    }
    if (leftNode && !rightNode) {
      removedNodes.push(leftNode);
      continue;
    }
    if (!leftNode || !rightNode) continue;

    const changes = diffNodeFields(leftNode, rightNode);
    if (changes.length === 0) {
      unchangedNodes++;
    } else {
      modifiedNodes.push({
        nodeId,
        title: rightNode.title,
        nodeType: rightNode.type,
        changes,
      });
    }
  }

  const allEdgeIds = new Set([...leftEdges.keys(), ...rightEdges.keys()]);
  const addedEdges: WorkflowEdge[] = [];
  const removedEdges: WorkflowEdge[] = [];
  let unchangedEdges = 0;

  for (const edgeId of allEdgeIds) {
    const leftEdge = leftEdges.get(edgeId);
    const rightEdge = rightEdges.get(edgeId);

    if (!leftEdge && rightEdge) {
      addedEdges.push(rightEdge);
    } else if (leftEdge && !rightEdge) {
      removedEdges.push(leftEdge);
    } else {
      unchangedEdges++;
    }
  }

  return {
    addedNodes,
    removedNodes,
    modifiedNodes,
    addedEdges,
    removedEdges,
    unchangedNodes,
    unchangedEdges,
  };
}

function diffNodeFields(
  left: WorkflowNode,
  right: WorkflowNode,
): WorkflowNodeChange[] {
  const changes: WorkflowNodeChange[] = [];

  if (left.title !== right.title) {
    changes.push({ field: "title", oldValue: left.title, newValue: right.title });
  }
  if (left.type !== right.type) {
    changes.push({ field: "type", oldValue: left.type, newValue: right.type });
  }

  // Config changes
  const leftConfig = left.config as Record<string, unknown>;
  const rightConfig = right.config as Record<string, unknown>;
  const allKeys = new Set([
    ...Object.keys(leftConfig),
    ...Object.keys(rightConfig),
  ]);
  for (const key of allKeys) {
    const lv = leftConfig[key];
    const rv = rightConfig[key];
    if (JSON.stringify(lv) !== JSON.stringify(rv)) {
      changes.push({ field: `config.${key}`, oldValue: lv, newValue: rv });
    }
  }

  // Position changes
  if (
    left.position.x !== right.position.x ||
    left.position.y !== right.position.y
  ) {
    changes.push({
      field: "position",
      oldValue: `${left.position.x},${left.position.y}`,
      newValue: `${right.position.x},${right.position.y}`,
    });
  }

  return changes;
}

/**
 * Summarize a structural diff for display.
 */
export function summarizeStructureDiff(diff: WorkflowStructureDiff): string {
  const parts: string[] = [];
  if (diff.addedNodes.length > 0) parts.push(`+${diff.addedNodes.length} nodes`);
  if (diff.removedNodes.length > 0) parts.push(`-${diff.removedNodes.length} nodes`);
  if (diff.modifiedNodes.length > 0) parts.push(`~${diff.modifiedNodes.length} modified`);
  if (diff.addedEdges.length > 0) parts.push(`+${diff.addedEdges.length} edges`);
  if (diff.removedEdges.length > 0) parts.push(`-${diff.removedEdges.length} edges`);
  if (parts.length === 0) return "No changes";
  return parts.join(" · ");
}
