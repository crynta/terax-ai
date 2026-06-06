import { describe, expect, it } from "vitest";
import { executeWorkflowStep, executeWorkflowStepAsync } from "./execution";
import { createOpenAIVideoWorkflowProviderAdapter } from "./openAiVideoAdapter";
import { registerWorkflowProviderAdapter } from "./providerAdapter";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
  type WorkflowArtifact,
  type WorkflowDocument,
  type WorkflowNode,
} from "./schema";

describe("OpenAI workflow video provider adapter", () => {
  it("creates, polls, downloads, and returns a generated video artifact", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    let pollCount = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      const url = String(input);
      if (
        url === "https://api.openai.com/v1/videos" &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          id: "video_123",
          model: "sora-2",
          progress: 0,
          seconds: "4",
          size: "1280x720",
          status: "queued",
        });
      }
      if (url === "https://api.openai.com/v1/videos/video_123") {
        pollCount += 1;
        return jsonResponse(
          pollCount === 1
            ? { id: "video_123", progress: 50, status: "in_progress" }
            : { id: "video_123", progress: 100, status: "completed" },
        );
      }
      if (url === "https://api.openai.com/v1/videos/video_123/content") {
        return new Response(new TextEncoder().encode("fake-mp4"), {
          headers: { "content-type": "video/mp4" },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const unregister = registerWorkflowProviderAdapter(
      createOpenAIVideoWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => "sk-test-secret",
        pollIntervalMs: 0,
        sleep: async () => {},
      }),
    );

    try {
      const configured = videoWorkflowDocument({
        id: "wf_openai_video",
        config: {
          model: "sora-2",
          provider: "openai",
          seconds: 4,
          size: "1280x720",
        },
      });
      const promptReady = executeWorkflowStep(configured);
      const progressMessages: string[] = [];

      const finished = await executeWorkflowStepAsync(promptReady, {
        onProgress: (document) => {
          const videoNode = document.nodes.find(
            (node) => node.id === "node_video",
          );
          if (videoNode?.runtimeState.message) {
            progressMessages.push(videoNode.runtimeState.message);
          }
        },
      });

      expect(fetchCalls.map((call) => String(call.input))).toEqual([
        "https://api.openai.com/v1/videos",
        "https://api.openai.com/v1/videos/video_123",
        "https://api.openai.com/v1/videos/video_123",
        "https://api.openai.com/v1/videos/video_123/content",
      ]);
      expect(fetchCalls[0].init?.method).toBe("POST");
      expect(fetchCalls[0].init?.headers).toMatchObject({
        Authorization: "Bearer sk-test-secret",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
        model: "sora-2",
        prompt: "A cinematic robot pianist in a neon studio",
        seconds: "4",
        size: "1280x720",
      });
      expect(progressMessages).toEqual([
        "Creating OpenAI video",
        "OpenAI video queued",
        "OpenAI video 50%",
        "OpenAI video completed",
        "Downloading OpenAI video",
        "OpenAI video received",
      ]);

      const artifact = finished.artifacts.find(
        (candidate) => candidate.nodeId === "node_video",
      );
      expect(artifact).toMatchObject({
        id: "wf_openai_video:node_video:video",
        preview: "data:video/mp4;base64,ZmFrZS1tcDQ=",
        type: "video",
        value: {
          adapterId: "openai-video",
          model: "sora-2",
          provider: "openai",
          seconds: "4",
          size: "1280x720",
          source: "binary",
          videoId: "video_123",
        },
      });
      expect(JSON.stringify(artifact?.value)).not.toContain("sk-test-secret");
      expect(
        finished.nodes.find((node) => node.id === "node_video")?.runtimeState,
      ).toMatchObject({
        artifactIds: ["wf_openai_video:node_video:video"],
        status: "completed",
      });
    } finally {
      unregister();
    }
  });

  it("sends a data URL image input reference when available", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      const url = String(input);
      if (url === "https://api.openai.com/v1/videos") {
        return jsonResponse({
          id: "video_ref",
          progress: 100,
          status: "completed",
        });
      }
      if (url === "https://api.openai.com/v1/videos/video_ref/content") {
        return new Response(new TextEncoder().encode("ref-mp4"), {
          headers: { "content-type": "video/mp4" },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const unregister = registerWorkflowProviderAdapter(
      createOpenAIVideoWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => "sk-test-secret",
        pollIntervalMs: 0,
        sleep: async () => {},
      }),
    );

    try {
      const document = videoWorkflowDocumentWithImageReference();
      await executeWorkflowStepAsync(document);

      expect(JSON.parse(String(fetchCalls[0].init?.body))).toMatchObject({
        input_reference: {
          image_url: "data:image/png;base64,ZmFrZQ==",
        },
      });
    } finally {
      unregister();
    }
  });

  it("fails before calling fetch when no OpenAI API key is configured", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const unregister = registerWorkflowProviderAdapter(
      createOpenAIVideoWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => null,
      }),
    );

    try {
      const configured = videoWorkflowDocument({
        id: "wf_missing_video_key",
        config: { provider: "openai" },
      });
      const promptReady = executeWorkflowStep(configured);
      const finished = await executeWorkflowStepAsync(promptReady, {
        now: () => "2026-06-05T00:00:00.000Z",
      });

      expect(
        finished.nodes.find((node) => node.id === "node_video")?.runtimeState,
      ).toMatchObject({
        errorCode: "auth",
        message:
          "No API key configured for OpenAI. Open Settings → AI to add one.",
        status: "failed",
      });
    } finally {
      unregister();
    }
  });
});

function videoWorkflowDocument(input: {
  id: string;
  config: Record<string, unknown>;
}): WorkflowDocument {
  const starter = createStarterWorkflowDocument({
    id: input.id,
    title: "Video",
  });
  const promptOnly: WorkflowDocument = {
    ...starter,
    edges: [],
    nodes: starter.nodes.filter((node) => node.id === "node_prompt"),
  };
  const withVideo = addWorkflowNode(promptOnly, {
    id: "node_video",
    position: { x: 420, y: 100 },
    type: "videoGeneration",
  });
  return updateWorkflowNodeConfig(
    {
      ...withVideo,
      edges: [
        {
          id: "edge_prompt_video",
          sourceNodeId: "node_prompt",
          sourcePortId: "text",
          targetNodeId: "node_video",
          targetPortId: "prompt",
        },
      ],
    },
    "node_video",
    input.config,
  );
}

function videoWorkflowDocumentWithImageReference(): WorkflowDocument {
  const document = videoWorkflowDocument({
    config: { provider: "openai" },
    id: "wf_openai_video_ref",
  });
  const promptArtifact: WorkflowArtifact = {
    id: "prompt-artifact",
    label: "Prompt",
    nodeId: "node_prompt",
    portId: "text",
    preview: "A cinematic robot pianist in a neon studio",
    type: "text",
  };
  const imageNode: WorkflowNode = {
    id: "node_image_ref",
    config: {},
    inputs: [],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    position: { x: 80, y: 360 },
    runtimeState: { artifactIds: ["image-artifact"], status: "completed" },
    size: { width: 240, height: 160 },
    title: "Reference Image",
    type: "imageGeneration",
    uiState: {},
  };
  const imageArtifact: WorkflowArtifact = {
    id: "image-artifact",
    label: "Reference Image",
    nodeId: "node_image_ref",
    portId: "image",
    preview: "data:image/png;base64,ZmFrZQ==",
    type: "image",
  };

  return {
    ...document,
    artifacts: [promptArtifact, imageArtifact],
    edges: [
      {
        id: "edge_prompt_video",
        sourceNodeId: "node_prompt",
        sourcePortId: "text",
        targetNodeId: "node_video",
        targetPortId: "prompt",
      },
      {
        id: "edge_image_video",
        sourceNodeId: "node_image_ref",
        sourcePortId: "image",
        targetNodeId: "node_video",
        targetPortId: "image",
      },
    ],
    nodes: [
      ...document.nodes.map((node) =>
        node.id === "node_prompt"
          ? {
              ...node,
              runtimeState: {
                artifactIds: ["prompt-artifact"],
                status: "completed" as const,
              },
            }
          : node,
      ),
      imageNode,
    ],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
