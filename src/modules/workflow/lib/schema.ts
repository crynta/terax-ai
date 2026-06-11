import { workflowNodeTemplate } from "./schemaTemplates";
export const WORKFLOW_DOCUMENT_VERSION = 1;

export type WorkflowPortType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "terminal"
  | "json"
  | "command"
  | "agent";

export type WorkflowNodeType =
  | "textPrompt"
  | "imageGeneration"
  | "videoGeneration"
  | "audioGeneration"
  | "output"
  | "terminal"
  | "shellCommand"
  | "agent"
  | "httpRequest"
  | "fileOperation"
  | "browserAutomation"
  | "textTransform"
  | "jsonExtract"
  | "jsonBuild"
  | "if"
  | "switch"
  | "merge"
  | "retry"
  | "errorBranch"
  | "humanApproval"
  | "forEach"
  | "setVariable"
  | "getVariable"
  | "delay"
  | "webhook"
  | "schedule"
  | "comment"
  | "reroute"
  | "group"
  | "subgraph";

export type WorkflowRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowRuntimeErrorCode =
  | "auth"
  | "cancelled"
  | "quota"
  | "timeout"
  | "unknown";

export type WorkflowRuntimeLogEntry = {
  event:
    | "queued"
    | "retry"
    | "running"
    | "progress"
    | "completed"
    | "failed"
    | "cancelled";
  message: string;
  at?: string;
};

export type WorkflowPoint = {
  x: number;
  y: number;
};

export type WorkflowSize = {
  width: number;
  height: number;
};

export type WorkflowViewport = WorkflowPoint & {
  zoom: number;
};

export type WorkflowPort = {
  id: string;
  type: WorkflowPortType;
  label: string;
};

export type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  title: string;
  position: WorkflowPoint;
  size: WorkflowSize;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  config: Record<string, unknown>;
  runtimeState: {
    status: WorkflowRuntimeStatus;
    message?: string;
    progress?: number;
    artifactIds?: string[];
    attempt?: number;
    logs?: WorkflowRuntimeLogEntry[];
    errorCode?: WorkflowRuntimeErrorCode;
  };
  uiState: {
    collapsed?: boolean;
    expanded?: boolean;
    childNodeIds?: string[];
  };
};

export type WorkflowEdge = {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
};

export type WorkflowVariable = {
  id: string;
  name: string;
  type: WorkflowPortType;
  value?: unknown;
};

export type WorkflowArtifactStorage = {
  kind: "inline" | "file";
  path?: string;
  mediaType?: string;
  byteLength?: number;
  thumbnailPath?: string;
};

export type WorkflowArtifact = {
  id: string;
  nodeId: string;
  portId?: string;
  type: WorkflowPortType;
  label: string;
  preview: string;
  value?: unknown;
  storage?: WorkflowArtifactStorage;
};

export type WorkflowRunHistoryEntry = {
  id: string;
  status: string;
  nodeCount: number;
  completedCount: number;
  failedCount: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  nodeResults?: Record<
    string,
    {
      status: string;
      durationMs?: number | null;
      artifactCount: number;
    }
  >;
  nodeSnapshots?: Array<{
    nodeId: string;
    status: string;
    title?: string;
    duration?: number | null;
    artifactCount: number;
    error?: string | null;
  }>;
};

export type WorkflowDocument = {
  id: string;
  title: string;
  version: typeof WORKFLOW_DOCUMENT_VERSION;
  viewport: WorkflowViewport;
  variables: WorkflowVariable[];
  artifacts: WorkflowArtifact[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runHistory?: WorkflowRunHistoryEntry[];
};

export type CreateWorkflowNodeInput = {
  id: string;
  type: WorkflowNodeType;
  position: WorkflowPoint;
  title?: string;
};

export function createWorkflowNode(
  input: CreateWorkflowNodeInput,
): WorkflowNode {
  const template = workflowNodeTemplate(input.type);
  return {
    id: input.id,
    type: input.type,
    title: input.title ?? template.title,
    position: input.position,
    size: template.size,
    inputs: template.inputs,
    outputs: template.outputs,
    config: template.config,
    runtimeState: { status: "idle" },
    uiState: template.uiState,
  };
}

export function addWorkflowNode(
  document: WorkflowDocument,
  input: CreateWorkflowNodeInput,
): WorkflowDocument {
  return {
    ...document,
    nodes: [...document.nodes, createWorkflowNode(input)],
  };
}

export function duplicateWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
): WorkflowDocument {
  const source = document.nodes.find((node) => node.id === nodeId);
  if (!source) return document;

  const duplicate: WorkflowNode = {
    ...source,
    id: nextWorkflowNodeId(document, source.type),
    title: `${source.title} Copy`,
    position: { x: source.position.x + 48, y: source.position.y + 48 },
    inputs: source.inputs.map((port) => ({ ...port })),
    outputs: source.outputs.map((port) => ({ ...port })),
    config: { ...source.config },
    runtimeState: { status: "idle" },
    uiState: { ...source.uiState },
  };

  return {
    ...document,
    nodes: [...document.nodes, duplicate],
  };
}

export function removeWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
): WorkflowDocument {
  if (!document.nodes.some((node) => node.id === nodeId)) return document;

  const removedArtifactIds = new Set(
    document.artifacts
      .filter((artifact) => artifact.nodeId === nodeId)
      .map((artifact) => artifact.id),
  );

  return {
    ...document,
    artifacts: document.artifacts.filter(
      (artifact) => artifact.nodeId !== nodeId,
    ),
    nodes: document.nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => pruneWorkflowNodeArtifacts(node, removedArtifactIds)),
    edges: document.edges.filter(
      (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
    ),
  };
}

export function clearWorkflowCanvas(
  document: WorkflowDocument,
): WorkflowDocument {
  return {
    ...document,
    artifacts: [],
    nodes: [],
    edges: [],
  };
}

function pruneWorkflowNodeArtifacts(
  node: WorkflowNode,
  removedArtifactIds: Set<string>,
): WorkflowNode {
  const artifactIds = node.runtimeState.artifactIds;
  if (!artifactIds || removedArtifactIds.size === 0) return node;

  const nextArtifactIds = artifactIds.filter(
    (artifactId) => !removedArtifactIds.has(artifactId),
  );
  if (nextArtifactIds.length === artifactIds.length) return node;

  const { artifactIds: _removedArtifactIds, ...runtimeState } =
    node.runtimeState;
  return {
    ...node,
    runtimeState:
      nextArtifactIds.length > 0
        ? { ...runtimeState, artifactIds: nextArtifactIds }
        : runtimeState,
  };
}

export function updateWorkflowNodeConfig(
  document: WorkflowDocument,
  nodeId: string,
  patch: Record<string, unknown>,
): WorkflowDocument {
  if (!document.nodes.some((node) => node.id === nodeId)) return document;

  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, config: { ...node.config, ...patch } }
        : node,
    ),
  };
}

export function nextWorkflowNodeId(
  document: WorkflowDocument,
  type: WorkflowNodeType,
): string {
  const prefix = `node_${type}_`;
  const used = new Set(document.nodes.map((node) => node.id));
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export type ParseWorkflowDocumentJsonResult =
  | { ok: true; document: WorkflowDocument }
  | { ok: false; errors: string[] };

export function serializeWorkflowDocument(document: WorkflowDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function serializeWorkflowDocumentForPersistence(
  document: WorkflowDocument,
): string {
  return serializeWorkflowDocument(workflowPersistenceSnapshot(document));
}

export function workflowPersistenceSnapshot(
  document: WorkflowDocument,
): WorkflowDocument {
  return normalizeImportedWorkflowDocument(document);
}

export function parseWorkflowDocumentJson(
  json: string,
): ParseWorkflowDocumentJsonResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["Workflow JSON is not valid JSON"] };
  }

  const migrated = migrateWorkflowDocumentInput(value);
  const shapeErrors = workflowDocumentShapeErrors(migrated);
  if (shapeErrors.length > 0) return { ok: false, errors: shapeErrors };

  const document = normalizeImportedWorkflowDocument(
    migrated as WorkflowDocument,
  );
  const validationErrors = validateWorkflowDocument(document);
  if (validationErrors.length > 0) {
    return { ok: false, errors: validationErrors };
  }

  return { ok: true, document };
}

function migrateWorkflowDocumentInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    version:
      value.version === undefined || value.version === 0
        ? WORKFLOW_DOCUMENT_VERSION
        : value.version,
    viewport: isRecord(value.viewport)
      ? value.viewport
      : { x: 0, y: 0, zoom: 1 },
    variables: Array.isArray(value.variables) ? value.variables : [],
    artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
    nodes: Array.isArray(value.nodes)
      ? value.nodes.map(migrateWorkflowNodeInput)
      : value.nodes,
    edges: Array.isArray(value.edges) ? value.edges : [],
    runHistory: Array.isArray(value.runHistory) ? value.runHistory : [],
  };
}

function migrateWorkflowNodeInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const type = value.type;
  const template = isWorkflowNodeType(type) ? workflowNodeTemplate(type) : null;
  return {
    ...value,
    title:
      typeof value.title === "string" && value.title.length > 0
        ? value.title
        : (template?.title ?? value.title),
    position: isPoint(value.position) ? value.position : { x: 0, y: 0 },
    size: isSize(value.size) ? value.size : (template?.size ?? value.size),
    inputs: Array.isArray(value.inputs)
      ? value.inputs
      : (template?.inputs.map((port) => ({ ...port })) ?? value.inputs),
    outputs: Array.isArray(value.outputs)
      ? value.outputs
      : (template?.outputs.map((port) => ({ ...port })) ?? value.outputs),
    config: isRecord(value.config) ? value.config : (template?.config ?? {}),
    runtimeState: isRecord(value.runtimeState)
      ? value.runtimeState
      : { status: "idle" },
    uiState: isRecord(value.uiState)
      ? value.uiState
      : (template?.uiState ?? {}),
  };
}

export function createStarterWorkflowDocument(input: {
  id: string;
  title: string;
}): WorkflowDocument {
  return {
    id: input.id,
    title: input.title,
    version: WORKFLOW_DOCUMENT_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
    variables: [],
    artifacts: [],
    nodes: [
      {
        id: "node_prompt",
        type: "textPrompt",
        title: "Prompt",
        position: { x: 80, y: 120 },
        size: { width: 260, height: 150 },
        inputs: [],
        outputs: [{ id: "text", type: "text", label: "Text" }],
        config: { prompt: "A cinematic robot pianist in a neon studio" },
        runtimeState: { status: "idle" },
        uiState: {},
      },
      {
        id: "node_image",
        type: "imageGeneration",
        title: "Image Generation",
        position: { x: 420, y: 100 },
        size: { width: 300, height: 190 },
        inputs: [{ id: "prompt", type: "text", label: "Prompt" }],
        outputs: [{ id: "image", type: "image", label: "Image" }],
        config: { provider: "placeholder", model: "image" },
        runtimeState: { status: "idle" },
        uiState: {},
      },
      {
        id: "node_output",
        type: "output",
        title: "Output",
        position: { x: 800, y: 120 },
        size: { width: 260, height: 170 },
        inputs: [
          { id: "media", type: "image", label: "Media" },
          { id: "audio", type: "audio", label: "Audio" },
          { id: "video", type: "video", label: "Video" },
        ],
        outputs: [],
        config: {},
        runtimeState: { status: "idle" },
        uiState: {},
      },
      {
        id: "node_terminal",
        type: "terminal",
        title: "Terminal",
        position: { x: 420, y: 370 },
        size: { width: 420, height: 240 },
        inputs: [{ id: "command", type: "command", label: "Command" }],
        outputs: [{ id: "terminal", type: "terminal", label: "Session" }],
        config: { mode: "interactive" },
        runtimeState: { status: "idle" },
        uiState: { collapsed: true },
      },
    ],
    edges: [
      {
        id: "edge_prompt_image",
        sourceNodeId: "node_prompt",
        sourcePortId: "text",
        targetNodeId: "node_image",
        targetPortId: "prompt",
      },
      {
        id: "edge_image_output",
        sourceNodeId: "node_image",
        sourcePortId: "image",
        targetNodeId: "node_output",
        targetPortId: "media",
      },
    ],
    runHistory: [],
  };
}

function normalizeImportedWorkflowDocument(
  document: WorkflowDocument,
): WorkflowDocument {
  return {
    id: document.id,
    title: document.title,
    version: WORKFLOW_DOCUMENT_VERSION,
    viewport: normalizeViewport(document.viewport),
    variables: document.variables.map((variable) => ({ ...variable })),
    artifacts: [],
    nodes: document.nodes.map((node) => ({
      ...node,
      position: normalizePoint(node.position),
      size: normalizeSize(node.size),
      inputs: node.inputs.map((port) => ({ ...port })),
      outputs: node.outputs.map((port) => ({ ...port })),
      config: isRecord(node.config) ? { ...node.config } : {},
      runtimeState: { status: "idle" },
      uiState: isRecord(node.uiState) ? { ...node.uiState } : {},
    })),
    edges: document.edges.map((edge) => ({ ...edge })),
    runHistory: Array.isArray(document.runHistory)
      ? document.runHistory.map((entry) => ({ ...entry }))
      : [],
  };
}

export function validateWorkflowDocument(document: WorkflowDocument): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of document.nodes) {
    if (nodeIds.has(node.id)) duplicateNodeIds.add(node.id);
    nodeIds.add(node.id);
  }
  for (const id of duplicateNodeIds) errors.push(`Duplicate node id: ${id}`);

  for (const edge of document.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);

    const sourceNode = document.nodes.find(
      (node) => node.id === edge.sourceNodeId,
    );
    const targetNode = document.nodes.find(
      (node) => node.id === edge.targetNodeId,
    );

    if (!sourceNode) {
      errors.push(`Edge ${edge.id} sources missing node ${edge.sourceNodeId}`);
      continue;
    }
    if (!targetNode) {
      errors.push(`Edge ${edge.id} targets missing node ${edge.targetNodeId}`);
      continue;
    }

    const sourcePort = sourceNode.outputs.find(
      (port) => port.id === edge.sourcePortId,
    );
    const targetPort = targetNode.inputs.find(
      (port) => port.id === edge.targetPortId,
    );
    if (!sourcePort) {
      errors.push(
        `Edge ${edge.id} sources missing port ${edge.sourceNodeId}.${edge.sourcePortId}`,
      );
    }
    if (!targetPort) {
      errors.push(
        `Edge ${edge.id} targets missing port ${edge.targetNodeId}.${edge.targetPortId}`,
      );
    }
    if (sourcePort && targetPort && sourcePort.type !== targetPort.type) {
      errors.push(
        `Edge ${edge.id} connects incompatible ports ${sourcePort.type} -> ${targetPort.type}`,
      );
    }
  }

  return errors;
}

const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  "textPrompt",
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
  "output",
  "terminal",
  "shellCommand",
  "agent",
  "httpRequest",
  "fileOperation",
  "browserAutomation",
  "textTransform",
  "jsonExtract",
  "jsonBuild",
  "if",
  "switch",
  "merge",
  "retry",
  "errorBranch",
  "humanApproval",
  "forEach",
  "setVariable",
  "getVariable",
  "delay",
  "webhook",
  "schedule",
  "comment",
  "reroute",
  "group",
  "subgraph",
];

const WORKFLOW_PORT_TYPES: WorkflowPortType[] = [
  "text",
  "image",
  "video",
  "audio",
  "file",
  "terminal",
  "json",
  "command",
  "agent",
];

function workflowDocumentShapeErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["Workflow JSON must be an object"];

  const errors: string[] = [];
  if (typeof value.id !== "string" || value.id.length === 0) {
    errors.push("Workflow id must be a non-empty string");
  }
  if (typeof value.title !== "string" || value.title.length === 0) {
    errors.push("Workflow title must be a non-empty string");
  }
  if (typeof value.version !== "number") {
    errors.push("Workflow version must be a number");
  } else if (value.version > WORKFLOW_DOCUMENT_VERSION) {
    errors.push(
      `Workflow version ${value.version} is newer than supported version ${WORKFLOW_DOCUMENT_VERSION}`,
    );
  } else if (value.version !== WORKFLOW_DOCUMENT_VERSION) {
    errors.push(`Workflow version must be ${WORKFLOW_DOCUMENT_VERSION}`);
  }
  if (!isViewport(value.viewport)) errors.push("Workflow viewport is invalid");
  if (!Array.isArray(value.variables))
    errors.push("Workflow variables must be an array");
  if (!Array.isArray(value.artifacts))
    errors.push("Workflow artifacts must be an array");
  if (!Array.isArray(value.nodes)) {
    errors.push("Workflow nodes must be an array");
  } else {
    for (const node of value.nodes)
      errors.push(...workflowNodeShapeErrors(node));
  }
  if (!Array.isArray(value.edges)) {
    errors.push("Workflow edges must be an array");
  } else {
    for (const edge of value.edges)
      errors.push(...workflowEdgeShapeErrors(edge));
  }

  return errors;
}

function workflowNodeShapeErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["Workflow node must be an object"];
  const nodeLabel = typeof value.id === "string" ? value.id : "<unknown>";
  const errors: string[] = [];
  if (typeof value.id !== "string" || value.id.length === 0) {
    errors.push("Workflow node id must be a non-empty string");
  }
  if (!isWorkflowNodeType(value.type)) {
    errors.push(`Workflow node ${nodeLabel} has unknown type`);
  }
  if (typeof value.title !== "string" || value.title.length === 0) {
    errors.push(`Workflow node ${nodeLabel} title must be a non-empty string`);
  }
  if (!isPoint(value.position)) {
    errors.push(`Workflow node ${nodeLabel} position is invalid`);
  }
  if (!isSize(value.size)) {
    errors.push(`Workflow node ${nodeLabel} size is invalid`);
  }
  if (!Array.isArray(value.inputs)) {
    errors.push(`Workflow node ${nodeLabel} inputs must be an array`);
  } else {
    for (const port of value.inputs) {
      if (!isWorkflowPort(port)) {
        errors.push(`Workflow node ${nodeLabel} has an invalid input port`);
      }
    }
  }
  if (!Array.isArray(value.outputs)) {
    errors.push(`Workflow node ${nodeLabel} outputs must be an array`);
  } else {
    for (const port of value.outputs) {
      if (!isWorkflowPort(port)) {
        errors.push(`Workflow node ${nodeLabel} has an invalid output port`);
      }
    }
  }
  if (!isRecord(value.config)) {
    errors.push(`Workflow node ${nodeLabel} config must be an object`);
  }
  if (!isRecord(value.runtimeState)) {
    errors.push(`Workflow node ${nodeLabel} runtime state must be an object`);
  }
  if (!isRecord(value.uiState)) {
    errors.push(`Workflow node ${nodeLabel} UI state must be an object`);
  }
  return errors;
}

function workflowEdgeShapeErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["Workflow edge must be an object"];
  const errors: string[] = [];
  if (typeof value.id !== "string" || value.id.length === 0) {
    errors.push("Workflow edge id must be a non-empty string");
  }
  for (const key of [
    "sourceNodeId",
    "sourcePortId",
    "targetNodeId",
    "targetPortId",
  ]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      errors.push(
        `Workflow edge ${String(value.id ?? "<unknown>")} ${key} must be a non-empty string`,
      );
    }
  }
  return errors;
}

function normalizeViewport(viewport: WorkflowViewport): WorkflowViewport {
  return {
    x: finiteNumberOr(viewport.x, 0),
    y: finiteNumberOr(viewport.y, 0),
    zoom:
      Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1,
  };
}

function normalizePoint(point: WorkflowPoint): WorkflowPoint {
  return { x: finiteNumberOr(point.x, 0), y: finiteNumberOr(point.y, 0) };
}

function normalizeSize(size: WorkflowSize): WorkflowSize {
  return {
    width: finitePositiveNumberOr(size.width, 240),
    height: finitePositiveNumberOr(size.height, 120),
  };
}

function finiteNumberOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finitePositiveNumberOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isWorkflowNodeType(value: unknown): value is WorkflowNodeType {
  return WORKFLOW_NODE_TYPES.includes(value as WorkflowNodeType);
}

function isWorkflowPortType(value: unknown): value is WorkflowPortType {
  return WORKFLOW_PORT_TYPES.includes(value as WorkflowPortType);
}

function isWorkflowPort(value: unknown): value is WorkflowPort {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    isWorkflowPortType(value.type) &&
    typeof value.label === "string" &&
    value.label.length > 0
  );
}

function isViewport(value: unknown): value is WorkflowViewport {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.zoom) &&
    value.zoom > 0
  );
}

function isPoint(value: unknown): value is WorkflowPoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function isSize(value: unknown): value is WorkflowSize {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSubgraphDepth(
  document: WorkflowDocument,
  nodeId: string,
  maxDepth = 5,
): string[] {
  const errors: string[] = [];
  const visited = new Set<string>();

  function walk(id: string, depth: number): void {
    if (visited.has(id)) return;
    visited.add(id);
    const node = document.nodes.find((n) => n.id === id);
    if (node?.type !== "subgraph") return;
    if (depth > maxDepth) {
      errors.push(
        `Subgraph nesting exceeds maximum depth (${maxDepth}) at node ${id}`,
      );
      return;
    }
    const childIds = node.uiState.childNodeIds ?? [];
    for (const childId of childIds) {
      walk(childId, depth + 1);
    }
  }

  walk(nodeId, 0);
  return errors;
}

export function workflowConnectionWarnings(
  document: WorkflowDocument,
): string[] {
  const warnings: string[] = [];
  const nodeIds = new Set(document.nodes.map((n) => n.id));
  const nodeInputs = new Map<string, Set<string>>();
  for (const node of document.nodes) {
    nodeInputs.set(node.id, new Set(node.inputs.map((p) => p.id)));
  }
  const connectedInputs = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      continue;
    }
    let set = connectedInputs.get(edge.targetNodeId);
    if (!set) {
      set = new Set();
      connectedInputs.set(edge.targetNodeId, set);
    }
    set.add(edge.targetPortId);
  }
  for (const node of document.nodes) {
    const inputs = nodeInputs.get(node.id);
    const connected = connectedInputs.get(node.id);
    if (!inputs) continue;
    for (const portId of inputs) {
      if (!connected?.has(portId)) {
        warnings.push(
          `Node "${node.title}" (${node.id}) has unconnected input "${portId}"`,
        );
      }
    }
  }
  return warnings;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

export function nodeExecutionDuration(node: WorkflowNode): number {
  const logs = node.runtimeState.logs ?? [];
  const started = logs.find((l) => l.event === "running");
  const completed = logs.find(
    (l) => l.event === "completed" || l.event === "failed",
  );
  if (!started?.at || !completed?.at) return 0;
  return new Date(completed.at).getTime() - new Date(started.at).getTime();
}

export function renameWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
  title: string,
): WorkflowDocument {
  if (!document.nodes.some((node) => node.id === nodeId)) return document;
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (trimmed.length === 0) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId ? { ...node, title: trimmed } : node,
    ),
  };
}
