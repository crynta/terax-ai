import { describe, expect, it } from "vitest";
import { executeWorkflowStep } from "./execution";
import {
  createWorkflowProviderArtifact,
  getWorkflowProviderAdapter,
  listWorkflowProviderAdapters,
  registerWorkflowProviderAdapter,
} from "./providerAdapter";
import { createStarterWorkflowDocument } from "./schema";

describe("workflow provider adapter registry", () => {
  it("registers custom adapters ahead of placeholder fallback", () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_registry", title: "Registry" }),
    );
    const imageNode = document.nodes.find((node) => node.id === "node_image");
    if (!imageNode) throw new Error("missing image node");

    const unregister = registerWorkflowProviderAdapter({
      id: "test-image-provider",
      label: "Test image provider",
      priority: 100,
      supports: (node) => node.type === "imageGeneration",
      createArtifact: (context) => ({
        id: context.artifactId,
        nodeId: context.node.id,
        portId: context.outputPortId,
        type: context.outputType,
        label: "Custom image",
        preview: "custom provider output",
        value: { adapterId: "test-image-provider" },
      }),
    });

    try {
      expect(getWorkflowProviderAdapter(imageNode)?.id).toBe(
        "test-image-provider",
      );
      expect(createWorkflowProviderArtifact(document, imageNode)).toMatchObject(
        {
          label: "Custom image",
          preview: "custom provider output",
          value: { adapterId: "test-image-provider" },
        },
      );
    } finally {
      unregister();
    }

    expect(getWorkflowProviderAdapter(imageNode)?.id).toBe("placeholder-media");
  });

  it("creates previewable deterministic placeholder image artifacts", () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({
        id: "wf_placeholder_preview",
        title: "Placeholder Preview",
      }),
    );
    const imageNode = document.nodes.find((node) => node.id === "node_image");
    if (!imageNode) throw new Error("missing image node");

    const artifact = createWorkflowProviderArtifact(document, imageNode);

    expect(artifact).toMatchObject({
      id: "wf_placeholder_preview:node_image:image",
      type: "image",
      value: {
        adapterId: "placeholder-media",
        provider: "placeholder",
        model: "image",
      },
    });
    expect(artifact?.preview).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = decodeBase64DataUrl(artifact?.preview ?? "");
    expect(svg).toContain("Placeholder image");
    expect(svg).toContain("A cinematic robot pianist");
  });

  it("keeps adapter ids unique", () => {
    const unregister = registerWorkflowProviderAdapter({
      id: "dupe-provider",
      label: "Duplicate provider",
      supports: () => false,
      createArtifact: () => {
        throw new Error("unused");
      },
    });

    try {
      expect(() =>
        registerWorkflowProviderAdapter({
          id: "dupe-provider",
          label: "Duplicate provider 2",
          supports: () => false,
          createArtifact: () => {
            throw new Error("unused");
          },
        }),
      ).toThrow("already registered");
    } finally {
      unregister();
    }
  });

  it("lists adapters in priority order", () => {
    const unregisterLow = registerWorkflowProviderAdapter({
      id: "low-priority-provider",
      label: "Low priority provider",
      priority: -1,
      supports: () => false,
      createArtifact: () => {
        throw new Error("unused");
      },
    });
    const unregisterHigh = registerWorkflowProviderAdapter({
      id: "high-priority-provider",
      label: "High priority provider",
      priority: 50,
      supports: () => false,
      createArtifact: () => {
        throw new Error("unused");
      },
    });

    try {
      expect(
        listWorkflowProviderAdapters().map((adapter) => adapter.id),
      ).toEqual([
        "high-priority-provider",
        "placeholder-media",
        "low-priority-provider",
      ]);
    } finally {
      unregisterHigh();
      unregisterLow();
    }
  });
});

function decodeBase64DataUrl(value: string): string {
  const [, contentBase64 = ""] = value.split(",");
  return Buffer.from(contentBase64, "base64").toString("utf8");
}
