import type {
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
  WorkflowViewport,
} from "./schema";

export type WorkflowReactFlowNode = {
  id: string;
  type: "workflowNode";
  position: { x: number; y: number };
  data: {
    workflowNodeId: string;
    nodeType: WorkflowNode["type"];
    title: string;
    node: WorkflowNode;
  };
  width?: number;
  height?: number;
};

export type WorkflowReactFlowEdge = {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
};

export type WorkflowReactFlowElements = {
  nodes: WorkflowReactFlowNode[];
  edges: WorkflowReactFlowEdge[];
  viewport?: WorkflowViewport;
};

export function toReactFlowElements(
  document: WorkflowDocument,
): WorkflowReactFlowElements {
  return {
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: "workflowNode",
      position: node.position,
      data: {
        workflowNodeId: node.id,
        nodeType: node.type,
        title: node.title,
        node,
      },
      width: node.size.width,
      height: node.size.height,
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
    })),
  };
}

export function updateWorkflowDocumentFromReactFlow(
  document: WorkflowDocument,
  elements: WorkflowReactFlowElements,
): WorkflowDocument {
  const flowNodes = new Map(elements.nodes.map((node) => [node.id, node]));
  const keptNodeIds = new Set(flowNodes.keys());
  const artifacts = document.artifacts.filter((artifact) =>
    keptNodeIds.has(artifact.nodeId),
  );
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const nodes = document.nodes
    .filter((node) => keptNodeIds.has(node.id))
    .map((node) => {
      const flowNode = flowNodes.get(node.id);
      if (!flowNode) return node;
      return pruneRuntimeArtifactIds(
        {
          ...node,
          position: flowNode.position,
          size: {
            width: positiveNumberOr(flowNode.width, node.size.width),
            height: positiveNumberOr(flowNode.height, node.size.height),
          },
        },
        artifactIds,
      );
    });
  const draft: WorkflowDocument = {
    ...document,
    viewport: normalizeViewport(elements.viewport, document.viewport),
    artifacts,
    nodes,
    edges: [],
  };
  return {
    ...draft,
    edges: elements.edges.flatMap((edge) => {
      const workflowEdge = toWorkflowEdge(draft, edge);
      return workflowEdge ? [workflowEdge] : [];
    }),
  };
}

export function canConnectReactFlowEdge(
  document: WorkflowDocument,
  edge: WorkflowReactFlowEdge,
): boolean {
  return normalizeWorkflowReactFlowEdge(document, edge) !== null;
}

export function normalizeWorkflowReactFlowEdge(
  document: WorkflowDocument,
  edge: WorkflowReactFlowEdge,
): WorkflowReactFlowEdge | null {
  if (!edge.sourceHandle || !edge.targetHandle) return null;

  const sourceEndpoint = findWorkflowReactFlowEndpoint(
    document,
    edge.source,
    edge.sourceHandle,
  );
  const targetEndpoint = findWorkflowReactFlowEndpoint(
    document,
    edge.target,
    edge.targetHandle,
  );
  if (!sourceEndpoint || !targetEndpoint) return null;

  const outputEndpoint =
    sourceEndpoint.role === "source" ? sourceEndpoint : targetEndpoint;
  const inputEndpoint =
    sourceEndpoint.role === "target" ? sourceEndpoint : targetEndpoint;
  if (outputEndpoint.role !== "source" || inputEndpoint.role !== "target") {
    return null;
  }
  if (outputEndpoint.port.type !== inputEndpoint.port.type) return null;

  return {
    id: edge.id,
    source: outputEndpoint.node.id,
    sourceHandle: outputEndpoint.port.id,
    target: inputEndpoint.node.id,
    targetHandle: inputEndpoint.port.id,
  };
}

type WorkflowReactFlowConnection = Omit<WorkflowReactFlowEdge, "id"> & {
  id?: string;
};

export function reactFlowEdgeId(edge: WorkflowReactFlowConnection): string {
  return [
    "edge",
    edge.source,
    edge.sourceHandle ?? "out",
    edge.target,
    edge.targetHandle ?? "in",
  ]
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, "_"))
    .join("_");
}

function positiveNumberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeViewport(
  viewport: WorkflowViewport | undefined,
  fallback: WorkflowViewport,
): WorkflowViewport {
  if (
    !viewport ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom <= 0
  ) {
    return fallback;
  }

  return viewport;
}

function pruneRuntimeArtifactIds(
  node: WorkflowNode,
  artifactIds: Set<string>,
): WorkflowNode {
  const current = node.runtimeState.artifactIds;
  if (!current) return node;

  const nextArtifactIds = current.filter((id) => artifactIds.has(id));
  const { artifactIds: _staleArtifactIds, ...runtimeState } = node.runtimeState;
  return {
    ...node,
    runtimeState:
      nextArtifactIds.length > 0
        ? { ...runtimeState, artifactIds: nextArtifactIds }
        : runtimeState,
  };
}

function toWorkflowEdge(
  document: WorkflowDocument,
  edge: WorkflowReactFlowEdge,
): WorkflowEdge | null {
  const normalized = normalizeWorkflowReactFlowEdge(document, edge);
  if (!normalized?.sourceHandle || !normalized.targetHandle) return null;

  return {
    id: normalized.id || reactFlowEdgeId(normalized),
    sourceNodeId: normalized.source,
    sourcePortId: normalized.sourceHandle,
    targetNodeId: normalized.target,
    targetPortId: normalized.targetHandle,
  };
}

type WorkflowReactFlowEndpoint = {
  node: WorkflowNode;
  port: WorkflowNode["inputs"][number];
  role: "source" | "target";
};

function findWorkflowReactFlowEndpoint(
  document: WorkflowDocument,
  nodeId: string,
  handleId: string,
): WorkflowReactFlowEndpoint | null {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const outputPort = node.outputs.find((port) => port.id === handleId);
  if (outputPort) return { node, port: outputPort, role: "source" };

  const inputPort = node.inputs.find((port) => port.id === handleId);
  if (inputPort) return { node, port: inputPort, role: "target" };

  return null;
}
