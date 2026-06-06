import { describe, expect, it } from "vitest";
import { executeWorkflowStep, executeWorkflowStepAsync } from "./execution";
import { createStarterWorkflowDocument, type WorkflowArtifact } from "./schema";

describe("workflow execution artifact persistence", () => {
  it("persists provider artifacts before completing a node", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_persist", title: "Persist" }),
    );
    const providerArtifact: WorkflowArtifact = {
      id: "wf_persist:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Image Generation",
      preview: "generated image",
    };
    const persistedCalls: Array<{
      artifactId: string;
      documentId: string;
      nodeId: string;
    }> = [];

    const finished = await executeWorkflowStepAsync(document, {
      now: () => "2026-06-05T00:00:00.000Z",
      createProviderArtifact: async () => providerArtifact,
      persistArtifact: async (artifact, sourceDocument, node) => {
        persistedCalls.push({
          artifactId: artifact.id,
          documentId: sourceDocument.id,
          nodeId: node.id,
        });
        return {
          ...artifact,
          storage: {
            kind: "file",
            path: "/tmp/workflow-artifacts/image.json",
            mediaType: "application/json",
            byteLength: 123,
          },
        };
      },
    });

    expect(persistedCalls).toEqual([
      {
        artifactId: "wf_persist:node_image:image",
        documentId: "wf_persist",
        nodeId: "node_image",
      },
    ]);
    expect(
      finished.artifacts.find(
        (artifact) => artifact.id === providerArtifact.id,
      ),
    ).toMatchObject({
      storage: {
        kind: "file",
        path: "/tmp/workflow-artifacts/image.json",
        mediaType: "application/json",
        byteLength: 123,
      },
    });
    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({
      status: "completed",
      artifactIds: ["wf_persist:node_image:image"],
    });
  });

  it("marks the provider node failed when artifact persistence fails", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({
        id: "wf_persist_failure",
        title: "Persist failure",
      }),
    );

    const finished = await executeWorkflowStepAsync(document, {
      now: () => "2026-06-05T00:00:00.000Z",
      createProviderArtifact: async (_document, node) => ({
        id: "wf_persist_failure:node_image:image",
        nodeId: node.id,
        portId: "image",
        type: "image",
        label: "Image Generation",
        preview: "generated image",
      }),
      persistArtifact: async () => {
        throw new Error("Disk full");
      },
    });

    expect(
      finished.artifacts.some(
        (artifact) => artifact.id === "wf_persist_failure:node_image:image",
      ),
    ).toBe(false);
    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({
      status: "failed",
      message: "Disk full",
      errorCode: "unknown",
      logs: expect.arrayContaining([
        {
          event: "failed",
          at: "2026-06-05T00:00:00.000Z",
          message: "Disk full",
        },
      ]),
    });
  });
});
