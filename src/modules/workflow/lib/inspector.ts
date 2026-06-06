import {
  createWorkflowApprovalRequest,
  type WorkflowApprovalAction,
} from "./approval";
import {
  validateWorkflowDocument,
  type WorkflowDocument,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRuntimeErrorCode,
  type WorkflowRuntimeLogEntry,
  type WorkflowRuntimeStatus,
} from "./schema";

const RECENT_RUNTIME_LOG_LIMIT = 5;

export type WorkflowInspectorIssue = {
  severity: "error" | "warning" | "info";
  message: string;
  nodeId?: string;
};

export type WorkflowInspectorSelectedNode = {
  id: string;
  type: WorkflowNodeType;
  title: string;
  status: WorkflowRuntimeStatus;
  inputCount: number;
  outputCount: number;
  message?: string;
  progress?: number;
  artifactIds: string[];
  attempt?: number;
  errorCode?: WorkflowRuntimeErrorCode;
  approval?: {
    id: string;
    action: WorkflowApprovalAction;
    risk: string;
  };
  recentLogs: WorkflowRuntimeLogEntry[];
};

export type WorkflowInspectorState = {
  valid: boolean;
  issues: WorkflowInspectorIssue[];
  selectedNode: WorkflowInspectorSelectedNode | null;
};

export function buildWorkflowInspectorState(
  document: WorkflowDocument,
  options: { selectedNodeId?: string | null } = {},
): WorkflowInspectorState {
  const issues: WorkflowInspectorIssue[] = [
    ...validateWorkflowDocument(document).map((message) => ({
      severity: "error" as const,
      message,
    })),
    ...runtimeIssues(document.nodes),
  ];
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    selectedNode: selectedNodeSummary(document, options.selectedNodeId),
  };
}

function selectedNodeSummary(
  document: WorkflowDocument,
  nodeId?: string | null,
): WorkflowInspectorSelectedNode | null {
  if (!nodeId) return null;
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const approvalRequest = createWorkflowApprovalRequest(document, node.id);
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    status: node.runtimeState.status,
    inputCount: node.inputs.length,
    outputCount: node.outputs.length,
    ...(node.runtimeState.message !== undefined && {
      message: node.runtimeState.message,
    }),
    ...(node.runtimeState.progress !== undefined && {
      progress: node.runtimeState.progress,
    }),
    artifactIds: [...(node.runtimeState.artifactIds ?? [])],
    ...(node.runtimeState.attempt !== undefined && {
      attempt: node.runtimeState.attempt,
    }),
    ...(node.runtimeState.errorCode !== undefined && {
      errorCode: node.runtimeState.errorCode,
    }),
    ...(approvalRequest
      ? {
          approval: {
            id: approvalRequest.id,
            action: approvalRequest.action,
            risk: approvalRequest.risk,
          },
        }
      : {}),
    recentLogs: (node.runtimeState.logs ?? []).slice(-RECENT_RUNTIME_LOG_LIMIT),
  };
}

function runtimeIssues(nodes: WorkflowNode[]): WorkflowInspectorIssue[] {
  return nodes.flatMap<WorkflowInspectorIssue>((node) => {
    if (node.runtimeState.status === "failed") {
      return [
        {
          severity: "error" as const,
          nodeId: node.id,
          message: `${node.title} failed${runtimeErrorCodeLabel(node)}: ${
            node.runtimeState.message ?? "Unknown error"
          }`,
        },
      ];
    }
    if (node.runtimeState.status === "waiting-approval") {
      return [
        {
          severity: "warning" as const,
          nodeId: node.id,
          message: `${node.title} is waiting for explicit approval`,
        },
      ];
    }
    if (node.runtimeState.status === "cancelled") {
      return [
        {
          severity: "info" as const,
          nodeId: node.id,
          message: `${node.title} was cancelled`,
        },
      ];
    }
    return [];
  });
}

function runtimeErrorCodeLabel(node: WorkflowNode): string {
  return node.runtimeState.errorCode ? ` (${node.runtimeState.errorCode})` : "";
}
