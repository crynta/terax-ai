import { describe, expect, it } from "vitest";
import { executeWorkflowStep } from "./execution";
import { buildWorkflowInspectorState } from "./inspector";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
  type WorkflowDocument,
} from "./schema";

describe("workflow inspector state", () => {
  it("surfaces graph validation errors as blocking issues", () => {
    const document: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_1", title: "Broken" }),
      edges: [
        {
          id: "edge_missing",
          sourceNodeId: "node_prompt",
          sourcePortId: "text",
          targetNodeId: "missing",
          targetPortId: "prompt",
        },
      ],
    };

    expect(buildWorkflowInspectorState(document)).toMatchObject({
      valid: false,
      issues: [
        {
          severity: "error",
          message: "Edge edge_missing targets missing node missing",
        },
      ],
    });
  });

  it("includes selected node metadata", () => {
    const document = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_1", title: "Inspect" }),
      { id: "node_agent_1", type: "agent", position: { x: 0, y: 0 } },
    );
    const waiting = executeWorkflowStep(document);

    expect(
      buildWorkflowInspectorState(waiting, { selectedNodeId: "node_agent_1" }),
    ).toMatchObject({
      selectedNode: {
        id: "node_agent_1",
        type: "agent",
        status: "waiting-approval",
        inputCount: 1,
        outputCount: 1,
      },
      issues: expect.arrayContaining([
        {
          severity: "warning",
          nodeId: "node_agent_1",
          message: "Agent is waiting for explicit approval",
        },
      ]),
    });
  });

  it("includes approval details for waiting shell and agent nodes", () => {
    const document = updateWorkflowNodeConfig(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_1", title: "Inspect" }),
        { id: "node_shell_1", type: "shellCommand", position: { x: 0, y: 0 } },
      ),
      "node_shell_1",
      { command: "pnpm test" },
    );
    const waiting = executeWorkflowStep(document);

    expect(
      buildWorkflowInspectorState(waiting, { selectedNodeId: "node_shell_1" })
        .selectedNode,
    ).toMatchObject({
      approval: {
        action: { kind: "shell", command: "pnpm test" },
        risk: "Shell commands can read, write, delete, or execute files.",
      },
    });
  });

  it("includes selected node runtime details and recent logs", () => {
    const logs = [
      {
        event: "queued" as const,
        message: "Queued",
        at: "2026-06-05T00:00:00.000Z",
      },
      {
        event: "running" as const,
        message: "Running",
        at: "2026-06-05T00:00:01.000Z",
      },
      {
        event: "progress" as const,
        message: "25%",
        at: "2026-06-05T00:00:02.000Z",
      },
      {
        event: "progress" as const,
        message: "50%",
        at: "2026-06-05T00:00:03.000Z",
      },
      {
        event: "retry" as const,
        message: "Retrying",
        at: "2026-06-05T00:00:04.000Z",
      },
      {
        event: "progress" as const,
        message: "75%",
        at: "2026-06-05T00:00:05.000Z",
      },
    ];
    const base = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Inspect",
    });
    const document: WorkflowDocument = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              runtimeState: {
                status: "running",
                message: "Rendering image",
                progress: 0.42,
                artifactIds: ["artifact_image"],
                attempt: 2,
                errorCode: "timeout",
                logs,
              },
            }
          : node,
      ),
    };

    expect(
      buildWorkflowInspectorState(document, { selectedNodeId: "node_image" })
        .selectedNode,
    ).toEqual({
      id: "node_image",
      type: "imageGeneration",
      title: "Image Generation",
      status: "running",
      inputCount: 1,
      outputCount: 1,
      message: "Rendering image",
      progress: 0.42,
      artifactIds: ["artifact_image"],
      attempt: 2,
      errorCode: "timeout",
      recentLogs: logs.slice(1),
    });
  });

  it("reports failed runtime diagnostics", () => {
    const document: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_1", title: "Failed" }),
      nodes: createStarterWorkflowDocument({
        id: "wf_1",
        title: "Failed",
      }).nodes.map((node) =>
        node.id === "node_image"
          ? { ...node, runtimeState: { status: "failed", message: "No quota" } }
          : node,
      ),
    };

    expect(buildWorkflowInspectorState(document).issues).toContainEqual({
      severity: "error",
      nodeId: "node_image",
      message: "Image Generation failed: No quota",
    });
  });

  it("includes failed runtime error codes in diagnostics", () => {
    const base = createStarterWorkflowDocument({ id: "wf_1", title: "Failed" });
    const document: WorkflowDocument = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              runtimeState: {
                status: "failed",
                message: "No quota",
                errorCode: "quota",
              },
            }
          : node,
      ),
    };

    expect(buildWorkflowInspectorState(document).issues).toContainEqual({
      severity: "error",
      nodeId: "node_image",
      message: "Image Generation failed (quota): No quota",
    });
  });
});
