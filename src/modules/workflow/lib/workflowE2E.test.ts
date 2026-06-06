import { describe, expect, it } from "vitest";
import {
  approveWorkflowNode,
  executeWorkflowStep,
  executeWorkflowStepAsync,
  getReadyNodeIds,
  startApprovedWorkflowNodeExecution,
} from "./execution";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
  type WorkflowDocument,
} from "./schema";

function connect(
  document: WorkflowDocument,
  edge: {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
  },
): WorkflowDocument {
  return { ...document, edges: [...document.edges, edge] };
}

describe("workflow e2e-style runtime flows", () => {
  it("creates, configures, connects, and runs an HTTP workflow to output", async () => {
    const withHttp = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_e2e", title: "E2E" }),
        {
          id: "node_http_1",
          type: "httpRequest",
          position: { x: 420, y: 320 },
        },
      ),
      "node_http_1",
      {
        method: "POST",
        url: "https://api.example.test/generate",
      },
    );
    const connected = connect(withHttp, {
      id: "edge_prompt_http",
      sourceNodeId: "node_prompt",
      sourcePortId: "text",
      targetNodeId: "node_http_1",
      targetPortId: "text",
    });

    const promptReady = executeWorkflowStep(connected);
    expect(getReadyNodeIds(promptReady)).toContain("node_http_1");

    const httpDone = await executeWorkflowStepAsync(promptReady, {
      executeHttpRequest: async (request) => ({
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ echoed: request.body }),
        bodyJson: { echoed: request.body },
      }),
    });
    expect(
      httpDone.nodes.find((node) => node.id === "node_http_1"),
    ).toMatchObject({ runtimeState: { status: "completed" } });
    expect(
      httpDone.artifacts.find((artifact) => artifact.nodeId === "node_http_1"),
    ).toMatchObject({ preview: expect.stringContaining("200 OK") });
  });

  it("runs approve and cancel flows for unsafe nodes", async () => {
    const withShell = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_cancel", title: "Cancel" }),
        {
          id: "node_shell_1",
          type: "shellCommand",
          position: { x: 80, y: 620 },
        },
      ),
      "node_shell_1",
      { command: "sleep 10" },
    );
    const waiting = executeWorkflowStep(withShell);
    expect(
      waiting.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({ runtimeState: { status: "waiting-approval" } });

    const placeholderApproved = approveWorkflowNode(waiting, "node_shell_1");
    expect(
      placeholderApproved.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({ runtimeState: { status: "completed" } });

    const controller = new AbortController();
    const execution = startApprovedWorkflowNodeExecution(
      waiting,
      "node_shell_1",
      {
        executeShellCommand: async (request) => {
          request.reportOutput("started");
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        },
        signal: controller.signal,
      },
    );
    const cancelled = await execution.finished;
    expect(
      cancelled.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({ runtimeState: { status: "cancelled" } });
  });
});
