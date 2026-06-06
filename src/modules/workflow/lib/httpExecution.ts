import { invoke } from "@tauri-apps/api/core";
import type {
  WorkflowHttpRequestExecutor,
  WorkflowHttpRequestOutput,
} from "./execution";

type WorkflowFetch = typeof fetch;

export type WorkflowHttpPolicyContext = {
  approved: boolean;
  documentId: string;
  nodeId: string;
};

export type WorkflowNativeHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

type NativeWorkflowHttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
};

export type WorkflowNativeHttpApi = {
  request: (
    request: WorkflowNativeHttpRequest,
    policy?: WorkflowHttpPolicyContext,
  ) => Promise<NativeWorkflowHttpResponse>;
};

const MAX_WORKFLOW_HTTP_BODY_BYTES = 1024 * 1024;
const WORKFLOW_HTTP_TIMEOUT_MS = 60_000;

const tauriWorkflowNativeHttpApi: WorkflowNativeHttpApi = {
  request: (request, policy) =>
    invoke<NativeWorkflowHttpResponse>("workflow_http_request", {
      request: {
        ...request,
        allowPrivateNetwork: true,
        timeoutMs: WORKFLOW_HTTP_TIMEOUT_MS,
        maxBodyBytes: MAX_WORKFLOW_HTTP_BODY_BYTES,
        approved: policy?.approved ?? false,
        documentId: policy?.documentId ?? "workflow",
        nodeId: policy?.nodeId ?? "httpRequest",
      },
    }),
};

export function createWorkflowNativeHttpExecutor(
  api: WorkflowNativeHttpApi = tauriWorkflowNativeHttpApi,
): WorkflowHttpRequestExecutor {
  return async ({
    document,
    node,
    method,
    url,
    headers,
    body,
    reportProgress,
  }) => {
    reportProgress({ message: "Sending HTTP request", progress: 0.2 });
    const response = await api.request(
      {
        method,
        url,
        headers,
        ...(body !== undefined ? { body } : {}),
      },
      { approved: true, documentId: document.id, nodeId: node.id },
    );
    reportProgress({ message: "Reading HTTP response", progress: 0.8 });
    return outputFromNativeResponse(response);
  };
}

export function createWorkflowFetchHttpExecutor(
  fetchImpl: WorkflowFetch = globalThis.fetch.bind(globalThis),
): WorkflowHttpRequestExecutor {
  return async ({ method, url, headers, body, signal, reportProgress }) => {
    reportProgress({ message: "Sending HTTP request", progress: 0.2 });
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal,
    });
    reportProgress({ message: "Reading HTTP response", progress: 0.8 });
    return await outputFromResponse(response);
  };
}

export const workflowNativeHttpExecutor = createWorkflowNativeHttpExecutor();
export const workflowFetchHttpExecutor = createWorkflowFetchHttpExecutor();

function outputFromNativeResponse(
  response: NativeWorkflowHttpResponse,
): WorkflowHttpRequestOutput {
  const bodyJson = parseJsonBody(
    response.bodyText,
    contentTypeHeader(response.headers),
  );
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    bodyText: response.bodyText,
    ...(bodyJson !== undefined ? { bodyJson } : {}),
  };
}

async function outputFromResponse(
  response: Response,
): Promise<WorkflowHttpRequestOutput> {
  const bodyText = await response.text();
  const bodyJson = parseJsonBody(
    bodyText,
    response.headers.get("content-type"),
  );
  return {
    status: response.status,
    statusText: response.statusText,
    headers: headersRecord(response.headers),
    bodyText,
    ...(bodyJson !== undefined ? { bodyJson } : {}),
  };
}

function headersRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function contentTypeHeader(headers: Record<string, string>): string | null {
  return headers["content-type"] ?? headers["Content-Type"] ?? null;
}

function parseJsonBody(
  bodyText: string,
  contentType: string | null,
): unknown | undefined {
  if (!bodyText.trim()) return undefined;
  if (!contentType?.toLowerCase().includes("json")) return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}
