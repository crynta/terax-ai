import type { WorkflowNode } from "./schema";
import { createWorkflowNode } from "./schema";

/**
 * Serialize a node for clipboard copy.
 */
export function serializeNodeForClipboard(node: WorkflowNode): string {
  return JSON.stringify({
    type: node.type,
    title: node.title,
    config: node.config,
    size: node.size,
    inputs: node.inputs,
    outputs: node.outputs,
  });
}

/**
 * Deserialize a node from clipboard.
 * Returns null if the data is not a valid node.
 */
export function deserializeNodeFromClipboard(
  data: string,
): Pick<WorkflowNode, "type" | "config" | "size"> | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || !parsed.type) return null;
    return {
      type: parsed.type,
      config: parsed.config ?? {},
      size: parsed.size ?? { width: 260, height: 150 },
    };
  } catch {
    return null;
  }
}

/**
 * Create a pasted node from clipboard data with a new ID and offset position.
 */
export function createPastedNode(
  clipboard: Pick<WorkflowNode, "type" | "config" | "size">,
  id: string,
  position: { x: number; y: number },
): WorkflowNode {
  const template = createWorkflowNode({
    id,
    type: clipboard.type,
    position,
  });
  return {
    ...template,
    config: { ...template.config, ...clipboard.config },
    position: { x: position.x + 30, y: position.y + 30 },
  };
}
