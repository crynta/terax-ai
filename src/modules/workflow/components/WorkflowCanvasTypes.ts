import type { Edge, Node } from "@xyflow/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { WorkflowDiscoveredProviderModels } from "../lib/providerConfigUi";
import type {
  WorkflowArtifact,
  WorkflowNode,
  WorkflowPortType,
} from "../lib/schema";

export type WorkflowConnectionHandle = {
  nodeId: string;
  nodeTitle: string;
  portId: string;
  portLabel: string;
  portType: WorkflowPortType;
  direction: "source" | "target";
};

export type WorkflowScreenPoint = { x: number; y: number };

export type WorkflowConnectionDragState = {
  handle: WorkflowConnectionHandle;
  fromClient: WorkflowScreenPoint;
  toClient: WorkflowScreenPoint;
};

type WorkflowNodeData = {
  workflowNodeId: string;
  nodeType: WorkflowNode["type"];
  title: string;
  node: WorkflowNode;
  visible: boolean;
  workflowId: string;
  artifacts: WorkflowArtifact[];
  discoveredProviderModels: WorkflowDiscoveredProviderModels;
  reusableArtifacts: WorkflowArtifact[];
  pendingConnection: WorkflowConnectionHandle | null;
  onApproveNode: (nodeId: string) => void;
  onArtifactActionError: (error: unknown) => void;
  onArtifactMaterialized: (artifact: WorkflowArtifact) => void;
  onRejectNode: (nodeId: string) => void;
  onDeleteArtifact: (artifactId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onHandleClick: (handle: WorkflowConnectionHandle) => void;
  onHandleMouseDown: (
    handle: WorkflowConnectionHandle,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onPreviewArtifact: (artifact: WorkflowArtifact) => void;
  workflowFilePath?: string;
  workflowDocumentId: string;
  onUpdateNodeConfig: (nodeId: string, patch: Record<string, unknown>) => void;
};

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflowNode">;

export type WorkflowFlowEdge = Edge;
