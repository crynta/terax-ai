import {
  artifactForNode,
  artifactPreviewForNode,
  collectNodeInputArtifacts,
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
  WorkflowVariable,
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
        if (source?.runtimeState.status !== "completed") return false;
        const sourceArtifactIds = source.runtimeState.artifactIds ?? [];
        if (sourceArtifactIds.length === 0) return true;
        const idSet = new Set(sourceArtifactIds);
        return document.artifacts.some(
          (a) => idSet.has(a.id) && a.portId === edge.sourcePortId,
        );
      });
    })
    .map((node) => node.id);
}

// ---------------------------------------------------------------------------
// Expression resolution and condition evaluation
// ---------------------------------------------------------------------------

function resolveExpressions(
  text: string,
  variables: WorkflowVariable[],
): string {
  return text.replace(/\{\{variables\.(\w+)\}\}/g, (_match, name: string) => {
    const variable = variables.find((v) => v.name === name);
    return variable?.value !== undefined ? String(variable.value) : "";
  });
}

function artifactTextValue(artifact: WorkflowArtifact | undefined): string {
  if (!artifact) return "";
  return typeof artifact.value === "string" ? artifact.value : artifact.preview;
}

function evaluateCondition(
  input: string,
  operator: string,
  value: string,
): boolean {
  switch (operator) {
    case "contains":
      return input.includes(value);
    case "equals":
      return input === value;
    case "startsWith":
      return input.startsWith(value);
    case "endsWith":
      return input.endsWith(value);
    default:
      return input === value;
  }
}

// ---------------------------------------------------------------------------
// Node-type-specific artifact creation
// ---------------------------------------------------------------------------

function createNodeArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  switch (node.type) {
    case "textPrompt":
      return createTextPromptArtifacts(document, node);
    case "delay":
      return createDelayArtifacts(document, node);
    case "webhook":
      return createWebhookArtifacts(document, node);
    case "schedule":
      return createScheduleArtifacts(document, node);
    case "if":
      return createIfArtifacts(document, node);
    case "switch":
      return createSwitchArtifacts(document, node);
    case "merge":
      return createMergeArtifacts(document, node);
    case "textTransform":
      return createTextTransformArtifacts(document, node);
    case "setVariable":
      return createSetVariableArtifacts(document, node);
    case "getVariable":
      return createGetVariableArtifacts(document, node);
    default:
      return [artifactForNode(document, node)];
  }
}

function createTextPromptArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const output = node.outputs[0];
  const prompt = String(node.config.prompt ?? "");
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: prompt,
      value: prompt,
    },
  ];
}

function createDelayArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const seconds = Number(node.config.seconds ?? 0);
  const output = node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: `Delayed ${seconds}s`,
      value: `Delayed ${seconds}s`,
    },
  ];
}

function createWebhookArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const path = String(node.config.path ?? "/");
  const method = String(node.config.method ?? "POST");
  const ports = node.outputs;
  return [
    {
      id: `${document.id}:${node.id}:body`,
      nodeId: node.id,
      portId: ports.find((p) => p.id === "body")?.id ?? "body",
      type: "json",
      label: node.title,
      preview: "Webhook body",
      value: { trigger: true, path },
    },
    {
      id: `${document.id}:${node.id}:headers`,
      nodeId: node.id,
      portId: ports.find((p) => p.id === "headers")?.id ?? "headers",
      type: "json",
      label: node.title,
      preview: "Webhook headers",
      value: { "content-type": "application/json", "x-webhook-method": method },
    },
    {
      id: `${document.id}:${node.id}:trigger`,
      nodeId: node.id,
      portId: ports.find((p) => p.id === "trigger")?.id ?? "trigger",
      type: "text",
      label: node.title,
      preview: "Webhook trigger",
      value: "triggered",
    },
  ];
}

function createScheduleArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const cron = String(node.config.cron ?? "");
  const output = node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: cron ? `Schedule: ${cron}` : "Schedule trigger ready",
      value: cron,
    },
  ];
}

function createIfArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const inputArts = collectNodeInputArtifacts(document, node);
  const textArt = inputArts.find((a) => a.type === "text");
  const inputText = artifactTextValue(textArt);
  const operator = String(node.config.operator ?? "equals");
  const rawValue = String(node.config.value ?? "");
  const value = resolveExpressions(rawValue, document.variables);
  const result = evaluateCondition(inputText, operator, value);
  const portId = result ? "true" : "false";
  const port = node.outputs.find((p) => p.id === portId) ?? node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: port?.id,
      type: port?.type ?? "text",
      label: node.title,
      preview: artifactPreviewForNode(node),
      value: inputText,
    },
  ];
}

function createSwitchArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const inputArts = collectNodeInputArtifacts(document, node);
  const textArt = inputArts.find((a) => a.type === "text");
  const inputText = artifactTextValue(textArt);
  const operator = String(node.config.operator ?? "equals");
  const rawCases = String(node.config.cases ?? "");
  const resolvedCases = resolveExpressions(rawCases, document.variables);
  const cases = resolvedCases.split("\n");

  let matchPortId = "default";
  for (let i = 0; i < cases.length; i++) {
    const caseValue = cases[i];
    if (caseValue && evaluateCondition(inputText, operator, caseValue)) {
      matchPortId = `case_${i + 1}`;
      break;
    }
  }

  const port =
    node.outputs.find((p) => p.id === matchPortId) ?? node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: port?.id,
      type: port?.type ?? "text",
      label: node.title,
      preview: artifactPreviewForNode(node),
      value: inputText,
    },
  ];
}

function createMergeArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const separator = String(node.config.separator ?? "\n");
  const portA = node.inputs.find((p) => p.id === "text_a");
  const portB = node.inputs.find((p) => p.id === "text_b");

  const artA = inputArtifactForPort(document, node, portA?.id ?? "text_a");
  const artB = inputArtifactForPort(document, node, portB?.id ?? "text_b");
  const textA = artifactTextValue(artA);
  const textB = artifactTextValue(artB);
  const merged = [textA, textB].filter((t) => t.length > 0).join(separator);

  const output = node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: artifactPreviewForNode(node),
      value: merged,
    },
  ];
}

function createTextTransformArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const inputArts = collectNodeInputArtifacts(document, node);
  const textArt = inputArts.find((a) => a.type === "text");
  const inputText = artifactTextValue(textArt);
  const template = String(node.config.template ?? "{{input}}");
  const result = template.replace(/\{\{input\}\}/g, inputText);

  const output = node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: artifactPreviewForNode(node),
      value: result,
    },
  ];
}

function createSetVariableArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const inputArts = collectNodeInputArtifacts(document, node);
  const textArt = inputArts.find((a) => a.type === "text");
  const value = artifactTextValue(textArt);

  const output = node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: artifactPreviewForNode(node),
      value,
    },
  ];
}

function createGetVariableArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const varName = String(node.config.variableName ?? "");
  const variable = document.variables.find((v) => v.name === varName);
  const value = variable?.value !== undefined ? String(variable.value) : "";

  const output = node.outputs[0];
  return [
    {
      id: workflowArtifactId(document, node),
      nodeId: node.id,
      portId: output?.id,
      type: output?.type ?? "text",
      label: node.title,
      preview: artifactPreviewForNode(node),
      value,
    },
  ];
}

function inputArtifactForPort(
  document: WorkflowDocument,
  node: WorkflowNode,
  portId: string,
): WorkflowArtifact | undefined {
  const edge = document.edges.find(
    (e) => e.targetNodeId === node.id && e.targetPortId === portId,
  );
  if (!edge) return undefined;
  const source = document.nodes.find((n) => n.id === edge.sourceNodeId);
  if (!source) return undefined;
  const sourceArtifactIds = new Set(source.runtimeState.artifactIds ?? []);
  const candidates = document.artifacts.filter((a) =>
    sourceArtifactIds.has(a.id),
  );
  return (
    candidates.find((a) => a.portId === edge.sourcePortId) ?? candidates[0]
  );
}

function workflowArtifactId(
  document: WorkflowDocument,
  node: WorkflowNode,
): string {
  const outputType = node.outputs[0]?.type ?? "json";
  return `${document.id}:${node.id}:${outputType}`;
}

export function executeWorkflowStep(
  document: WorkflowDocument,
): WorkflowDocument {
  const ready = new Set(getReadyNodeIds(document));
  if (ready.size === 0) return document;

  const readyNodes = document.nodes.filter((node) => ready.has(node.id));
  const artifactsByNode = new Map<string, WorkflowArtifact[]>();
  let updatedVariables = document.variables;

  for (const node of readyNodes) {
    if (!shouldCreateArtifactForReadyNode(node)) continue;
    const nodeArtifacts = createNodeArtifacts(document, node);
    artifactsByNode.set(node.id, nodeArtifacts);

    if (node.type === "setVariable") {
      const varName = String(node.config.variableName ?? "");
      if (varName) {
        const inputArts = collectNodeInputArtifacts(document, node);
        const textArt = inputArts.find((a) => a.type === "text");
        const value = textArt
          ? typeof textArt.value === "string"
            ? textArt.value
            : textArt.preview
          : "";
        const existingIdx = updatedVariables.findIndex(
          (v) => v.name === varName,
        );
        if (existingIdx >= 0) {
          updatedVariables = updatedVariables.map((v, i) =>
            i === existingIdx ? { ...v, value } : v,
          );
        } else {
          updatedVariables = [
            ...updatedVariables,
            {
              id: `var_${varName}`,
              name: varName,
              type: "text" as const,
              value,
            },
          ];
        }
      }
    }
  }

  const allArtifacts = Array.from(artifactsByNode.values()).flat();

  return {
    ...document,
    variables: updatedVariables,
    artifacts: mergeArtifacts(document.artifacts, allArtifacts),
    nodes: document.nodes.map((node) => {
      if (!ready.has(node.id)) return node;
      const nodeArts = artifactsByNode.get(node.id);
      const baseState = runtimeStateForReadyNode(document, node);
      if (nodeArts && nodeArts.length > 0) {
        return {
          ...node,
          runtimeState: {
            ...baseState,
            artifactIds: nodeArts.map((a) => a.id),
          },
        };
      }
      return { ...node, runtimeState: baseState };
    }),
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
