import type { WorkflowDocument, WorkflowNode, WorkflowPort } from "./schema";
import { forEachItemCount } from "./execution/artifacts";

/**
 * Expand a For Each node's outputs to include per-item ports.
 * When the node is completed and has items, adds item_0, item_1, etc. ports.
 * When not completed, returns the original outputs.
 */
export function expandForEachOutputs(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowPort[] {
  if (node.type !== "forEach") return node.outputs;

  const count = forEachItemCount(document, node);
  if (count === 0) return node.outputs;

  const itemPorts: WorkflowPort[] = [];
  for (let i = 0; i < count; i++) {
    itemPorts.push({
      id: `item_${i}`,
      type: "text",
      label: `Item ${i + 1}`,
    });
  }

  // Keep original "item" port as combined output, then add per-item ports
  return [...node.outputs, ...itemPorts];
}

/**
 * Get expanded outputs for any node type.
 * Currently only forEach has dynamic expansion.
 */
export function expandedNodeOutputs(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowPort[] {
  return expandForEachOutputs(document, node);
}
