import { describe, expect, it } from "vitest";
import {
  planWorkflowExecutionBatch,
  queueReadyWorkflowNodes,
  retryWorkflowNode,
} from "./runtimeHardening";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  type WorkflowDocument,
} from "./schema";

describe("workflow runtime hardening", () => {
  it("queues ready nodes with audit log entries", () => {
    const queued = queueReadyWorkflowNodes(
      createStarterWorkflowDocument({ id: "wf_1", title: "Queue" }),
      { at: "2026-06-05T00:00:00.000Z" },
    );

    expect(
      queued.nodes.find((node) => node.id === "node_prompt"),
    ).toMatchObject({
      runtimeState: {
        status: "queued",
        message: "Queued for execution",
        attempt: 1,
        logs: [
          {
            event: "queued",
            at: "2026-06-05T00:00:00.000Z",
            message: "Queued for execution",
          },
        ],
      },
    });
    expect(queued.nodes.find((node) => node.id === "node_image")).toMatchObject(
      { runtimeState: { status: "idle" } },
    );
  });

  it("plans bounded safe execution batches", () => {
    const withShell = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_1", title: "Plan" }),
      { id: "node_shell_1", type: "shellCommand", position: { x: 0, y: 0 } },
    );
    const withFile = addWorkflowNode(withShell, {
      id: "node_file_1",
      type: "fileOperation",
      position: { x: 0, y: 0 },
    });
    const document = addWorkflowNode(withFile, {
      id: "node_browser_1",
      type: "browserAutomation",
      position: { x: 0, y: 0 },
    });

    expect(planWorkflowExecutionBatch(document, { maxParallel: 4 })).toEqual([
      "node_prompt",
      "node_terminal",
    ]);
    expect(
      planWorkflowExecutionBatch(document, {
        maxParallel: 5,
        includeUnsafe: true,
      }),
    ).toEqual([
      "node_prompt",
      "node_terminal",
      "node_shell_1",
      "node_file_1",
      "node_browser_1",
    ]);
  });

  it("retries failed nodes without restoring stale artifacts", () => {
    const document: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_1", title: "Retry" }),
      artifacts: [
        {
          id: "wf_1:node_image:image",
          nodeId: "node_image",
          type: "image",
          label: "Image",
          preview: "stale",
        },
      ],
      nodes: createStarterWorkflowDocument({
        id: "wf_1",
        title: "Retry",
      }).nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              runtimeState: {
                status: "failed",
                message: "No quota",
                artifactIds: ["wf_1:node_image:image"],
                attempt: 1,
              },
            }
          : node,
      ),
    };

    const retried = retryWorkflowNode(document, "node_image", {
      at: "2026-06-05T00:01:00.000Z",
      message: "Retry after quota reset",
    });

    expect(
      retried.nodes.find((node) => node.id === "node_image"),
    ).toMatchObject({
      runtimeState: {
        status: "queued",
        message: "Retry after quota reset",
        attempt: 2,
        logs: [
          {
            event: "retry",
            at: "2026-06-05T00:01:00.000Z",
            message: "Retry after quota reset",
          },
        ],
      },
    });
    expect(
      retried.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).not.toHaveProperty("artifactIds");
    expect(retried.artifacts).toEqual([]);
  });
});
