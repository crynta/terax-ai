import type { WorkflowProgressUpdate } from "../providerAdapter";
import type { WorkflowProviderFailure } from "../providerErrors";
import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
  WorkflowRuntimeErrorCode,
  WorkflowRuntimeLogEntry,
} from "../schema";
import { httpRuntimeMessage, runtimeMessageForNode } from "./artifacts";
import type {
  ApprovedWorkflowNodeExecutionOptions,
  WorkflowStepExecutionOptions,
} from "./types";

type WorkflowRuntimeState = WorkflowNode["runtimeState"];

export async function persistProviderArtifact(
  artifact: WorkflowArtifact,
  document: WorkflowDocument,
  node: WorkflowNode,
  options: Pick<WorkflowStepExecutionOptions, "persistArtifact">,
): Promise<WorkflowArtifact> {
  if (!options.persistArtifact) return artifact;
  return await options.persistArtifact(artifact, document, node);
}

export function cancelledNodeDocument(
  document: WorkflowDocument,
  nodeId: string,
  options: ApprovedWorkflowNodeExecutionOptions | WorkflowStepExecutionOptions,
): WorkflowDocument {
  const message = "Execution cancelled";
  return updateNodeRuntimeState(document, nodeId, (state) => ({
    status: "cancelled",
    message,
    ...(state.attempt !== undefined && { attempt: state.attempt }),
    logs: appendRuntimeLog(state, {
      event: "cancelled",
      message,
      at: runtimeEventTime(options),
    }),
  }));
}

export function failedApprovedNodeDocument(
  document: WorkflowDocument,
  node: WorkflowNode,
  artifact: WorkflowArtifact | null,
  failure: {
    message: string;
    code: WorkflowRuntimeErrorCode;
    options: ApprovedWorkflowNodeExecutionOptions;
  },
): WorkflowDocument {
  return updateNodeRuntimeState(document, node.id, (state) => ({
    status: "failed",
    message: failure.message,
    errorCode: failure.code,
    ...(artifact ? { artifactIds: [artifact.id] } : {}),
    ...(state.attempt !== undefined && { attempt: state.attempt }),
    logs: appendRuntimeLog(state, {
      event: "failed",
      message: failure.message,
      at: runtimeEventTime(failure.options),
    }),
  }));
}

export function completedRuntimeStateForArtifact(
  node: WorkflowNode,
  artifact: WorkflowArtifact,
  previousState: WorkflowRuntimeState,
  options: WorkflowStepExecutionOptions,
): WorkflowRuntimeState {
  const message =
    node.type === "httpRequest"
      ? httpRuntimeMessage(artifact)
      : node.type === "fileOperation"
        ? "File operation result ready"
        : node.type === "browserAutomation"
          ? "Browser automation result ready"
          : runtimeMessageForNode(node);
  return {
    status: "completed",
    message,
    artifactIds: [artifact.id],
    ...(previousState.attempt !== undefined && {
      attempt: previousState.attempt,
    }),
    logs: appendRuntimeLog(previousState, {
      event: "completed",
      message,
      at: runtimeEventTime(options),
    }),
  };
}

export function failedRuntimeState(
  previousState: WorkflowRuntimeState,
  failure: WorkflowProviderFailure,
  options: WorkflowStepExecutionOptions,
): WorkflowRuntimeState {
  return {
    status: "failed",
    message: failure.message,
    errorCode: failure.code,
    ...(previousState.attempt !== undefined && {
      attempt: previousState.attempt,
    }),
    logs: appendRuntimeLog(previousState, {
      event: "failed",
      message: failure.message,
      at: runtimeEventTime(options),
    }),
  };
}

export function appendRuntimeLog(
  state: WorkflowRuntimeState,
  entry: WorkflowRuntimeLogEntry,
): WorkflowRuntimeLogEntry[] {
  return [...(state.logs ?? []), entry];
}

export function runtimeEventTime(
  options: WorkflowStepExecutionOptions,
): string {
  return options.now?.() ?? new Date().toISOString();
}

export function progressLogMessage(update: WorkflowProgressUpdate): string {
  if (update.message !== undefined) return update.message;
  if (update.progress !== undefined) {
    return `Progress ${Math.round(clampProgress(update.progress) * 100)}%`;
  }
  return "Progress update";
}

export function updateNodeRuntimeState(
  document: WorkflowDocument,
  nodeId: string,
  update: (state: WorkflowRuntimeState) => WorkflowRuntimeState,
): WorkflowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, runtimeState: update(node.runtimeState) }
        : node,
    ),
  };
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(Math.max(progress, 0), 1);
}

export function mergeArtifacts(
  existing: WorkflowArtifact[],
  additions: WorkflowArtifact[],
): WorkflowArtifact[] {
  if (additions.length === 0) return existing;
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact]));
  for (const artifact of additions) byId.set(artifact.id, artifact);
  return Array.from(byId.values());
}
