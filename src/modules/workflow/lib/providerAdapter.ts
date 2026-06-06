import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowPortType,
} from "./schema";

export type WorkflowProgressUpdate = {
  message?: string;
  progress?: number;
};

export type WorkflowProviderExecutionContext = {
  document: WorkflowDocument;
  node: WorkflowNode;
  outputType: WorkflowPortType;
  outputPortId?: string;
  artifactId: string;
  inputArtifacts: WorkflowArtifact[];
  signal?: AbortSignal;
  reportProgress: (update: WorkflowProgressUpdate) => void;
};

type MaybePromise<T> = T | Promise<T>;

export type WorkflowProviderAdapter = {
  id: string;
  label: string;
  priority?: number;
  supports: (node: WorkflowNode) => boolean;
  createArtifact: (
    context: WorkflowProviderExecutionContext,
  ) => MaybePromise<WorkflowArtifact>;
};

const mediaNodeTypes = new Set<WorkflowNodeType>([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
]);

const placeholderMediaAdapter: WorkflowProviderAdapter = {
  id: "placeholder-media",
  label: "Placeholder media provider",
  supports: (node) => mediaNodeTypes.has(node.type),
  createArtifact: (context) => {
    const provider = stringConfig(context.node.config.provider, "placeholder");
    const model = stringConfig(context.node.config.model, context.outputType);
    const inputArtifactIds = context.inputArtifacts.map(
      (artifact) => artifact.id,
    );

    return {
      id: context.artifactId,
      nodeId: context.node.id,
      portId: context.outputPortId,
      type: context.outputType,
      label: context.node.title,
      preview: mediaPreview({
        inputArtifacts: context.inputArtifacts,
        model,
        outputType: context.outputType,
        provider,
      }),
      value: {
        adapterId: placeholderMediaAdapter.id,
        provider,
        model,
        inputArtifactIds,
      },
    };
  },
};

const workflowProviderAdapters: WorkflowProviderAdapter[] = [
  placeholderMediaAdapter,
];

export function registerWorkflowProviderAdapter(
  adapter: WorkflowProviderAdapter,
): () => void {
  if (
    workflowProviderAdapters.some((candidate) => candidate.id === adapter.id)
  ) {
    throw new Error(
      `Workflow provider adapter ${adapter.id} is already registered`,
    );
  }

  workflowProviderAdapters.push(adapter);
  sortWorkflowProviderAdapters();

  return () => {
    const index = workflowProviderAdapters.findIndex(
      (candidate) => candidate.id === adapter.id,
    );
    if (index >= 0) workflowProviderAdapters.splice(index, 1);
  };
}

export function listWorkflowProviderAdapters(): WorkflowProviderAdapter[] {
  return [...workflowProviderAdapters];
}

export function getWorkflowProviderAdapter(
  node: WorkflowNode,
): WorkflowProviderAdapter | null {
  return (
    workflowProviderAdapters.find((adapter) => adapter.supports(node)) ?? null
  );
}

export function createWorkflowProviderArtifact(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact | null {
  const adapter = getWorkflowProviderAdapter(node);
  if (!adapter) return null;

  const artifact = adapter.createArtifact(
    providerExecutionContext(document, node),
  );
  if (isPromiseLike(artifact)) {
    throw new Error("Async provider adapters require async workflow execution");
  }
  return artifact;
}

export async function createWorkflowProviderArtifactAsync(
  document: WorkflowDocument,
  node: WorkflowNode,
  options: {
    signal?: AbortSignal;
    reportProgress?: (update: WorkflowProgressUpdate) => void;
  } = {},
): Promise<WorkflowArtifact | null> {
  const adapter = getWorkflowProviderAdapter(node);
  if (!adapter) return null;
  return await adapter.createArtifact(
    providerExecutionContext(document, node, {
      reportProgress: options.reportProgress,
      signal: options.signal,
    }),
  );
}

function providerExecutionContext(
  document: WorkflowDocument,
  node: WorkflowNode,
  options: {
    signal?: AbortSignal;
    reportProgress?: (update: WorkflowProgressUpdate) => void;
  } = {},
): WorkflowProviderExecutionContext {
  const output = node.outputs[0];
  const outputType = output?.type ?? "json";
  return {
    document,
    node,
    outputType,
    outputPortId: output?.id,
    artifactId: workflowArtifactId(document, node),
    inputArtifacts: collectInputArtifacts(document, node),
    signal: options.signal,
    reportProgress: options.reportProgress ?? noopProgress,
  };
}

function sortWorkflowProviderAdapters(): void {
  workflowProviderAdapters.sort(
    (left, right) => adapterPriority(right) - adapterPriority(left),
  );
}

function adapterPriority(adapter: WorkflowProviderAdapter): number {
  return adapter.priority ?? 0;
}

function noopProgress() {}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

export function workflowArtifactId(
  document: WorkflowDocument,
  node: WorkflowNode,
): string {
  const outputType = node.outputs[0]?.type ?? "json";
  return `${document.id}:${node.id}:${outputType}`;
}

function collectInputArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const inputArtifactIds = new Set(
    document.edges
      .filter((edge) => edge.targetNodeId === node.id)
      .flatMap((edge) => {
        const source = document.nodes.find(
          (candidate) => candidate.id === edge.sourceNodeId,
        );
        return source?.runtimeState.artifactIds ?? [];
      }),
  );

  return document.artifacts.filter((artifact) =>
    inputArtifactIds.has(artifact.id),
  );
}

function mediaPreview(input: {
  outputType: WorkflowPortType;
  provider: string;
  model: string;
  inputArtifacts: WorkflowArtifact[];
}): string {
  const prompt = input.inputArtifacts.find(
    (artifact) => artifact.type === "text",
  );
  if (input.outputType === "image") {
    return placeholderImageDataUrl({
      model: input.model,
      prompt: prompt?.preview,
      provider: input.provider,
    });
  }

  const promptPreview = prompt?.preview ? ` using ${prompt.preview}` : "";
  return `Placeholder ${input.outputType} artifact from ${input.provider}/${input.model}${promptPreview}`;
}

function placeholderImageDataUrl(input: {
  provider: string;
  model: string;
  prompt?: string;
}): string {
  const prompt = input.prompt?.trim() || "No prompt connected";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Placeholder image">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="0.55" stop-color="#1e3a8a"/>
      <stop offset="1" stop-color="#7c2d12"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="72" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="72" fill="url(#glow)"/>
  <g fill="none" stroke="#dbeafe" stroke-linecap="round" stroke-linejoin="round" stroke-width="24" opacity="0.88">
    <path d="M260 638c78-102 133-154 199-154 59 0 86 42 132 42 55 0 82-88 173-160"/>
    <path d="M242 724h540" opacity="0.65"/>
    <path d="M334 392h356v216H334z" opacity="0.55"/>
  </g>
  <circle cx="378" cy="330" r="54" fill="#fde68a" opacity="0.92"/>
  <text x="512" y="124" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff">Placeholder image</text>
  <text x="512" y="814" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${escapeSvgText(input.provider)} / ${escapeSvgText(input.model)}</text>
  <text x="512" y="862" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="24" fill="#dbeafe">${escapeSvgText(truncateText(prompt, 72))}</text>
</svg>`;
  return `data:image/svg+xml;base64,${base64EncodeUtf8(svg)}`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triplet & 63] : "=";
  }
  return output;
}

function stringConfig(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}
