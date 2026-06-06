import type { WorkflowApprovalDecision } from "../approval";
import type { WorkflowProgressUpdate } from "../providerAdapter";
import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
} from "../schema";

export type WorkflowProviderExecutionRuntimeContext = {
  signal?: AbortSignal;
  reportProgress: (update: WorkflowProgressUpdate) => void;
};

export type WorkflowProviderArtifactFactory = (
  document: WorkflowDocument,
  node: WorkflowNode,
  context: WorkflowProviderExecutionRuntimeContext,
) => WorkflowArtifact | Promise<WorkflowArtifact | null> | null;

export type WorkflowArtifactPersistence = (
  artifact: WorkflowArtifact,
  document: WorkflowDocument,
  node: WorkflowNode,
) => WorkflowArtifact | Promise<WorkflowArtifact>;

export type WorkflowStepExecutionOptions = {
  createProviderArtifact?: WorkflowProviderArtifactFactory;
  executeHttpRequest?: WorkflowHttpRequestExecutor;
  persistArtifact?: WorkflowArtifactPersistence;
  onProgress?: (document: WorkflowDocument) => void;
  signal?: AbortSignal;
  now?: () => string;
};

export type WorkflowStepExecution = {
  document: WorkflowDocument;
  finished: Promise<WorkflowDocument>;
};

export type WorkflowHttpRequestOutput = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
};

export type WorkflowHttpRequestInput = {
  document: WorkflowDocument;
  node: WorkflowNode;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  reportProgress: (update: WorkflowProgressUpdate) => void;
};

export type WorkflowHttpRequestExecutor = (
  input: WorkflowHttpRequestInput,
) => Promise<WorkflowHttpRequestOutput>;

export type WorkflowShellCommandOutput = {
  stdout: string;
  stderr?: string;
  exitCode: number | null;
  timedOut?: boolean;
  truncated?: boolean;
};

export type WorkflowShellCommandInput = {
  document: WorkflowDocument;
  node: WorkflowNode;
  command: string;
  cwd?: string;
  timeoutSecs?: number;
  signal?: AbortSignal;
  reportOutput: (chunk: string) => void;
};

export type WorkflowShellCommandExecutor = (
  input: WorkflowShellCommandInput,
) => Promise<WorkflowShellCommandOutput>;

export type WorkflowAgentOutput = {
  text: string;
  sessionId?: string;
  eventIds?: string[];
};

export type WorkflowAgentInput = {
  document: WorkflowDocument;
  node: WorkflowNode;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  reportOutput: (chunk: string) => void;
};

export type WorkflowAgentExecutor = (
  input: WorkflowAgentInput,
) => Promise<WorkflowAgentOutput>;

export type WorkflowFileOperationOutput = {
  operation: string;
  path: string;
  content?: string;
  size?: number;
  kind?: string;
};

export type WorkflowFileOperationInput = {
  document: WorkflowDocument;
  node: WorkflowNode;
  operation: string;
  path: string;
  content?: string;
  signal?: AbortSignal;
  reportProgress: (update: WorkflowProgressUpdate) => void;
};

export type WorkflowFileOperationExecutor = (
  input: WorkflowFileOperationInput,
) => Promise<WorkflowFileOperationOutput>;

export type WorkflowBrowserAutomationOutput = {
  text: string;
  sessionId?: string;
  eventIds?: string[];
};

export type WorkflowBrowserAutomationInput = {
  document: WorkflowDocument;
  node: WorkflowNode;
  url: string;
  instructions: string;
  signal?: AbortSignal;
  reportOutput: (chunk: string) => void;
};

export type WorkflowBrowserAutomationExecutor = (
  input: WorkflowBrowserAutomationInput,
) => Promise<WorkflowBrowserAutomationOutput>;

export type ApprovedWorkflowNodeExecutionOptions = Pick<
  WorkflowStepExecutionOptions,
  "onProgress" | "persistArtifact" | "signal" | "now"
> & {
  decision?: WorkflowApprovalDecision;
  executeAgent?: WorkflowAgentExecutor;
  executeBrowserAutomation?: WorkflowBrowserAutomationExecutor;
  executeFileOperation?: WorkflowFileOperationExecutor;
  executeShellCommand?: WorkflowShellCommandExecutor;
};
