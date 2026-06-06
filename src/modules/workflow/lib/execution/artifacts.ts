import {
  createWorkflowApprovalArtifactValue,
  type WorkflowApprovalDecision,
} from "../approval";
import {
  createWorkflowProviderArtifact,
  workflowArtifactId,
} from "../providerAdapter";
import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
} from "../schema";
import type {
  WorkflowAgentOutput,
  WorkflowBrowserAutomationOutput,
  WorkflowFileOperationOutput,
  WorkflowHttpRequestOutput,
  WorkflowShellCommandOutput,
} from "./types";

type WorkflowRuntimeState = WorkflowNode["runtimeState"];

export type ResolvedWorkflowHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export function fileOperationArtifactForOutput(
  document: WorkflowDocument,
  node: WorkflowNode,
  input: {
    output: WorkflowFileOperationOutput;
    decision?: WorkflowApprovalDecision;
  },
): WorkflowArtifact {
  const port = node.outputs[0];
  const approvalValue = createWorkflowApprovalArtifactValue(
    document,
    node,
    input.decision,
  );
  return {
    id: workflowArtifactId(document, node),
    nodeId: node.id,
    portId: port?.id,
    type: port?.type ?? "file",
    label: node.title,
    preview: fileOperationPreview(input.output),
    value: {
      ...(approvalValue ?? {}),
      file: {
        operation: input.output.operation,
        path: input.output.path,
        ...(input.output.content !== undefined
          ? { content: input.output.content }
          : {}),
        ...(input.output.size !== undefined ? { size: input.output.size } : {}),
        ...(input.output.kind !== undefined ? { kind: input.output.kind } : {}),
      },
    },
  };
}

export function browserAutomationArtifactForOutput(
  document: WorkflowDocument,
  node: WorkflowNode,
  input: {
    url: string;
    instructions: string;
    output: WorkflowBrowserAutomationOutput;
    decision?: WorkflowApprovalDecision;
  },
): WorkflowArtifact {
  const port = node.outputs[0];
  const approvalValue = createWorkflowApprovalArtifactValue(
    document,
    node,
    input.decision,
  );
  return {
    id: workflowArtifactId(document, node),
    nodeId: node.id,
    portId: port?.id,
    type: port?.type ?? "json",
    label: node.title,
    preview: browserOutputPreview(input.output.text),
    value: {
      ...(approvalValue ?? {}),
      browser: {
        url: input.url,
        instructions: input.instructions,
        result: input.output.text,
        ...(input.output.sessionId !== undefined
          ? { sessionId: input.output.sessionId }
          : {}),
        ...(input.output.eventIds !== undefined
          ? { eventIds: input.output.eventIds }
          : {}),
      },
    },
  };
}

export function httpRequestForNode(
  document: WorkflowDocument,
  node: WorkflowNode,
): ResolvedWorkflowHttpRequest {
  const method = stringConfig(node.config.method, "GET").toUpperCase();
  const url = optionalStringConfig(node.config.url);
  if (!url) throw new Error("HTTP request URL is required");
  return {
    method,
    url,
    headers: headersConfig(node.config.headers),
    ...httpBodyConfig(document, node, method),
  };
}

export function httpArtifactForOutput(
  document: WorkflowDocument,
  node: WorkflowNode,
  request: ResolvedWorkflowHttpRequest,
  output: WorkflowHttpRequestOutput,
): WorkflowArtifact {
  const port = node.outputs[0];
  return {
    id: workflowArtifactId(document, node),
    nodeId: node.id,
    portId: port?.id,
    type: port?.type ?? "json",
    label: node.title,
    preview: httpOutputPreview(output),
    value: {
      http: {
        method: request.method,
        url: request.url,
        status: output.status,
        statusText: output.statusText,
        headers: output.headers,
        bodyText: output.bodyText,
        ...(output.bodyJson !== undefined ? { bodyJson: output.bodyJson } : {}),
      },
    },
  };
}

export function httpOutputPreview(output: WorkflowHttpRequestOutput): string {
  const status = `${output.status} ${output.statusText}`.trim();
  const body = output.bodyText.trim();
  if (!body) return status;
  const preview = `${status}\n${body}`;
  return preview.length > 240 ? `${preview.slice(0, 237)}...` : preview;
}

export function httpRuntimeMessage(artifact: WorkflowArtifact): string {
  const value = objectValue(artifact.value);
  const http = objectValue(value?.http);
  const status = typeof http?.status === "number" ? http.status : null;
  const statusText = optionalStringConfig(http?.statusText);
  if (status === null) return "HTTP request completed";
  return `HTTP request completed with ${status}${statusText ? ` ${statusText}` : ""}`;
}

export function agentArtifactForOutput(
  document: WorkflowDocument,
  node: WorkflowNode,
  input: {
    prompt: string;
    cwd?: string;
    output: WorkflowAgentOutput;
    decision?: WorkflowApprovalDecision;
  },
): WorkflowArtifact {
  const output = node.outputs[0];
  const approvalValue = createWorkflowApprovalArtifactValue(
    document,
    node,
    input.decision,
  );
  return {
    id: workflowArtifactId(document, node),
    nodeId: node.id,
    portId: output?.id,
    type: output?.type ?? "agent",
    label: node.title,
    preview: agentOutputPreview(input.output.text),
    value: {
      ...(approvalValue ?? {}),
      agent: {
        prompt: input.prompt,
        ...(input.cwd !== undefined && { cwd: input.cwd }),
        response: input.output.text,
        ...(input.output.sessionId !== undefined && {
          sessionId: input.output.sessionId,
        }),
        ...(input.output.eventIds !== undefined && {
          eventIds: input.output.eventIds,
        }),
      },
    },
  };
}

export function shellArtifactForOutput(
  document: WorkflowDocument,
  node: WorkflowNode,
  input: {
    command: string;
    cwd?: string;
    timeoutSecs?: number;
    output: WorkflowShellCommandOutput;
    decision?: WorkflowApprovalDecision;
  },
): WorkflowArtifact {
  const output = node.outputs[0];
  const approvalValue = createWorkflowApprovalArtifactValue(
    document,
    node,
    input.decision,
  );
  return {
    id: workflowArtifactId(document, node),
    nodeId: node.id,
    portId: output?.id,
    type: output?.type ?? "text",
    label: node.title,
    preview: shellOutputPreview(input.output),
    value: {
      ...(approvalValue ?? {}),
      shell: {
        command: input.command,
        ...(input.cwd !== undefined && { cwd: input.cwd }),
        ...(input.timeoutSecs !== undefined && {
          timeoutSecs: input.timeoutSecs,
        }),
        stdout: input.output.stdout,
        stderr: input.output.stderr ?? "",
        exitCode: input.output.exitCode,
        timedOut: input.output.timedOut === true,
        truncated: input.output.truncated === true,
      },
    },
  };
}

export function fileOperationContentConfig(
  document: WorkflowDocument,
  node: WorkflowNode,
): string | undefined {
  const configured = optionalStringConfig(node.config.content);
  if (configured !== undefined) return configured;
  const artifact = collectNodeInputArtifacts(document, node).find(
    (candidate) => candidate.type === "text" || candidate.type === "file",
  );
  if (!artifact) return undefined;
  return typeof artifact.value === "string" ? artifact.value : artifact.preview;
}

export function browserInstructionsConfig(
  document: WorkflowDocument,
  node: WorkflowNode,
): string {
  const configured = optionalStringConfig(node.config.instructions);
  if (configured !== undefined) return configured;
  const artifact = collectNodeInputArtifacts(document, node).find(
    (candidate) => candidate.type === "text",
  );
  if (!artifact) return "";
  return typeof artifact.value === "string" ? artifact.value : artifact.preview;
}

export function fileOperationPreview(
  output: WorkflowFileOperationOutput,
): string {
  const size =
    output.size !== undefined ? ` (${formatByteLength(output.size)})` : "";
  return `${output.operation} ${output.path}${size}`;
}

export function browserOutputPreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Browser automation produced no output";
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

export function agentOutputPreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Agent produced no output";
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

export function agentPromptConfig(node: WorkflowNode): string {
  return typeof node.config.prompt === "string"
    ? node.config.prompt.trim()
    : "";
}

export function shellOutputFailed(output: WorkflowShellCommandOutput): boolean {
  return output.timedOut === true || output.exitCode !== 0;
}

export function shellFailureMessage(
  output: WorkflowShellCommandOutput,
): string {
  if (output.timedOut) return "Shell command timed out";
  if (output.exitCode === null)
    return "Shell command did not report an exit code";
  return `Shell command exited with code ${output.exitCode}`;
}

export function shellOutputProgressMessage(chunk: string): string {
  return shellOutputPreview({ stdout: chunk, exitCode: 0 });
}

export function shellOutputPreview(output: WorkflowShellCommandOutput): string {
  const stdout = output.stdout.trimEnd();
  const stderr = (output.stderr ?? "").trimEnd();
  const combined =
    stdout && stderr
      ? `stdout:\n${stdout}\nstderr:\n${stderr}`
      : stdout || stderr;
  if (!combined) return "Shell command produced no output";
  return combined.length > 200 ? `${combined.slice(0, 197)}...` : combined;
}

export function shellCommandConfig(node: WorkflowNode): string {
  return typeof node.config.command === "string"
    ? node.config.command.trim()
    : "";
}

export function stringConfig(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

export function optionalStringConfig(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function headersConfig(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === "") return {};
  const parsed =
    typeof value === "string" ? parseJsonObject(value, "HTTP headers") : value;
  if (!isPlainObject(parsed))
    throw new Error("HTTP headers must be a JSON object");
  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1]),
      )
      .map(([key, headerValue]) => [key, String(headerValue)]),
  );
}

export function httpBodyConfig(
  document: WorkflowDocument,
  node: WorkflowNode,
  method: string,
): { body?: string } {
  if (method === "GET" || method === "HEAD") return {};
  const configuredBody = optionalStringConfig(node.config.body);
  if (configuredBody !== undefined) return { body: configuredBody };
  const inputArtifact = collectNodeInputArtifacts(document, node).find(
    (artifact) => artifact.type === "json" || artifact.type === "text",
  );
  if (!inputArtifact) return {};
  if (inputArtifact.type === "json") {
    return {
      body:
        inputArtifact.value !== undefined
          ? JSON.stringify(inputArtifact.value)
          : inputArtifact.preview,
    };
  }
  return {
    body:
      typeof inputArtifact.value === "string"
        ? inputArtifact.value
        : inputArtifact.preview,
  };
}

export function parseJsonObject(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

export function collectNodeInputArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const sourceNodeById = new Map(
    document.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const artifactIds = new Set(
    document.edges
      .filter((edge) => edge.targetNodeId === node.id)
      .flatMap(
        (edge) =>
          sourceNodeById.get(edge.sourceNodeId)?.runtimeState.artifactIds ?? [],
      ),
  );
  return document.artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

export function optionalPositiveNumberConfig(
  value: unknown,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function formatByteLength(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${trimTrailingZero(kb)} KB`;
  return `${trimTrailingZero(kb / 1024)} MB`;
}

export function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function runtimeStateForReadyNode(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowRuntimeState {
  if (node.type === "shellCommand") {
    return {
      status: "waiting-approval",
      message: "Shell commands require explicit approval",
    };
  }
  if (node.type === "agent") {
    return {
      status: "waiting-approval",
      message: "Agent nodes require explicit approval",
    };
  }
  if (node.type === "fileOperation") {
    return {
      status: "waiting-approval",
      message: "File operations require explicit approval",
    };
  }
  if (node.type === "browserAutomation") {
    return {
      status: "waiting-approval",
      message: "Browser automation requires explicit approval",
    };
  }
  if (node.type === "output") {
    return {
      status: "completed",
      message: "Output collected from completed inputs",
      artifactIds: collectInputArtifactIds(document, node),
    };
  }

  return {
    status: "completed",
    message: runtimeMessageForNode(node),
    artifactIds: [workflowArtifactId(document, node)],
  };
}

export function approvedRuntimeState(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowRuntimeState {
  return {
    status: "completed",
    message: approvedRuntimeMessage(node),
    artifactIds: [workflowArtifactId(document, node)],
  };
}

export function approvedRuntimeMessage(node: WorkflowNode): string {
  if (node.type === "shellCommand") {
    return "Approved placeholder shell output ready";
  }
  if (node.type === "agent") return "Approved placeholder agent output ready";
  if (node.type === "fileOperation") {
    return "Approved placeholder file operation output ready";
  }
  if (node.type === "browserAutomation") {
    return "Approved placeholder browser automation output ready";
  }
  return "Approved placeholder output ready";
}

export function shouldCreateArtifactForReadyNode(node: WorkflowNode): boolean {
  return ![
    "agent",
    "output",
    "shellCommand",
    "fileOperation",
    "browserAutomation",
  ].includes(node.type);
}

export function artifactForNode(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact {
  return (
    createWorkflowProviderArtifact(document, node) ??
    placeholderArtifactForNode(document, node)
  );
}

export function approvedArtifactForNode(
  document: WorkflowDocument,
  node: WorkflowNode,
  decision: WorkflowApprovalDecision,
): WorkflowArtifact {
  const artifact = placeholderArtifactForNode(document, node);
  const value = createWorkflowApprovalArtifactValue(document, node, decision);
  return value ? { ...artifact, value } : artifact;
}

export function placeholderArtifactForNode(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact {
  const output = node.outputs[0];
  return {
    id: workflowArtifactId(document, node),
    nodeId: node.id,
    portId: output?.id,
    type: output?.type ?? "json",
    label: node.title,
    preview: artifactPreviewForNode(node),
  };
}

export function runtimeMessageForNode(node: WorkflowNode): string {
  if (node.type === "textPrompt") return "Prompt text is ready";
  if (node.type === "imageGeneration")
    return "Placeholder image artifact ready";
  if (node.type === "videoGeneration")
    return "Placeholder video artifact ready";
  if (node.type === "audioGeneration")
    return "Placeholder audio artifact ready";
  if (node.type === "terminal") return "Interactive terminal is ready";
  if (node.type === "shellCommand") return "Shell command completed";
  if (node.type === "agent") return "Agent result ready";
  if (node.type === "httpRequest")
    return "HTTP request placeholder response ready";
  if (node.type === "fileOperation") return "File operation completed";
  if (node.type === "browserAutomation") return "Browser automation completed";
  return "Node completed";
}

export function artifactPreviewForNode(node: WorkflowNode): string {
  if (node.type === "textPrompt") {
    return String(node.config.prompt ?? "Prompt text");
  }
  if (node.type === "imageGeneration") return "Placeholder image artifact";
  if (node.type === "videoGeneration") return "Placeholder video artifact";
  if (node.type === "audioGeneration") return "Placeholder audio artifact";
  if (node.type === "terminal") return "Interactive terminal session";
  if (node.type === "shellCommand") return "Approved placeholder shell output";
  if (node.type === "agent") return "Approved placeholder agent output";
  if (node.type === "httpRequest") return "HTTP request placeholder response";
  if (node.type === "fileOperation") {
    return "Approved placeholder file operation output";
  }
  if (node.type === "browserAutomation") {
    return "Approved placeholder browser automation output";
  }
  return "Workflow artifact";
}

export function collectInputArtifactIds(
  document: WorkflowDocument,
  node: WorkflowNode,
): string[] {
  const byId = new Map(
    document.nodes.map((candidate) => [candidate.id, candidate]),
  );
  return document.edges
    .filter((edge) => edge.targetNodeId === node.id)
    .flatMap(
      (edge) => byId.get(edge.sourceNodeId)?.runtimeState.artifactIds ?? [],
    );
}
