import { getReadyNodeIds } from "./execution";
import type { WorkflowDocument, WorkflowRuntimeLogEntry } from "./schema";
import { isUnsafeWorkflowNode } from "./workflowSafety";

export type WorkflowRuntimeAuditOptions = {
  at?: string;
  message?: string;
};

export type WorkflowExecutionBatchOptions = {
  maxParallel?: number;
  includeUnsafe?: boolean;
};

export function planWorkflowExecutionBatch(
  document: WorkflowDocument,
  options: WorkflowExecutionBatchOptions = {},
): string[] {
  const maxParallel = Math.max(1, options.maxParallel ?? document.nodes.length);
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  return getReadyNodeIds(document)
    .filter((nodeId) => {
      const node = nodeById.get(nodeId);
      return node && (options.includeUnsafe || !isUnsafeWorkflowNode(node));
    })
    .slice(0, maxParallel);
}

export function queueReadyWorkflowNodes(
  document: WorkflowDocument,
  options: WorkflowRuntimeAuditOptions & WorkflowExecutionBatchOptions = {},
): WorkflowDocument {
  const queuedIds = new Set(
    planWorkflowExecutionBatch(document, {
      maxParallel: options.maxParallel,
      includeUnsafe: options.includeUnsafe,
    }),
  );
  if (queuedIds.size === 0) return document;

  const message = options.message ?? "Queued for execution";
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      queuedIds.has(node.id)
        ? {
            ...node,
            runtimeState: {
              ...node.runtimeState,
              status: "queued",
              message,
              attempt: node.runtimeState.attempt ?? 1,
              logs: appendRuntimeLog(node, {
                event: "queued",
                message,
                ...(options.at ? { at: options.at } : {}),
              }),
            },
          }
        : node,
    ),
  };
}

export function retryWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
  options: WorkflowRuntimeAuditOptions = {},
): WorkflowDocument {
  const target = document.nodes.find((node) => node.id === nodeId);
  if (
    !target ||
    !["failed", "cancelled"].includes(target.runtimeState.status)
  ) {
    return document;
  }

  const staleArtifactIds = new Set(target.runtimeState.artifactIds ?? []);
  const message = options.message ?? "Queued for retry";
  return {
    ...document,
    artifacts: document.artifacts.filter(
      (artifact) =>
        artifact.nodeId !== nodeId && !staleArtifactIds.has(artifact.id),
    ),
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            runtimeState: {
              status: "queued",
              message,
              attempt: (node.runtimeState.attempt ?? 1) + 1,
              logs: appendRuntimeLog(node, {
                event: "retry",
                message,
                ...(options.at ? { at: options.at } : {}),
              }),
            },
          }
        : node,
    ),
  };
}

function appendRuntimeLog(
  node: WorkflowDocument["nodes"][number],
  entry: WorkflowRuntimeLogEntry,
): WorkflowRuntimeLogEntry[] {
  return [...(node.runtimeState.logs ?? []), entry];
}
