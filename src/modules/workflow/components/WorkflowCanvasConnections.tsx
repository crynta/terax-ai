import type { RefObject } from "react";
import type { WorkflowDocument, WorkflowNode } from "../lib/schema";
import type {
  WorkflowConnectionDragState,
  WorkflowConnectionHandle,
  WorkflowScreenPoint,
} from "./WorkflowCanvasTypes";

const workflowEdgeColor = "var(--primary)";

export function WorkflowFallbackEdgeLayer({
  document,
}: {
  document: WorkflowDocument;
}) {
  const overlayEdges = workflowFallbackEdges(document);
  if (overlayEdges.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      data-testid="workflow-fallback-edge-layer"
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
    >
      {overlayEdges.map((edge) => (
        <path
          key={edge.id}
          className="workflow-fallback-edge-path"
          d={edge.path}
          fill="none"
          markerEnd="url(#workflow-fallback-edge-arrow)"
          opacity={0.92}
          stroke={workflowEdgeColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
        />
      ))}
      <defs>
        <marker
          id="workflow-fallback-edge-arrow"
          markerHeight="10"
          markerUnits="strokeWidth"
          markerWidth="10"
          orient="auto"
          refX="8"
          refY="5"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={workflowEdgeColor} />
        </marker>
      </defs>
    </svg>
  );
}

export function WorkflowDragConnectionLine({
  dragConnection,
  rootRef,
}: {
  dragConnection: WorkflowConnectionDragState | null;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  if (!dragConnection) return null;
  const rootRect = rootRef.current?.getBoundingClientRect();
  if (!rootRect) return null;
  const source = {
    x: dragConnection.fromClient.x - rootRect.left,
    y: dragConnection.fromClient.y - rootRect.top,
  };
  const target = {
    x: dragConnection.toClient.x - rootRect.left,
    y: dragConnection.toClient.y - rootRect.top,
  };

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-50 overflow-visible"
    >
      <path
        d={workflowBezierPath(source, target)}
        fill="none"
        opacity={0.95}
        stroke={workflowEdgeColor}
        strokeDasharray="8 5"
        strokeLinecap="round"
        strokeWidth={3}
      />
    </svg>
  );
}

type WorkflowFallbackEdge = {
  id: string;
  path: string;
};

export function workflowFallbackEdges(
  document: WorkflowDocument,
): WorkflowFallbackEdge[] {
  return document.edges.flatMap((edge) => {
    const sourceNode = document.nodes.find(
      (node) => node.id === edge.sourceNodeId,
    );
    const targetNode = document.nodes.find(
      (node) => node.id === edge.targetNodeId,
    );
    if (!sourceNode || !targetNode) return [];

    const sourceY = workflowHandleFlowY(
      sourceNode,
      "source",
      edge.sourcePortId,
    );
    const targetY = workflowHandleFlowY(
      targetNode,
      "target",
      edge.targetPortId,
    );
    if (sourceY === null || targetY === null) return [];

    const source = workflowFlowPointToScreen(document, {
      x: sourceNode.position.x + sourceNode.size.width,
      y: sourceY,
    });
    const target = workflowFlowPointToScreen(document, {
      x: targetNode.position.x,
      y: targetY,
    });

    return [{ id: edge.id, path: workflowBezierPath(source, target) }];
  });
}

export function workflowHandleFlowY(
  node: WorkflowNode,
  direction: WorkflowConnectionHandle["direction"],
  portId: string,
): number | null {
  const ports = direction === "source" ? node.outputs : node.inputs;
  const index = ports.findIndex((port) => port.id === portId);
  if (index < 0) return null;
  return node.position.y + 76 + index * 24;
}

export function workflowFlowPointToScreen(
  document: WorkflowDocument,
  point: WorkflowScreenPoint,
): WorkflowScreenPoint {
  return {
    x: point.x * document.viewport.zoom + document.viewport.x,
    y: point.y * document.viewport.zoom + document.viewport.y,
  };
}

export function workflowBezierPath(
  source: WorkflowScreenPoint,
  target: WorkflowScreenPoint,
): string {
  const controlOffset = Math.max(72, Math.abs(target.x - source.x) * 0.45);
  return [
    `M ${source.x} ${source.y}`,
    `C ${source.x + controlOffset} ${source.y}`,
    `${target.x - controlOffset} ${target.y}`,
    `${target.x} ${target.y}`,
  ].join(" ");
}

export function workflowConnectionHandleFromPoint(
  document: WorkflowDocument,
  x: number,
  y: number,
): WorkflowConnectionHandle | null {
  const element = window.document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-workflow-handle-node-id]");
  if (!element) return null;
  return workflowConnectionHandleFromElement(document, element);
}

export function workflowConnectionHandleFromElement(
  document: WorkflowDocument,
  element: HTMLElement,
): WorkflowConnectionHandle | null {
  const nodeId = element.dataset.workflowHandleNodeId;
  const portId = element.dataset.workflowHandlePortId;
  const direction = element.dataset.workflowHandleDirection;
  if (
    !nodeId ||
    !portId ||
    (direction !== "source" && direction !== "target")
  ) {
    return null;
  }

  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const ports = direction === "source" ? node.outputs : node.inputs;
  const port = ports.find((candidate) => candidate.id === portId);
  if (!port) return null;
  return {
    nodeId: node.id,
    nodeTitle: node.title,
    portId: port.id,
    portLabel: port.label,
    portType: port.type,
    direction,
  };
}

export function sameWorkflowHandle(
  left: WorkflowConnectionHandle,
  right: WorkflowConnectionHandle,
): boolean {
  return (
    left.nodeId === right.nodeId &&
    left.portId === right.portId &&
    left.direction === right.direction
  );
}

export function isWorkflowEditableKeyTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"]',
    ),
  );
}
