import { describe, expect, it } from "vitest";
import {
  executeWorkflowStep,
  startApprovedWorkflowNodeExecution,
  type WorkflowBrowserAutomationInput,
  type WorkflowFileOperationInput,
} from "./execution";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";

function waitingFileOperation() {
  const document = updateWorkflowNodeConfig(
    addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_auto", title: "Automation" }),
      {
        id: "node_file_1",
        type: "fileOperation",
        position: { x: 0, y: 0 },
      },
    ),
    "node_file_1",
    {
      operation: "write",
      path: "notes/out.md",
      content: "hello workflow",
    },
  );
  return executeWorkflowStep(document);
}

function waitingBrowserAutomation() {
  const document = updateWorkflowNodeConfig(
    addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_browser", title: "Browser" }),
      {
        id: "node_browser_1",
        type: "browserAutomation",
        position: { x: 0, y: 0 },
      },
    ),
    "node_browser_1",
    {
      url: "https://example.com",
      instructions: "Capture the page title",
    },
  );
  return executeWorkflowStep(document);
}

describe("approved workflow automation execution", () => {
  it("executes approved file operations with audited artifacts", async () => {
    let input: WorkflowFileOperationInput | undefined;
    const execution = startApprovedWorkflowNodeExecution(
      waitingFileOperation(),
      "node_file_1",
      {
        executeFileOperation: async (request) => {
          input = request;
          request.reportProgress({ message: "Wrote file", progress: 0.8 });
          return {
            operation: "write",
            path: request.path,
            content: request.content,
            size: request.content?.length ?? 0,
          };
        },
        decision: {
          approvedAt: "2026-06-05T12:00:00.000Z",
          approver: "user",
        },
        now: () => "2026-06-05T12:00:00.000Z",
      },
    );

    expect(
      execution.document.nodes.find((node) => node.id === "node_file_1"),
    ).toMatchObject({
      runtimeState: {
        status: "running",
        message: "Running approved file operation",
      },
    });

    const finished = await execution.finished;

    expect(input).toMatchObject({
      operation: "write",
      path: "notes/out.md",
      content: "hello workflow",
    });
    expect(
      finished.nodes.find((node) => node.id === "node_file_1"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        message: "File operation result ready",
        artifactIds: ["wf_auto:node_file_1:file"],
      },
    });
    expect(
      finished.artifacts.find((artifact) => artifact.nodeId === "node_file_1"),
    ).toMatchObject({
      type: "file",
      preview: "write notes/out.md (14 B)",
      value: {
        approval: {
          workflowId: "wf_auto",
          nodeId: "node_file_1",
          action: { kind: "file", operation: "write", path: "notes/out.md" },
          approvedAt: "2026-06-05T12:00:00.000Z",
          approver: "user",
        },
        file: {
          operation: "write",
          path: "notes/out.md",
          content: "hello workflow",
          size: 14,
        },
      },
    });
  });

  it("executes approved browser automation through an executor", async () => {
    const progress: string[] = [];
    let input: WorkflowBrowserAutomationInput | undefined;
    const execution = startApprovedWorkflowNodeExecution(
      waitingBrowserAutomation(),
      "node_browser_1",
      {
        executeBrowserAutomation: async (request) => {
          input = request;
          request.reportOutput("Opened example.com");
          return {
            text: "Title: Example Domain",
            sessionId: "session_1",
            eventIds: ["event_1"],
          };
        },
        onProgress: (next) => {
          const node = next.nodes.find(
            (candidate) => candidate.id === "node_browser_1",
          );
          if (node?.runtimeState.message)
            progress.push(node.runtimeState.message);
        },
      },
    );

    expect(
      execution.document.nodes.find((node) => node.id === "node_browser_1"),
    ).toMatchObject({
      runtimeState: {
        status: "running",
        message: "Running approved browser automation",
      },
    });

    const finished = await execution.finished;

    expect(input).toMatchObject({
      url: "https://example.com",
      instructions: "Capture the page title",
    });
    expect(progress).toContain("Opened example.com");
    expect(
      finished.nodes.find((node) => node.id === "node_browser_1"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        message: "Browser automation result ready",
        artifactIds: ["wf_browser:node_browser_1:json"],
      },
    });
    expect(
      finished.artifacts.find(
        (artifact) => artifact.nodeId === "node_browser_1",
      ),
    ).toMatchObject({
      type: "json",
      preview: "Title: Example Domain",
      value: {
        browser: {
          url: "https://example.com",
          instructions: "Capture the page title",
          result: "Title: Example Domain",
          sessionId: "session_1",
          eventIds: ["event_1"],
        },
      },
    });
  });
});
