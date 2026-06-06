import { describe, expect, it, vi } from "vitest";
import {
  executeWorkflowStepAsync,
  startWorkflowStepExecution,
  type WorkflowHttpRequestInput,
} from "./execution";
import {
  createWorkflowFetchHttpExecutor,
  createWorkflowNativeHttpExecutor,
} from "./httpExecution";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";

function httpWorkflow() {
  return updateWorkflowNodeConfig(
    addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_http", title: "HTTP" }),
      {
        id: "node_http_1",
        type: "httpRequest",
        position: { x: 0, y: 0 },
      },
    ),
    "node_http_1",
    {
      method: "POST",
      url: "https://api.example.test/items",
      headers: '{"authorization":"Bearer should-not-leak","x-test":"1"}',
      body: '{"name":"Ada"}',
    },
  );
}

describe("workflow HTTP execution", () => {
  it("runs HTTP nodes through an injected executor with progress and artifacts", async () => {
    const progress: string[] = [];
    let input: WorkflowHttpRequestInput | undefined;
    const document = httpWorkflow();
    const execution = startWorkflowStepExecution(document, {
      executeHttpRequest: async (request) => {
        input = request;
        request.reportProgress({
          message: "HTTP response received",
          progress: 0.75,
        });
        return {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json" },
          bodyText: '{"ok":true}',
          bodyJson: { ok: true },
        };
      },
      onProgress: (next) => {
        const node = next.nodes.find(
          (candidate) => candidate.id === "node_http_1",
        );
        if (node?.runtimeState.message)
          progress.push(node.runtimeState.message);
      },
      now: () => "2026-06-05T12:00:00.000Z",
    });

    expect(
      execution.document.nodes.find((node) => node.id === "node_http_1"),
    ).toMatchObject({
      runtimeState: { status: "running", message: "Running HTTP Request" },
    });

    const finished = await execution.finished;

    expect(input).toMatchObject({
      method: "POST",
      url: "https://api.example.test/items",
      headers: { authorization: "Bearer should-not-leak", "x-test": "1" },
      body: '{"name":"Ada"}',
    });
    expect(progress).toContain("HTTP response received");
    expect(
      finished.nodes.find((node) => node.id === "node_http_1"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        message: "HTTP request completed with 201 Created",
        artifactIds: ["wf_http:node_http_1:json"],
      },
    });
    expect(
      finished.artifacts.find((artifact) => artifact.nodeId === "node_http_1"),
    ).toMatchObject({
      type: "json",
      preview: '201 Created\n{"ok":true}',
      value: {
        http: {
          method: "POST",
          url: "https://api.example.test/items",
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json" },
          bodyText: '{"ok":true}',
          bodyJson: { ok: true },
        },
      },
    });
  });

  it("fails HTTP nodes without a URL", async () => {
    const document = updateWorkflowNodeConfig(httpWorkflow(), "node_http_1", {
      url: "",
    });
    const finished = await executeWorkflowStepAsync(document, {
      executeHttpRequest: async () => {
        throw new Error("executor should not run");
      },
    });

    expect(
      finished.nodes.find((node) => node.id === "node_http_1"),
    ).toMatchObject({
      runtimeState: {
        status: "failed",
        message: "HTTP request URL is required",
        errorCode: "unknown",
      },
    });
  });

  it("passes workflow policy context to native HTTP executor", async () => {
    const request = vi.fn(async () => ({
      status: 202,
      statusText: "Accepted",
      headers: { "content-type": "application/json" },
      bodyText: '{"queued":true}',
    }));
    const executor = createWorkflowNativeHttpExecutor({ request });
    const document = httpWorkflow();
    const node = document.nodes.find(
      (candidate) => candidate.id === "node_http_1",
    )!;

    const output = await executor({
      document,
      node,
      method: "POST",
      url: "https://api.example.test/items",
      headers: { "x-test": "1" },
      body: '{"name":"Ada"}',
      reportProgress: vi.fn(),
    });

    expect(request).toHaveBeenCalledWith(
      {
        method: "POST",
        url: "https://api.example.test/items",
        headers: { "x-test": "1" },
        body: '{"name":"Ada"}',
      },
      { approved: true, documentId: "wf_http", nodeId: "node_http_1" },
    );
    expect(output).toEqual({
      status: 202,
      statusText: "Accepted",
      headers: { "content-type": "application/json" },
      bodyText: '{"queued":true}',
      bodyJson: { queued: true },
    });
  });

  it("creates a fetch-backed executor for real HTTP requests", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json", "x-id": "42" },
        }),
    );
    const executor = createWorkflowFetchHttpExecutor(fetchImpl);
    const output = await executor({
      document: httpWorkflow(),
      node: httpWorkflow().nodes.find((node) => node.id === "node_http_1")!,
      method: "POST",
      url: "https://api.example.test/items",
      headers: { "x-test": "1" },
      body: '{"name":"Ada"}',
      reportProgress: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/items",
      expect.objectContaining({
        method: "POST",
        headers: { "x-test": "1" },
        body: '{"name":"Ada"}',
      }),
    );
    expect(output).toEqual({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json", "x-id": "42" },
      bodyText: '{"ok":true}',
      bodyJson: { ok: true },
    });
  });
});
