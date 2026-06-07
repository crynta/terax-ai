import {
  artifactForNode,
  httpArtifactForOutput,
  httpRequestForNode,
  placeholderArtifactForNode,
  runtimeStateForReadyNode,
  shouldCreateArtifactForReadyNode,
} from "./execution/artifacts";
import {
  createWorkflowProviderArtifactAsync,
  getWorkflowProviderAdapter,
  type WorkflowProgressUpdate,
} from "./providerAdapter";
import {
  classifyWorkflowProviderError,
  isAbortError,
  type WorkflowProviderFailure,
} from "./providerErrors";
import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
  WorkflowRuntimeStatus,
} from "./schema";
import { isUnsafeWorkflowNode } from "./workflowSafety";

export {
  approveWorkflowNode,
  executeApprovedWorkflowNode,
  rejectWorkflowNode,
  startApprovedWorkflowNodeExecution,
} from "./execution/approved";

import {
  appendRuntimeLog,
  clampProgress,
  completedRuntimeStateForArtifact,
  failedRuntimeState,
  mergeArtifacts,
  persistProviderArtifact,
  progressLogMessage,
  runtimeEventTime,
  updateNodeRuntimeState,
} from "./execution/runtime";
import type {
  WorkflowProviderExecutionRuntimeContext,
  WorkflowStepExecution,
  WorkflowStepExecutionOptions,
} from "./execution/types";

export type {
  ApprovedWorkflowNodeExecutionOptions,
  WorkflowAgentExecutor,
  WorkflowAgentInput,
  WorkflowAgentOutput,
  WorkflowArtifactPersistence,
  WorkflowBrowserAutomationExecutor,
  WorkflowBrowserAutomationInput,
  WorkflowBrowserAutomationOutput,
  WorkflowFileOperationExecutor,
  WorkflowFileOperationInput,
  WorkflowFileOperationOutput,
  WorkflowHttpRequestExecutor,
  WorkflowHttpRequestInput,
  WorkflowHttpRequestOutput,
  WorkflowProviderArtifactFactory,
  WorkflowProviderExecutionRuntimeContext,
  WorkflowShellCommandExecutor,
  WorkflowShellCommandInput,
  WorkflowShellCommandOutput,
  WorkflowStepExecution,
  WorkflowStepExecutionOptions,
} from "./execution/types";

const runnableStatuses = new Set<WorkflowRuntimeStatus>(["idle", "queued"]);

type WorkflowReadyNodeOptions = {
  includeUnsafe?: boolean;
  nodeIds?: Iterable<string>;
};

export function getReadyNodeIds(
  document: WorkflowDocument,
  options: WorkflowReadyNodeOptions = {},
): string[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const allowedNodeIds = options.nodeIds ? new Set(options.nodeIds) : null;
  const includeUnsafe = options.includeUnsafe ?? true;
  return document.nodes
    .filter((node) => runnableStatuses.has(node.runtimeState.status))
    .filter((node) => !allowedNodeIds || allowedNodeIds.has(node.id))
    .filter((node) => includeUnsafe || !isUnsafeWorkflowNode(node))
    .filter((node) => {
      const incoming = document.edges.filter(
        (edge) => edge.targetNodeId === node.id,
      );
      return incoming.every((edge) => {
        const source = byId.get(edge.sourceNodeId);
        return source?.runtimeState.status === "completed";
      });
    })
    .map((node) => node.id);
}

export function executeWorkflowStep(
  document: WorkflowDocument,
): WorkflowDocument {
  const ready = new Set(getReadyNodeIds(document));
  if (ready.size === 0) return document;

  const readyNodes = document.nodes.filter((node) => ready.has(node.id));
  const artifacts = readyNodes.flatMap((node) =>
    shouldCreateArtifactForReadyNode(node)
      ? [artifactForNode(document, node)]
      : [],
  );

  return {
    ...document,
    artifacts: mergeArtifacts(document.artifacts, artifacts),
    nodes: document.nodes.map((node) =>
      ready.has(node.id)
        ? { ...node, runtimeState: runtimeStateForReadyNode(document, node) }
        : node,
    ),
  };
}

export async function executeWorkflowStepAsync(
  document: WorkflowDocument,
  options: WorkflowStepExecutionOptions = {},
): Promise<WorkflowDocument> {
  return startWorkflowStepExecution(document, options).finished;
}

export function startWorkflowStepExecution(
  document: WorkflowDocument,
  options: WorkflowStepExecutionOptions = {},
): WorkflowStepExecution {
  const ready = new Set(
    getReadyNodeIds(document, {
      includeUnsafe: options.includeUnsafe,
      nodeIds: options.nodeIds,
    }),
  );
  if (ready.size === 0) {
    return { document, finished: Promise.resolve(document) };
  }

  const readyNodes = document.nodes.filter((node) => ready.has(node.id));
  const providerNodes = readyNodes.filter((node) =>
    shouldExecuteWithAsyncRuntime(node, options),
  );
  const providerIds = new Set(providerNodes.map((node) => node.id));
  const immediateArtifacts = readyNodes.flatMap((node) =>
    !providerIds.has(node.id) && shouldCreateArtifactForReadyNode(node)
      ? [artifactForNode(document, node)]
      : [],
  );

  const started: WorkflowDocument = {
    ...document,
    artifacts: mergeArtifacts(document.artifacts, immediateArtifacts),
    nodes: document.nodes.map((node) => {
      if (!ready.has(node.id)) return node;
      if (providerIds.has(node.id)) {
        const message = `Running ${node.title}`;
        return {
          ...node,
          runtimeState: {
            status: "running",
            message,
            logs: appendRuntimeLog(node.runtimeState, {
              event: "running",
              message,
              at: runtimeEventTime(options),
            }),
          },
        };
      }
      return {
        ...node,
        runtimeState: runtimeStateForReadyNode(document, node),
      };
    }),
  };

  if (providerNodes.length === 0) {
    return { document: started, finished: Promise.resolve(started) };
  }

  return {
    document: started,
    finished: finishProviderNodes(document, started, providerNodes, options),
  };
}

export function executeWorkflowUntilBlocked(
  document: WorkflowDocument,
  options: { maxSteps?: number } = {},
): WorkflowDocument {
  const maxSteps = Math.max(
    1,
    options.maxSteps ?? Math.max(document.nodes.length * 2, 1),
  );
  let current = document;

  for (let step = 0; step < maxSteps; step += 1) {
    if (getReadyNodeIds(current).length === 0) return current;
    const next = executeWorkflowStep(current);
    if (next === current) return current;
    current = next;
  }

  return current;
}

export function resetWorkflowRuntime(
  document: WorkflowDocument,
): WorkflowDocument {
  return {
    ...document,
    artifacts: [],
    nodes: document.nodes.map((node) => ({
      ...node,
      runtimeState: { status: "idle" },
    })),
  };
}

type ProviderNodeResult =
  | { nodeId: string; artifact: WorkflowArtifact }
  | { nodeId: string; cancelled: true }
  | { nodeId: string; failure: WorkflowProviderFailure };

async function finishProviderNodes(
  document: WorkflowDocument,
  started: WorkflowDocument,
  providerNodes: WorkflowNode[],
  options: WorkflowStepExecutionOptions,
): Promise<WorkflowDocument> {
  let progressDocument = started;
  const reportNodeProgress = (
    nodeId: string,
    update: WorkflowProgressUpdate,
  ) => {
    if (options.signal?.aborted) return;
    progressDocument = updateNodeRuntimeState(
      progressDocument,
      nodeId,
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

  const results = await Promise.all(
    providerNodes.map((node) =>
      executeProviderNode(document, node, options, reportNodeProgress),
    ),
  );
  const resultByNodeId = new Map(
    results.map((result) => [result.nodeId, result]),
  );
  const artifacts = results.flatMap((result) =>
    "artifact" in result ? [result.artifact] : [],
  );

  return {
    ...progressDocument,
    artifacts: mergeArtifacts(progressDocument.artifacts, artifacts),
    nodes: progressDocument.nodes.map((node) => {
      const result = resultByNodeId.get(node.id);
      if (!result) return node;
      if ("cancelled" in result) {
        const message = "Execution cancelled";
        return {
          ...node,
          runtimeState: {
            status: "cancelled",
            message,
            logs: appendRuntimeLog(node.runtimeState, {
              event: "cancelled",
              message,
              at: runtimeEventTime(options),
            }),
          },
        };
      }
      if ("failure" in result) {
        return {
          ...node,
          runtimeState: failedRuntimeState(
            node.runtimeState,
            result.failure,
            options,
          ),
        };
      }
      return {
        ...node,
        runtimeState: completedRuntimeStateForArtifact(
          node,
          result.artifact,
          node.runtimeState,
          options,
        ),
      };
    }),
  };
}

async function executeProviderNode(
  document: WorkflowDocument,
  node: WorkflowNode,
  options: WorkflowStepExecutionOptions,
  reportNodeProgress: (nodeId: string, update: WorkflowProgressUpdate) => void,
): Promise<ProviderNodeResult> {
  const createProviderArtifact =
    options.createProviderArtifact ??
    ((doc, workflowNode, context) =>
      createWorkflowProviderArtifactAsync(doc, workflowNode, {
        reportProgress: context.reportProgress,
        signal: context.signal,
      }));
  const context = {
    signal: options.signal,
    reportProgress: (update: WorkflowProgressUpdate) =>
      reportNodeProgress(node.id, update),
  };

  if (context.signal?.aborted) return { nodeId: node.id, cancelled: true };

  try {
    const createdArtifact =
      node.type === "httpRequest" && options.executeHttpRequest
        ? await httpArtifactForNode(document, node, options, context)
        : ((await createProviderArtifact(document, node, context)) ??
          placeholderArtifactForNode(document, node));
    if (context.signal?.aborted) return { nodeId: node.id, cancelled: true };

    const artifact = await persistProviderArtifact(
      createdArtifact,
      document,
      node,
      options,
    );
    if (context.signal?.aborted) return { nodeId: node.id, cancelled: true };
    return { nodeId: node.id, artifact };
  } catch (error) {
    if (isAbortError(error, context.signal)) {
      return { nodeId: node.id, cancelled: true };
    }
    return {
      nodeId: node.id,
      failure: classifyWorkflowProviderError(error, context.signal),
    };
  }
}

async function httpArtifactForNode(
  document: WorkflowDocument,
  node: WorkflowNode,
  options: WorkflowStepExecutionOptions,
  context: WorkflowProviderExecutionRuntimeContext,
): Promise<WorkflowArtifact> {
  if (!options.executeHttpRequest)
    return placeholderArtifactForNode(document, node);
  const request = httpRequestForNode(document, node);
  context.reportProgress({ message: "Sending HTTP request", progress: 0.1 });
  const output = await options.executeHttpRequest({
    document,
    node,
    method: request.method,
    url: request.url,
    headers: request.headers,
    ...(request.body !== undefined ? { body: request.body } : {}),
    signal: context.signal,
    reportProgress: context.reportProgress,
  });
  context.reportProgress({ message: "HTTP response received", progress: 0.9 });
  return httpArtifactForOutput(document, node, request, output);
}
function shouldExecuteWithAsyncRuntime(
  node: WorkflowNode,
  options: WorkflowStepExecutionOptions,
): boolean {
  if (node.type === "httpRequest" && options.executeHttpRequest) return true;
  return getWorkflowProviderAdapter(node) !== null;
}
