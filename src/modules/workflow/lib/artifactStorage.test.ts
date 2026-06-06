import { describe, expect, it } from "vitest";
import {
  artifactPreviewSource,
  collectReusableWorkflowArtifacts,
  collectWorkflowArtifactGallery,
  describeWorkflowArtifactPreview,
  persistWorkflowArtifactBinaryFile,
  persistWorkflowArtifactFile,
  removeWorkflowArtifact,
  workflowArtifactBinaryStoragePath,
  workflowArtifactPreviewDetails,
  workflowArtifactStorageDirectory,
  workflowArtifactStoragePath,
} from "./artifactStorage";
import { createStarterWorkflowDocument, type WorkflowArtifact } from "./schema";

describe("workflow artifact storage", () => {
  const artifact: WorkflowArtifact = {
    id: "wf_demo:node_image:image",
    nodeId: "node_image",
    portId: "image",
    type: "image",
    label: "Image Generation",
    preview: "data:image/png;base64,ZmFrZQ==",
    value: { prompt: "robot pianist" },
  };

  it("builds stable safe artifact file paths", () => {
    expect(
      workflowArtifactStoragePath({
        baseDirectory: "/repo/.terax-artifacts",
        artifact,
      }),
    ).toBe("/repo/.terax-artifacts/wf_demo-node_image-image.image.json");
  });

  it("builds stable storage directories beside workflow files", () => {
    expect(
      workflowArtifactStorageDirectory({
        workflowFilePath: "/repo/flows/demo.workflow.json",
        documentId: "wf:Demo Flow",
      }),
    ).toBe("/repo/flows/.terax-workflow-artifacts/wf-Demo-Flow");
  });

  it("builds stable binary artifact file paths from media types", () => {
    expect(
      workflowArtifactBinaryStoragePath({
        baseDirectory: "/repo/.terax-artifacts",
        artifact,
        mediaType: "image/png",
      }),
    ).toBe("/repo/.terax-artifacts/wf_demo-node_image-image.png");
    expect(
      workflowArtifactBinaryStoragePath({
        baseDirectory: "/repo/.terax-artifacts",
        artifact,
        mediaType: "image/svg+xml",
      }),
    ).toBe("/repo/.terax-artifacts/wf_demo-node_image-image.svg");
  });

  it("writes artifact envelopes through an injected file system", async () => {
    const writes: Array<{ path: string; content: string; source: string }> = [];

    const stored = await persistWorkflowArtifactFile(artifact, {
      baseDirectory: "/repo/.terax-artifacts",
      fileSystem: {
        writeFile: async (path, content, source) => {
          writes.push({ path, content, source });
        },
      },
      thumbnailPath: "/repo/.terax-artifacts/thumbs/image.png",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(
      "/repo/.terax-artifacts/wf_demo-node_image-image.image.json",
    );
    expect(writes[0]?.source).toBe("workflow-artifact");
    expect(JSON.parse(writes[0]?.content ?? "{}")).toMatchObject({
      id: artifact.id,
      type: "image",
      preview: artifact.preview,
      value: { prompt: "robot pianist" },
    });
    expect(stored.storage).toMatchObject({
      kind: "file",
      path: "/repo/.terax-artifacts/wf_demo-node_image-image.image.json",
      mediaType: "application/json",
      thumbnailPath: "/repo/.terax-artifacts/thumbs/image.png",
    });
    expect(stored.storage?.byteLength).toBeGreaterThan(100);
  });

  it("persists data URL media artifacts as binary files", async () => {
    const writes: Array<{
      path: string;
      contentBase64: string;
      source: string;
    }> = [];
    const directories: string[] = [];

    const stored = await persistWorkflowArtifactBinaryFile(artifact, {
      baseDirectory: "/repo/.terax-artifacts",
      fileSystem: {
        createDirectory: async (path) => {
          directories.push(path);
        },
        writeBase64File: async (path, contentBase64, source) => {
          writes.push({ path, contentBase64, source });
        },
        writeFile: async () => {
          throw new Error("json fallback should not be used for data URLs");
        },
      },
    });

    expect(directories).toEqual(["/repo/.terax-artifacts"]);
    expect(writes).toEqual([
      {
        path: "/repo/.terax-artifacts/wf_demo-node_image-image.png",
        contentBase64: "ZmFrZQ==",
        source: "workflow-artifact-binary",
      },
    ]);
    expect(stored.preview).toBe(
      "/repo/.terax-artifacts/wf_demo-node_image-image.png",
    );
    expect(stored.storage).toMatchObject({
      kind: "file",
      path: "/repo/.terax-artifacts/wf_demo-node_image-image.png",
      mediaType: "image/png",
      byteLength: 4,
      thumbnailPath: "/repo/.terax-artifacts/wf_demo-node_image-image.png",
    });
  });

  it("keeps SVG data URLs as renderable previews after durable persistence", async () => {
    const svgPreview = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const writes: Array<{
      path: string;
      contentBase64: string;
      source: string;
    }> = [];

    const stored = await persistWorkflowArtifactBinaryFile(
      { ...artifact, preview: svgPreview },
      {
        baseDirectory: "/repo/.terax-artifacts",
        fileSystem: {
          createDirectory: async () => {},
          writeBase64File: async (path, contentBase64, source) => {
            writes.push({ path, contentBase64, source });
          },
          writeFile: async () => {
            throw new Error("json fallback should not be used for data URLs");
          },
        },
      },
    );

    expect(writes).toEqual([
      {
        path: "/repo/.terax-artifacts/wf_demo-node_image-image.svg",
        contentBase64: "PHN2Zz48L3N2Zz4=",
        source: "workflow-artifact-binary",
      },
    ]);
    expect(stored.preview).toBe(svgPreview);
    expect(stored.storage).toMatchObject({
      kind: "file",
      path: "/repo/.terax-artifacts/wf_demo-node_image-image.svg",
      mediaType: "image/svg+xml",
      byteLength: 11,
    });
    expect(stored.storage?.thumbnailPath).toBeUndefined();
    expect(artifactPreviewSource(stored)).toBe(svgPreview);
    expect(describeWorkflowArtifactPreview(stored)).toEqual({
      kind: "image",
      source: svgPreview,
      text: "Image Generation",
    });
  });

  it("treats non-renderable image previews as text instead of broken media", () => {
    expect(
      describeWorkflowArtifactPreview({
        ...artifact,
        preview: "Placeholder image artifact from placeholder/image",
        storage: {
          kind: "file",
          path: "/repo/.terax-artifacts/wf_demo-node_image-image.image.json",
          mediaType: "application/json",
        },
      }),
    ).toEqual({
      kind: "text",
      text: "Placeholder image artifact from placeholder/image",
    });
  });

  it("falls back to portable JSON artifact storage for non data URL previews", async () => {
    const writes: Array<{ path: string; content: string; source: string }> = [];

    const stored = await persistWorkflowArtifactBinaryFile(
      { ...artifact, preview: "https://example.com/image.png" },
      {
        baseDirectory: "/repo/.terax-artifacts",
        fileSystem: {
          writeFile: async (path, content, source) => {
            writes.push({ path, content, source });
          },
          writeBase64File: async () => {
            throw new Error("binary writer should not be used for URLs");
          },
        },
      },
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(
      "/repo/.terax-artifacts/wf_demo-node_image-image.image.json",
    );
    expect(stored.storage?.mediaType).toBe("application/json");
  });

  it("collects reusable gallery artifacts by type and recency", () => {
    const textArtifact: WorkflowArtifact = {
      ...artifact,
      id: "text",
      type: "text",
      preview: "Prompt",
    };
    const laterImageArtifact: WorkflowArtifact = {
      ...artifact,
      id: "image-later",
      preview: "data:image/png;base64,bGF0ZXI=",
    };
    const document = {
      ...createStarterWorkflowDocument({ id: "wf_demo", title: "Gallery" }),
      artifacts: [artifact, textArtifact, laterImageArtifact],
    };

    expect(
      collectWorkflowArtifactGallery(document, { types: ["image"] }),
    ).toEqual([artifact, laterImageArtifact]);
    expect(
      collectWorkflowArtifactGallery(document, {
        types: ["image"],
        newestFirst: true,
        limit: 1,
      }),
    ).toEqual([laterImageArtifact]);
  });

  it("prefers durable preview sources for file-backed artifacts", () => {
    expect(
      artifactPreviewSource({
        ...artifact,
        storage: {
          kind: "file",
          path: "/repo/artifact.json",
          thumbnailPath: "/repo/thumb.png",
        },
      }),
    ).toBe("/repo/thumb.png");
    expect(artifactPreviewSource(artifact)).toBe(artifact.preview);
  });

  it("describes artifact preview details without exposing secrets", () => {
    expect(
      workflowArtifactPreviewDetails({
        ...artifact,
        storage: {
          kind: "file",
          path: "/repo/.terax-workflow-artifacts/wf/image.png",
          mediaType: "image/png",
          byteLength: 1536,
        },
        value: {
          provider: "openai",
          model: "gpt-image-2",
          apiKey: "sk-secret",
        },
      }),
    ).toEqual(["image/png", "1.5 KB", "openai:gpt-image-2", "image.png"]);
  });

  it("removes artifacts and stale runtime references", () => {
    const otherArtifact: WorkflowArtifact = {
      ...artifact,
      id: "wf_demo:node_prompt:text",
      nodeId: "node_prompt",
      type: "text",
      preview: "hello",
    };
    const document = {
      ...createStarterWorkflowDocument({ id: "wf_demo", title: "Artifacts" }),
      artifacts: [artifact, otherArtifact],
      nodes: createStarterWorkflowDocument({
        id: "wf_demo",
        title: "Artifacts",
      }).nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              runtimeState: {
                status: "completed" as const,
                artifactIds: [artifact.id, otherArtifact.id],
              },
            }
          : node,
      ),
    };

    const next = removeWorkflowArtifact(document, artifact.id);

    expect(next.artifacts).toEqual([otherArtifact]);
    expect(
      next.nodes.find((node) => node.id === "node_image")?.runtimeState
        .artifactIds,
    ).toEqual([otherArtifact.id]);
  });

  it("describes renderable artifact previews", () => {
    expect(describeWorkflowArtifactPreview(artifact)).toEqual({
      kind: "image",
      source: artifact.preview,
      text: "Image Generation",
    });
    expect(
      describeWorkflowArtifactPreview({
        ...artifact,
        type: "audio",
        preview: "file:///repo/sound.wav",
        storage: {
          kind: "file",
          path: "/repo/sound.wav",
          mediaType: "audio/wav",
        },
      }),
    ).toEqual({
      kind: "audio",
      source: "/repo/sound.wav",
      text: "Image Generation",
    });
    expect(
      describeWorkflowArtifactPreview({
        ...artifact,
        type: "text",
        preview: "hello",
      }),
    ).toEqual({ kind: "text", text: "hello" });
  });

  it("collects reusable artifacts for a node by compatible input type", () => {
    const textArtifact: WorkflowArtifact = {
      id: "text",
      nodeId: "node_prompt",
      type: "text",
      label: "Prompt",
      preview: "Prompt text",
    };
    const imageArtifact: WorkflowArtifact = {
      ...artifact,
      id: "image",
      nodeId: "node_image",
      type: "image",
    };
    const document = {
      ...createStarterWorkflowDocument({ id: "wf_demo", title: "Reuse" }),
      artifacts: [textArtifact, imageArtifact],
    };
    const imageNode = document.nodes.find((node) => node.id === "node_image");
    const outputNode = document.nodes.find((node) => node.id === "node_output");

    expect(
      imageNode && collectReusableWorkflowArtifacts(document, imageNode),
    ).toEqual([textArtifact]);
    expect(
      outputNode && collectReusableWorkflowArtifacts(document, outputNode),
    ).toEqual([imageArtifact]);
  });
});
