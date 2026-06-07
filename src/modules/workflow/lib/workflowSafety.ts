import type { WorkflowNode } from "./schema";

export function isUnsafeWorkflowNode(node: WorkflowNode): boolean {
  return (
    node.type === "shellCommand" ||
    node.type === "agent" ||
    node.type === "fileOperation" ||
    node.type === "browserAutomation"
  );
}
