import type { WorkflowDocument, WorkflowNode } from "./schema";

export type WorkflowApprovalAction =
  | { kind: "shell"; command: string }
  | { kind: "agent"; prompt: string }
  | { kind: "file"; operation: string; path: string }
  | { kind: "browser"; url: string; instructions: string };

export type WorkflowApprovalAudit = {
  workflowId: string;
  nodeId: string;
  requestedAt?: string;
};

export type WorkflowApprovalRequest = {
  id: string;
  workflowId: string;
  nodeId: string;
  nodeType: "shellCommand" | "agent" | "fileOperation" | "browserAutomation";
  title: string;
  action: WorkflowApprovalAction;
  risk: string;
  audit: WorkflowApprovalAudit;
};

export type WorkflowApprovalDecision = {
  approvedAt?: string;
  approver?: string;
};

export type WorkflowApprovalArtifactValue = {
  approval: WorkflowApprovalAudit &
    WorkflowApprovalDecision & {
      action: WorkflowApprovalAction;
    };
};

export function workflowNodeExecutionIntent(
  node: WorkflowNode,
): WorkflowApprovalAction | null {
  if (node.type === "shellCommand") {
    return { kind: "shell", command: stringConfig(node.config.command) };
  }
  if (node.type === "agent") {
    return { kind: "agent", prompt: stringConfig(node.config.prompt) };
  }
  if (node.type === "fileOperation") {
    return {
      kind: "file",
      operation: stringConfig(node.config.operation),
      path: stringConfig(node.config.path),
    };
  }
  if (node.type === "browserAutomation") {
    return {
      kind: "browser",
      url: stringConfig(node.config.url),
      instructions: stringConfig(node.config.instructions),
    };
  }
  return null;
}

export function createWorkflowApprovalRequest(
  document: WorkflowDocument,
  nodeId: string,
  options: { requestedAt?: string } = {},
): WorkflowApprovalRequest | null {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.runtimeState.status !== "waiting-approval") return null;

  const action = workflowNodeExecutionIntent(node);
  const nodeType = workflowApprovalNodeType(node);
  if (!action || !nodeType) return null;

  return {
    id: `${document.id}:${node.id}:approval`,
    workflowId: document.id,
    nodeId: node.id,
    nodeType,
    title: node.title,
    action,
    risk: approvalRiskForNode(node),
    audit: {
      workflowId: document.id,
      nodeId: node.id,
      ...(options.requestedAt ? { requestedAt: options.requestedAt } : {}),
    },
  };
}

export function createWorkflowApprovalArtifactValue(
  document: WorkflowDocument,
  node: WorkflowNode,
  decision: WorkflowApprovalDecision = {},
): WorkflowApprovalArtifactValue | undefined {
  const action = workflowNodeExecutionIntent(node);
  if (!action) return undefined;
  return {
    approval: {
      workflowId: document.id,
      nodeId: node.id,
      action,
      ...(decision.approvedAt ? { approvedAt: decision.approvedAt } : {}),
      ...(decision.approver ? { approver: decision.approver } : {}),
    },
  };
}

function workflowApprovalNodeType(
  node: WorkflowNode,
): WorkflowApprovalRequest["nodeType"] | null {
  if (
    node.type === "shellCommand" ||
    node.type === "agent" ||
    node.type === "fileOperation" ||
    node.type === "browserAutomation"
  ) {
    return node.type;
  }
  return null;
}

function approvalRiskForNode(node: WorkflowNode): string {
  if (node.type === "shellCommand") {
    return "Shell commands can read, write, delete, or execute files.";
  }
  if (node.type === "fileOperation") {
    return "File operations can read, overwrite, create, or delete workspace files.";
  }
  if (node.type === "browserAutomation") {
    return "Browser automation can navigate pages, submit forms, and expose page data.";
  }
  return "Agent runs can inspect context, call tools, and propose changes.";
}

function stringConfig(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
