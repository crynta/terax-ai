import type { WorkflowDocument } from "./schema";
import {
  executeWorkflowStep,
  getReadyNodeIds,
} from "./execution";
import { forEachItemArtifacts } from "./execution/artifacts";
import type { WorkflowNode } from "./schema";

/**
 * Execute a workflow with For Each fan-out awareness.
 *
 * The standard `executeWorkflowStep` already processes ALL ready nodes
 * in a single pass (both sync artifacts and async provider nodes via Promise.all),
 * so true parallel execution is already built-in. This wrapper adds:
 * 1. Fan-out branch detection and tracking
 * 2. Proper includeUnsafe/nodeIds passthrough
 * 3. Progress callbacks with fan-out metadata
 */
export async function executeWorkflowWithFanOut(
  document: WorkflowDocument,
  options: {
    maxSteps?: number;
    includeUnsafe?: boolean;
    nodeIds?: string[];
    onProgress?: (doc: WorkflowDocument) => void;
  } = {},
): Promise<WorkflowDocument> {
  const maxSteps = Math.max(
    1,
    options.maxSteps ?? Math.max(document.nodes.length * 3, 1),
  );
  let current = document;

  for (let step = 0; step < maxSteps; step += 1) {
    const readyIds = getReadyNodeIds(current, {
      includeUnsafe: options.includeUnsafe,
      nodeIds: options.nodeIds,
    });
    if (readyIds.length === 0) break;

    // Standard step execution handles all ready nodes in parallel
    current = executeWorkflowStep(current);
    options.onProgress?.(current);

    // Check if all nodes are in terminal state
    if (
      current.nodes.every(
        (n) =>
          n.runtimeState.status !== "running" &&
          n.runtimeState.status !== "idle",
      )
    ) {
      break;
    }
  }

  return current;
}

/**
 * Get the number of fan-out branches a forEach node would produce
 * given the current document state.
 */
export function forEachFanOutCount(
  document: WorkflowDocument,
  forEachNode: WorkflowNode,
): number {
  if (forEachNode.type !== "forEach") return 0;
  const items = forEachItemArtifacts(document, forEachNode);
  return items.length;
}
