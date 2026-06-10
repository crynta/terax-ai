import type { WorkflowDocument } from "../lib/schema";
import { formatDuration, nodeExecutionDuration } from "../lib/schema";

/**
 * Compute workflow statistics for display.
 */
export function workflowStatistics(document: WorkflowDocument) {
  const nodes = document.nodes;
  const edges = document.edges;
  const artifacts = document.artifacts;
  const variables = document.variables ?? [];

  // Node counts by type
  const nodeTypeCounts = new Map<string, number>();
  for (const node of nodes) {
    nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);
  }

  // Status counts
  const statusCounts = new Map<string, number>();
  for (const node of nodes) {
    statusCounts.set(
      node.runtimeState.status,
      (statusCounts.get(node.runtimeState.status) ?? 0) + 1,
    );
  }

  // Execution timing
  let totalDuration = 0;
  let completedCount = 0;
  let failedCount = 0;
  for (const node of nodes) {
    if (
      node.runtimeState.status === "completed" ||
      node.runtimeState.status === "failed"
    ) {
      const dur = nodeExecutionDuration(node);
      if (dur !== undefined) {
        totalDuration += dur;
      }
      if (node.runtimeState.status === "completed") completedCount++;
      if (node.runtimeState.status === "failed") failedCount++;
    }
  }

  // Run history stats
  const runHistory = document.runHistory ?? [];

  // Port stats
  let totalInputPorts = 0;
  let totalOutputPorts = 0;
  for (const node of nodes) {
    totalInputPorts += node.inputs.length;
    totalOutputPorts += node.outputs.length;
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    artifactCount: artifacts.length,
    variableCount: variables.length,
    runCount: runHistory.length,
    nodeTypeCounts: Object.fromEntries(nodeTypeCounts),
    statusCounts: Object.fromEntries(statusCounts),
    completedCount,
    failedCount,
    totalDurationMs: totalDuration,
    totalDurationFormatted:
      totalDuration > 0 ? formatDuration(totalDuration) : undefined,
    totalInputPorts,
    totalOutputPorts,
    unsafeNodeCount: nodes.filter(
      (n) =>
        n.type === "shellCommand" ||
        n.type === "agent" ||
        n.type === "browserAutomation" ||
        n.type === "fileOperation",
    ).length,
  };
}

export type WorkflowStatistics = ReturnType<typeof workflowStatistics>;
