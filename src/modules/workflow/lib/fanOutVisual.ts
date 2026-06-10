import type { WorkflowDocument, WorkflowNode } from "../lib/schema";

/**
 * Fan-out visual state for a forEach node.
 * Tracks which branches are active, pending, or completed.
 */
export function fanOutVisualState(
  document: WorkflowDocument,
  forEachNode: WorkflowNode,
): FanOutBranchVisual[] {
  if (forEachNode.type !== "forEach") return [];

  const branches: FanOutBranchVisual[] = [];

  // Get downstream nodes connected to each item port
  const itemEdges = document.edges.filter(
    (e) =>
      e.sourceNodeId === forEachNode.id &&
      e.sourcePortId?.startsWith("item_"),
  );

  for (const edge of itemEdges) {
    const targetNode = document.nodes.find((n) => n.id === edge.targetNodeId);
    if (!targetNode) continue;

    const itemIndex = parseInt(edge.sourcePortId!.replace("item_", ""), 10);
    if (Number.isNaN(itemIndex)) continue;

    const status = targetNode.runtimeState.status;

    branches.push({
      portId: edge.sourcePortId!,
      itemIndex,
      targetNodeId: targetNode.id,
      targetNodeTitle: targetNode.title,
      status,
    });
  }

  // Add pending branches for items without connections
  const maxItemPort = branches.reduce(
    (max, b) => Math.max(max, b.itemIndex),
    -1,
  );
  for (let i = 0; i <= maxItemPort; i++) {
    if (!branches.find((b) => b.itemIndex === i)) {
      branches.push({
        portId: `item_${i}`,
        itemIndex: i,
        targetNodeId: "",
        targetNodeTitle: "",
        status: "idle",
      });
    }
  }

  return branches.sort((a, b) => a.itemIndex - b.itemIndex);
}

import type { WorkflowRuntimeStatus } from "./schema";

export interface FanOutBranchVisual {
  portId: string;
  itemIndex: number;
  targetNodeId: string;
  targetNodeTitle: string;
  status: WorkflowRuntimeStatus;
}

/**
 * Count running fan-out branches.
 */
export function runningFanOutBranches(
  branches: FanOutBranchVisual[],
): number {
  return branches.filter((b) => b.status === "running").length;
}

/**
 * Check if fan-out is in progress (at least one branch running or pending).
 */
export function isFanOutInProgress(branches: FanOutBranchVisual[]): boolean {
  return branches.some(
    (b) => b.status === "running" || b.status === "idle",
  );
}
