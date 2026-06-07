import { MarkerType } from "@xyflow/react";
import {
  normalizeWorkflowReactFlowEdge,
  reactFlowEdgeId,
  type WorkflowReactFlowEdge,
} from "../lib/reactFlowAdapter";
import type { WorkflowDocument } from "../lib/schema";
import type { WorkflowFlowEdge } from "./WorkflowCanvasTypes";

const workflowEdgeColor = "var(--primary)";
const workflowEdgeStyle = {
  stroke: workflowEdgeColor,
  strokeWidth: 2.75,
};
export const workflowConnectionLineStyle = {
  stroke: workflowEdgeColor,
  strokeWidth: 2.75,
  strokeDasharray: "8 5",
};
const workflowEdgeMarkerEnd = {
  type: MarkerType.ArrowClosed,
  color: workflowEdgeColor,
  width: 18,
  height: 18,
};
export const workflowDefaultEdgeOptions = {
  animated: true,
  type: "smoothstep",
  style: workflowEdgeStyle,
  markerEnd: workflowEdgeMarkerEnd,
};

export function decorateWorkflowEdge(
  edge: WorkflowReactFlowEdge,
): WorkflowFlowEdge {
  return {
    ...edge,
    animated: true,
    type: "smoothstep",
    style: workflowEdgeStyle,
    markerEnd: workflowEdgeMarkerEnd,
  };
}

export function workflowEdgeFromConnection(connection: {
  source?: string | null;
  sourceHandle?: string | null;
  target?: string | null;
  targetHandle?: string | null;
}): WorkflowReactFlowEdge | null {
  if (!connection.source || !connection.target) return null;
  return {
    id: reactFlowEdgeId({
      source: connection.source,
      sourceHandle: connection.sourceHandle,
      target: connection.target,
      targetHandle: connection.targetHandle,
    }),
    source: connection.source,
    sourceHandle: connection.sourceHandle,
    target: connection.target,
    targetHandle: connection.targetHandle,
  };
}

export function normalizeWorkflowFlowEdge(
  document: WorkflowDocument,
  edge: WorkflowReactFlowEdge,
): WorkflowFlowEdge | null {
  const normalized = normalizeWorkflowReactFlowEdge(document, edge);
  return normalized ? decorateWorkflowEdge(normalized) : null;
}
