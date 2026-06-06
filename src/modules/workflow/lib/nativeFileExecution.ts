import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type {
  WorkflowFileOperationExecutor,
  WorkflowFileOperationInput,
  WorkflowFileOperationOutput,
} from "./execution";

type NativeReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type WorkflowFilePolicyContext = {
  approved: boolean;
  documentId: string;
  nodeId: string;
};

export type WorkflowNativeFileOperationApi = {
  readFile: (
    path: string,
    policy?: WorkflowFilePolicyContext,
  ) => Promise<NativeReadResult>;
  writeFile: (
    path: string,
    content: string,
    source: string,
    policy?: WorkflowFilePolicyContext,
  ) => Promise<void>;
  deletePath: (
    path: string,
    policy?: WorkflowFilePolicyContext,
  ) => Promise<void>;
};

export function createWorkflowNativeFileOperationExecutor(
  api: WorkflowNativeFileOperationApi,
): WorkflowFileOperationExecutor {
  return async (input) => {
    throwIfAborted(input);
    input.reportProgress({
      message: `Starting ${input.operation}`,
      progress: 0.1,
    });
    const operation = input.operation.trim().toLowerCase();
    const policy = workflowFilePolicyContext(input);
    if (operation === "read") return await readFile(input, api, policy);
    if (operation === "write")
      return await writeFile(input, api, policy, false);
    if (operation === "append")
      return await writeFile(input, api, policy, true);
    if (operation === "delete") return await deletePath(input, api, policy);
    throw new Error(`Unsupported file operation: ${input.operation}`);
  };
}

export const tauriWorkflowFileOperationExecutor =
  createWorkflowNativeFileOperationExecutor({
    readFile: (path, policy) =>
      invoke<NativeReadResult>("workflow_file_read", {
        request: workflowFileRequest({ path }, policy),
      }),
    writeFile: (path, content, source, policy) =>
      invoke<void>("workflow_file_write", {
        request: workflowFileRequest({ path, content, source }, policy),
      }),
    deletePath: (path, policy) =>
      invoke<void>("workflow_file_delete", {
        request: workflowFileRequest({ path }, policy),
      }),
  });

function workflowFilePolicyContext(
  input: Pick<WorkflowFileOperationInput, "document" | "node">,
): WorkflowFilePolicyContext {
  return {
    approved: true,
    documentId: input.document.id,
    nodeId: input.node.id,
  };
}

function workflowFileRequest<T extends { path: string }>(
  payload: T,
  policy?: WorkflowFilePolicyContext,
): T &
  WorkflowFilePolicyContext & {
    workspace: ReturnType<typeof currentWorkspaceEnv>;
  } {
  return {
    ...payload,
    workspace: currentWorkspaceEnv(),
    approved: policy?.approved ?? false,
    documentId: policy?.documentId ?? "workflow",
    nodeId: policy?.nodeId ?? "fileOperation",
  };
}

async function readFile(
  input: WorkflowFileOperationInput,
  api: WorkflowNativeFileOperationApi,
  policy: WorkflowFilePolicyContext,
): Promise<WorkflowFileOperationOutput> {
  const result = await api.readFile(input.path, policy);
  throwIfAborted(input);
  input.reportProgress({ message: "Read file", progress: 1 });
  if (result.kind === "text") {
    return {
      operation: "read",
      path: input.path,
      content: result.content,
      size: result.size,
      kind: result.kind,
    };
  }
  return {
    operation: "read",
    path: input.path,
    size: result.size,
    kind: result.kind,
  };
}

async function writeFile(
  input: WorkflowFileOperationInput,
  api: WorkflowNativeFileOperationApi,
  policy: WorkflowFilePolicyContext,
  append: boolean,
): Promise<WorkflowFileOperationOutput> {
  const nextContent = append
    ? `${await existingTextContent(input, api, policy)}${input.content ?? ""}`
    : (input.content ?? "");
  await api.writeFile(
    input.path,
    nextContent,
    "workflow-file-operation",
    policy,
  );
  throwIfAborted(input);
  input.reportProgress({
    message: append ? "Appended file" : "Wrote file",
    progress: 1,
  });
  return {
    operation: append ? "append" : "write",
    path: input.path,
    content: nextContent,
    size: new TextEncoder().encode(nextContent).length,
    kind: "text",
  };
}

async function deletePath(
  input: WorkflowFileOperationInput,
  api: WorkflowNativeFileOperationApi,
  policy: WorkflowFilePolicyContext,
): Promise<WorkflowFileOperationOutput> {
  await api.deletePath(input.path, policy);
  throwIfAborted(input);
  input.reportProgress({ message: "Deleted path", progress: 1 });
  return { operation: "delete", path: input.path };
}

async function existingTextContent(
  input: WorkflowFileOperationInput,
  api: WorkflowNativeFileOperationApi,
  policy: WorkflowFilePolicyContext,
): Promise<string> {
  const result = await api.readFile(input.path, policy);
  throwIfAborted(input);
  if (result.kind !== "text") {
    throw new Error("Append requires an existing text file");
  }
  return result.content;
}

function throwIfAborted(
  input: Pick<WorkflowFileOperationInput, "signal">,
): void {
  if (!input.signal?.aborted) return;
  throw new DOMException("Aborted", "AbortError");
}
