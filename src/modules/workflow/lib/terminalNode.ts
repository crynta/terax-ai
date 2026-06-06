import type { WorkflowDocument, WorkflowNode } from "./schema";

const WORKFLOW_TERMINAL_LEAF_OFFSET = 1_000_000;
const WORKFLOW_TERMINAL_LEAF_SPAN = 900_000_000;

export function workflowTerminalLeafId(
  workflowId: string,
  nodeId: string,
): number {
  const key = `${workflowId}:${nodeId}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (
    WORKFLOW_TERMINAL_LEAF_OFFSET + ((hash >>> 0) % WORKFLOW_TERMINAL_LEAF_SPAN)
  );
}

export function workflowTerminalLeafIds(document: WorkflowDocument): number[] {
  return document.nodes
    .filter((node) => node.type === "terminal")
    .map((node) => workflowTerminalLeafId(document.id, node.id));
}

export function shouldMountTerminalSurface(
  node: WorkflowNode,
  visible: boolean,
): boolean {
  return node.type === "terminal" && visible && node.uiState.expanded === true;
}
