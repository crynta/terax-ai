import type { WorkflowApprovalDecision } from "../approval";
import type { WorkflowProgressUpdate } from "../providerAdapter";
import { classifyWorkflowProviderError, isAbortError } from "../providerErrors";
import type { WorkflowDocument, WorkflowNode } from "../schema";
import {
  agentArtifactForOutput,
  agentOutputPreview,
  agentPromptConfig,
  approvedArtifactForNode,
  approvedRuntimeState,
  browserAutomationArtifactForOutput,
  browserInstructionsConfig,
  browserOutputPreview,
  fileOperationArtifactForOutput,
  fileOperationContentConfig,
  optionalPositiveNumberConfig,
  optionalStringConfig,
  shellArtifactForOutput,
  shellCommandConfig,
  shellFailureMessage,
  shellOutputFailed,
  shellOutputProgressMessage,
  stringConfig,
} from "./artifacts";
import {
  appendRuntimeLog,
  cancelledNodeDocument,
  clampProgress,
  completedRuntimeStateForArtifact,
  failedApprovedNodeDocument,
  mergeArtifacts,
  persistProviderArtifact,
  progressLogMessage,
  runtimeEventTime,
  updateNodeRuntimeState,
} from "./runtime";
import type {
  ApprovedWorkflowNodeExecutionOptions,
  WorkflowStepExecution,
} from "./types";

export function approveWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
  decision: WorkflowApprovalDecision = {},
): WorkflowDocument {
  const target = document.nodes.find((node) => node.id === nodeId);
  if (target?.runtimeState.status !== "waiting-approval") return document;

  return {
    ...document,
    artifacts: mergeArtifacts(document.artifacts, [
      approvedArtifactForNode(document, target, decision),
    ]),
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, runtimeState: approvedRuntimeState(document, node) }
        : node,
    ),
  };
}

export async function executeApprovedWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
  options: ApprovedWorkflowNodeExecutionOptions = {},
): Promise<WorkflowDocument> {
  return startApprovedWorkflowNodeExecution(document, nodeId, options).finished;
}

export function startApprovedWorkflowNodeExecution(
  document: WorkflowDocument,
  nodeId: string,
  options: ApprovedWorkflowNodeExecutionOptions = {},
): WorkflowStepExecution {
  const target = document.nodes.find((node) => node.id === nodeId);
  if (target?.runtimeState.status !== "waiting-approval") {
    return { document, finished: Promise.resolve(document) };
  }
  if (target.type === "shellCommand" && options.executeShellCommand) {
    const message = "Running approved shell command";
    const started = approvedRunningDocument(document, nodeId, message, options);
    return {
      document: started,
      finished: finishApprovedShellNode(document, started, target, options),
    };
  }

  if (target.type === "agent" && options.executeAgent) {
    const message = "Running approved agent prompt";
    const started = approvedRunningDocument(document, nodeId, message, options);
    return {
      document: started,
      finished: finishApprovedAgentNode(document, started, target, options),
    };
  }

  if (target.type === "fileOperation" && options.executeFileOperation) {
    const message = "Running approved file operation";
    const started = approvedRunningDocument(document, nodeId, message, options);
    return {
      document: started,
      finished: finishApprovedFileOperationNode(
        document,
        started,
        target,
        options,
      ),
    };
  }

  if (target.type === "browserAutomation" && options.executeBrowserAutomation) {
    const message = "Running approved browser automation";
    const started = approvedRunningDocument(document, nodeId, message, options);
    return {
      document: started,
      finished: finishApprovedBrowserAutomationNode(
        document,
        started,
        target,
        options,
      ),
    };
  }

  const approved = approveWorkflowNode(document, nodeId, options.decision);
  return { document: approved, finished: Promise.resolve(approved) };
}

export function rejectWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
): WorkflowDocument {
  const target = document.nodes.find((node) => node.id === nodeId);
  if (target?.runtimeState.status !== "waiting-approval") return document;

  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            runtimeState: { status: "cancelled", message: "Approval rejected" },
          }
        : node,
    ),
  };
}

function approvedRunningDocument(
  document: WorkflowDocument,
  nodeId: string,
  message: string,
  options: ApprovedWorkflowNodeExecutionOptions,
): WorkflowDocument {
  return updateNodeRuntimeState(document, nodeId, (state) => ({
    ...state,
    status: "running",
    message,
    logs: appendRuntimeLog(state, {
      event: "running",
      message,
      at: runtimeEventTime(options),
    }),
  }));
}

async function finishApprovedAgentNode(
  document: WorkflowDocument,
  started: WorkflowDocument,
  node: WorkflowNode,
  options: ApprovedWorkflowNodeExecutionOptions,
): Promise<WorkflowDocument> {
  let progressDocument = started;
  const prompt = agentPromptConfig(node);
  const cwd = optionalStringConfig(node.config.cwd);
  const reportOutput = (chunk: string) => {
    if (options.signal?.aborted || chunk.length === 0) return;
    progressDocument = updateNodeRuntimeState(
      progressDocument,
      node.id,
      (state) => ({
        ...state,
        status: "running",
        message: agentOutputPreview(chunk),
        logs: appendRuntimeLog(state, {
          event: "progress",
          message: agentOutputPreview(chunk),
          at: runtimeEventTime(options),
        }),
      }),
    );
    options.onProgress?.(progressDocument);
  };

  if (options.signal?.aborted) {
    return cancelledNodeDocument(progressDocument, node.id, options);
  }
  if (!prompt) {
    return failedApprovedNodeDocument(progressDocument, node, null, {
      message: "Agent prompt is empty",
      code: "unknown",
      options,
    });
  }

  try {
    const output = await options.executeAgent?.({
      document,
      node,
      prompt,
      ...(cwd !== undefined && { cwd }),
      signal: options.signal,
      reportOutput,
    });
    if (!output) return progressDocument;
    if (options.signal?.aborted) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }

    const createdArtifact = agentArtifactForOutput(document, node, {
      prompt,
      cwd,
      output,
      decision: options.decision,
    });
    const artifact = await persistProviderArtifact(
      createdArtifact,
      document,
      node,
      options,
    );
    const withArtifact = {
      ...progressDocument,
      artifacts: mergeArtifacts(progressDocument.artifacts, [artifact]),
    };
    if (options.signal?.aborted) {
      return cancelledNodeDocument(withArtifact, node.id, options);
    }

    return {
      ...withArtifact,
      nodes: withArtifact.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              runtimeState: completedRuntimeStateForArtifact(
                candidate,
                artifact,
                candidate.runtimeState,
                options,
              ),
            }
          : candidate,
      ),
    };
  } catch (error) {
    if (isAbortError(error, options.signal)) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }
    return failedApprovedNodeDocument(progressDocument, node, null, {
      ...classifyWorkflowProviderError(error, options.signal),
      options,
    });
  }
}

async function finishApprovedFileOperationNode(
  document: WorkflowDocument,
  started: WorkflowDocument,
  node: WorkflowNode,
  options: ApprovedWorkflowNodeExecutionOptions,
): Promise<WorkflowDocument> {
  let progressDocument = started;
  const operation = stringConfig(node.config.operation, "read");
  const path = optionalStringConfig(node.config.path);
  const content = fileOperationContentConfig(document, node);
  const reportProgress = (update: WorkflowProgressUpdate) => {
    if (options.signal?.aborted) return;
    progressDocument = updateNodeRuntimeState(
      progressDocument,
      node.id,
      (state) => ({
        ...state,
        status: "running",
        ...(update.message !== undefined && { message: update.message }),
        ...(update.progress !== undefined && {
          progress: clampProgress(update.progress),
        }),
        logs: appendRuntimeLog(state, {
          event: "progress",
          message: progressLogMessage(update),
          at: runtimeEventTime(options),
        }),
      }),
    );
    options.onProgress?.(progressDocument);
  };

  if (options.signal?.aborted) {
    return cancelledNodeDocument(progressDocument, node.id, options);
  }
  if (!path) {
    return failedApprovedNodeDocument(progressDocument, node, null, {
      message: "File operation path is required",
      code: "unknown",
      options,
    });
  }

  try {
    const output = await options.executeFileOperation?.({
      document,
      node,
      operation,
      path,
      ...(content !== undefined ? { content } : {}),
      signal: options.signal,
      reportProgress,
    });
    if (!output) return progressDocument;
    if (options.signal?.aborted) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }

    const createdArtifact = fileOperationArtifactForOutput(document, node, {
      output,
      decision: options.decision,
    });
    const artifact = await persistProviderArtifact(
      createdArtifact,
      document,
      node,
      options,
    );
    const withArtifact = {
      ...progressDocument,
      artifacts: mergeArtifacts(progressDocument.artifacts, [artifact]),
    };
    if (options.signal?.aborted) {
      return cancelledNodeDocument(withArtifact, node.id, options);
    }

    return {
      ...withArtifact,
      nodes: withArtifact.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              runtimeState: completedRuntimeStateForArtifact(
                candidate,
                artifact,
                candidate.runtimeState,
                options,
              ),
            }
          : candidate,
      ),
    };
  } catch (error) {
    if (isAbortError(error, options.signal)) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }
    return failedApprovedNodeDocument(progressDocument, node, null, {
      ...classifyWorkflowProviderError(error, options.signal),
      options,
    });
  }
}

async function finishApprovedBrowserAutomationNode(
  document: WorkflowDocument,
  started: WorkflowDocument,
  node: WorkflowNode,
  options: ApprovedWorkflowNodeExecutionOptions,
): Promise<WorkflowDocument> {
  let progressDocument = started;
  const url = optionalStringConfig(node.config.url) ?? "";
  const instructions = browserInstructionsConfig(document, node);
  const reportOutput = (chunk: string) => {
    if (options.signal?.aborted || chunk.length === 0) return;
    progressDocument = updateNodeRuntimeState(
      progressDocument,
      node.id,
      (state) => ({
        ...state,
        status: "running",
        message: browserOutputPreview(chunk),
        logs: appendRuntimeLog(state, {
          event: "progress",
          message: browserOutputPreview(chunk),
          at: runtimeEventTime(options),
        }),
      }),
    );
    options.onProgress?.(progressDocument);
  };

  if (options.signal?.aborted) {
    return cancelledNodeDocument(progressDocument, node.id, options);
  }
  if (!instructions) {
    return failedApprovedNodeDocument(progressDocument, node, null, {
      message: "Browser automation instructions are required",
      code: "unknown",
      options,
    });
  }

  try {
    const output = await options.executeBrowserAutomation?.({
      document,
      node,
      url,
      instructions,
      signal: options.signal,
      reportOutput,
    });
    if (!output) return progressDocument;
    if (options.signal?.aborted) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }

    const createdArtifact = browserAutomationArtifactForOutput(document, node, {
      url,
      instructions,
      output,
      decision: options.decision,
    });
    const artifact = await persistProviderArtifact(
      createdArtifact,
      document,
      node,
      options,
    );
    const withArtifact = {
      ...progressDocument,
      artifacts: mergeArtifacts(progressDocument.artifacts, [artifact]),
    };
    if (options.signal?.aborted) {
      return cancelledNodeDocument(withArtifact, node.id, options);
    }

    return {
      ...withArtifact,
      nodes: withArtifact.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              runtimeState: completedRuntimeStateForArtifact(
                candidate,
                artifact,
                candidate.runtimeState,
                options,
              ),
            }
          : candidate,
      ),
    };
  } catch (error) {
    if (isAbortError(error, options.signal)) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }
    return failedApprovedNodeDocument(progressDocument, node, null, {
      ...classifyWorkflowProviderError(error, options.signal),
      options,
    });
  }
}

async function finishApprovedShellNode(
  document: WorkflowDocument,
  started: WorkflowDocument,
  node: WorkflowNode,
  options: ApprovedWorkflowNodeExecutionOptions,
): Promise<WorkflowDocument> {
  let progressDocument = started;
  const command = shellCommandConfig(node);
  const cwd = optionalStringConfig(node.config.cwd);
  const timeoutSecs = optionalPositiveNumberConfig(node.config.timeoutSecs);
  const reportOutput = (chunk: string) => {
    if (options.signal?.aborted || chunk.length === 0) return;
    progressDocument = updateNodeRuntimeState(
      progressDocument,
      node.id,
      (state) => ({
        ...state,
        status: "running",
        message: shellOutputProgressMessage(chunk),
        logs: appendRuntimeLog(state, {
          event: "progress",
          message: shellOutputProgressMessage(chunk),
          at: runtimeEventTime(options),
        }),
      }),
    );
    options.onProgress?.(progressDocument);
  };

  if (options.signal?.aborted) {
    return cancelledNodeDocument(progressDocument, node.id, options);
  }
  if (!command) {
    return failedApprovedNodeDocument(progressDocument, node, null, {
      message: "Shell command is empty",
      code: "unknown",
      options,
    });
  }

  try {
    const output = await options.executeShellCommand?.({
      document,
      node,
      command,
      ...(cwd !== undefined && { cwd }),
      ...(timeoutSecs !== undefined && { timeoutSecs }),
      signal: options.signal,
      reportOutput,
    });
    if (!output) return progressDocument;
    if (options.signal?.aborted) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }

    const createdArtifact = shellArtifactForOutput(document, node, {
      command,
      cwd,
      timeoutSecs,
      output,
      decision: options.decision,
    });
    const artifact = await persistProviderArtifact(
      createdArtifact,
      document,
      node,
      options,
    );
    const withArtifact = {
      ...progressDocument,
      artifacts: mergeArtifacts(progressDocument.artifacts, [artifact]),
    };
    if (options.signal?.aborted) {
      return cancelledNodeDocument(withArtifact, node.id, options);
    }
    if (shellOutputFailed(output)) {
      return failedApprovedNodeDocument(withArtifact, node, artifact, {
        message: shellFailureMessage(output),
        code: output.timedOut ? "timeout" : "unknown",
        options,
      });
    }

    return {
      ...withArtifact,
      nodes: withArtifact.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              runtimeState: completedRuntimeStateForArtifact(
                candidate,
                artifact,
                candidate.runtimeState,
                options,
              ),
            }
          : candidate,
      ),
    };
  } catch (error) {
    if (isAbortError(error, options.signal)) {
      return cancelledNodeDocument(progressDocument, node.id, options);
    }
    return failedApprovedNodeDocument(progressDocument, node, null, {
      ...classifyWorkflowProviderError(error, options.signal),
      options,
    });
  }
}
