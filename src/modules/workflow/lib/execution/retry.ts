import type { WorkflowArtifact, WorkflowDocument, WorkflowNode } from "../schema";

/**
 * Find the primary upstream source node for a retry node.
 */
export function retrySourceNode(
  document: WorkflowDocument,
  retryNode: WorkflowNode,
): WorkflowNode | null {
  const edge = document.edges.find((e) => e.targetNodeId === retryNode.id);
  if (!edge) return null;
  return document.nodes.find((n) => n.id === edge.sourceNodeId) ?? null;
}

/**
 * Reset a node to idle so it can be re-executed.
 */
export function resetNodeForRetry(
  document: WorkflowDocument,
  nodeId: string,
): WorkflowDocument {
  return {
    ...document,
    nodes: document.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, runtimeState: { status: "idle", attempt: (n.runtimeState.attempt ?? 0) + 1, logs: n.runtimeState.logs } }
        : n,
    ),
  };
}

/**
 * Check if a retry node should attempt re-execution of its source.
 * Returns true if the source node is in a failed state and attempts
 * haven't been exhausted.
 */
export function retryShouldReExecute(
  document: WorkflowDocument,
  node: WorkflowNode,
): boolean {
  if (node.type !== "retry") return false;
  const source = retrySourceNode(document, node);
  if (!source) return false;
  if (source.runtimeState.status !== "failed") return false;
  const maxAttempts = typeof node.config.maxAttempts === "number"
    ? node.config.maxAttempts
    : 3;
  const currentAttempt = source.runtimeState.attempt ?? 1;
  return currentAttempt < maxAttempts;
}

/**
 * Check if retry has exhausted all attempts.
 */
export function retryExhausted(
  document: WorkflowDocument,
  node: WorkflowNode,
): boolean {
  if (node.type !== "retry") return false;
  const source = retrySourceNode(document, node);
  if (!source) return true;
  if (source.runtimeState.status !== "failed") return false;
  const maxAttempts = typeof node.config.maxAttempts === "number"
    ? node.config.maxAttempts
    : 3;
  const currentAttempt = source.runtimeState.attempt ?? 1;
  return currentAttempt >= maxAttempts;
}

/**
 * Produce the error artifact for an exhausted retry node.
 */
export function retryErrorArtifact(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact {
  const source = retrySourceNode(document, node);
  const errorMessage = source?.runtimeState.message ?? "All retry attempts failed";
  const maxAttempts = typeof node.config.maxAttempts === "number"
    ? node.config.maxAttempts
    : 3;
  const attempt = source?.runtimeState.attempt ?? maxAttempts;
  return {
    id: `retry-error-${node.id}`,
    nodeId: node.id,
    portId: "error",
    type: "text",
    label: `${node.title} Error`,
    preview: `Failed after ${attempt} attempt${attempt > 1 ? "s" : ""}: ${errorMessage}`,
    value: errorMessage,
  };
}

/**
 * Produce the success artifact for a retry node whose source completed.
 */
export function retrySuccessArtifact(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact {
  const source = retrySourceNode(document, node);
  const sourceArtifactIds = new Set(source?.runtimeState.artifactIds ?? []);
  const sourceArtifacts = document.artifacts.filter((a) => sourceArtifactIds.has(a.id));
  const text = sourceArtifacts
    .filter((a) => a.type === "text")
    .map((a) => (typeof a.value === "string" ? a.value : a.preview))
    .join("\n");
  const output = node.outputs.find((p) => p.id === "output");
  return {
    id: `retry-output-${node.id}`,
    nodeId: node.id,
    portId: output?.id ?? "output",
    type: output?.type ?? "text",
    label: node.title,
    preview: text || "Retry succeeded",
    value: text,
  };
}

/**
 * Sleep for a given number of milliseconds.
 */
export function delayMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
