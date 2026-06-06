import { describe, expect, it } from "vitest";
import { executeWorkflowStep, startWorkflowStepExecution } from "./execution";
import { createStarterWorkflowDocument, type WorkflowArtifact } from "./schema";

function fixedClock(values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? values[0] ?? "";
}

describe("workflow runtime logs", () => {
  it("records running, progress, and completion events for async provider nodes", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_logs", title: "Logs" }),
    );
    const progressDocuments: (typeof document)[] = [];

    const execution = startWorkflowStepExecution(document, {
      now: fixedClock([
        "2026-06-05T00:00:00.000Z",
        "2026-06-05T00:00:01.000Z",
        "2026-06-05T00:00:02.000Z",
      ]),
      onProgress: (progressDocument) =>
        progressDocuments.push(progressDocument),
      createProviderArtifact: async (_doc, node, context) => {
        context.reportProgress({ message: "Halfway", progress: 0.5 });
        return {
          id: "wf_logs:node_image:image",
          nodeId: node.id,
          portId: "image",
          type: "image",
          label: "Image",
          preview: "done",
        } satisfies WorkflowArtifact;
      },
    });

    expect(
      execution.document.nodes.find((node) => node.id === "node_image"),
    ).toMatchObject({
      runtimeState: {
        status: "running",
        logs: [
          {
            event: "running",
            at: "2026-06-05T00:00:00.000Z",
            message: "Running Image Generation",
          },
        ],
      },
    });

    const finished = await execution.finished;

    expect(
      progressDocuments[0]?.nodes.find((node) => node.id === "node_image"),
    ).toMatchObject({
      runtimeState: {
        status: "running",
        progress: 0.5,
        logs: [
          {
            event: "running",
            at: "2026-06-05T00:00:00.000Z",
            message: "Running Image Generation",
          },
          {
            event: "progress",
            at: "2026-06-05T00:00:01.000Z",
            message: "Halfway",
          },
        ],
      },
    });
    expect(
      finished.nodes.find((node) => node.id === "node_image"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        logs: [
          {
            event: "running",
            at: "2026-06-05T00:00:00.000Z",
            message: "Running Image Generation",
          },
          {
            event: "progress",
            at: "2026-06-05T00:00:01.000Z",
            message: "Halfway",
          },
          {
            event: "completed",
            at: "2026-06-05T00:00:02.000Z",
            message: "Placeholder image artifact ready",
          },
        ],
      },
    });
  });

  it("records cancellation events for aborted provider nodes", async () => {
    const controller = new AbortController();
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_cancel_logs", title: "Logs" }),
    );

    const execution = startWorkflowStepExecution(document, {
      signal: controller.signal,
      now: fixedClock(["2026-06-05T00:00:00.000Z", "2026-06-05T00:00:01.000Z"]),
      createProviderArtifact: () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });

    const finished = await execution.finished;

    expect(
      finished.nodes.find((node) => node.id === "node_image"),
    ).toMatchObject({
      runtimeState: {
        status: "cancelled",
        message: "Execution cancelled",
        logs: [
          {
            event: "running",
            at: "2026-06-05T00:00:00.000Z",
            message: "Running Image Generation",
          },
          {
            event: "cancelled",
            at: "2026-06-05T00:00:01.000Z",
            message: "Execution cancelled",
          },
        ],
      },
    });
  });
});
