import { describe, expect, it } from "vitest";
import { executeWorkflowStep, executeWorkflowStepAsync } from "./execution";
import { createOpenAIAudioWorkflowProviderAdapter } from "./openAiAudioAdapter";
import { registerWorkflowProviderAdapter } from "./providerAdapter";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
  type WorkflowDocument,
} from "./schema";

describe("OpenAI workflow audio provider adapter", () => {
  it("calls the OpenAI Audio API and returns a generated audio artifact", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(new TextEncoder().encode("fake-wav"), {
        headers: { "content-type": "audio/wav" },
        status: 200,
      });
    };
    const unregister = registerWorkflowProviderAdapter(
      createOpenAIAudioWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => "sk-test-secret",
      }),
    );

    try {
      const configured = audioWorkflowDocument({
        id: "wf_openai_audio",
        config: {
          model: "gpt-4o-mini-tts",
          provider: "openai",
          responseFormat: "wav",
          speed: 1.1,
          voice: "nova",
        },
      });
      const promptReady = executeWorkflowStep(configured);
      const progressMessages: string[] = [];

      const finished = await executeWorkflowStepAsync(promptReady, {
        onProgress: (document) => {
          const audioNode = document.nodes.find(
            (node) => node.id === "node_audio",
          );
          if (audioNode?.runtimeState.message) {
            progressMessages.push(audioNode.runtimeState.message);
          }
        },
      });

      expect(fetchCalls).toHaveLength(1);
      expect(String(fetchCalls[0].input)).toBe(
        "https://api.openai.com/v1/audio/speech",
      );
      expect(fetchCalls[0].init?.method).toBe("POST");
      expect(fetchCalls[0].init?.headers).toMatchObject({
        Authorization: "Bearer sk-test-secret",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
        input: "A cinematic robot pianist in a neon studio",
        model: "gpt-4o-mini-tts",
        response_format: "wav",
        speed: 1.1,
        voice: "nova",
      });
      expect(progressMessages).toEqual([
        "Requesting OpenAI audio",
        "OpenAI audio received",
      ]);

      const artifact = finished.artifacts.find(
        (candidate) => candidate.nodeId === "node_audio",
      );
      expect(artifact).toMatchObject({
        id: "wf_openai_audio:node_audio:audio",
        type: "audio",
        preview: "data:audio/wav;base64,ZmFrZS13YXY=",
        value: {
          adapterId: "openai-audio",
          model: "gpt-4o-mini-tts",
          provider: "openai",
          responseFormat: "wav",
          voice: "nova",
        },
      });
      expect(JSON.stringify(artifact?.value)).not.toContain("sk-test-secret");
      expect(
        finished.nodes.find((node) => node.id === "node_audio")?.runtimeState,
      ).toMatchObject({
        status: "completed",
        artifactIds: ["wf_openai_audio:node_audio:audio"],
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
      createOpenAIAudioWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => null,
      }),
    );

    try {
      const configured = audioWorkflowDocument({
        id: "wf_missing_audio_key",
        config: { provider: "openai" },
      });
      const promptReady = executeWorkflowStep(configured);
      const finished = await executeWorkflowStepAsync(promptReady, {
        now: () => "2026-06-05T00:00:00.000Z",
      });

      expect(
        finished.nodes.find((node) => node.id === "node_audio")?.runtimeState,
      ).toMatchObject({
        status: "failed",
        errorCode: "auth",
        message:
          "No API key configured for OpenAI. Open Settings → AI to add one.",
      });
    } finally {
      unregister();
    }
  });
});

function audioWorkflowDocument(input: {
  id: string;
  config: Record<string, unknown>;
}): WorkflowDocument {
  const starter = createStarterWorkflowDocument({
    id: input.id,
    title: "Audio",
  });
  const promptOnly: WorkflowDocument = {
    ...starter,
    nodes: starter.nodes.filter((node) => node.id === "node_prompt"),
    edges: [],
  };
  const withAudio = addWorkflowNode(promptOnly, {
    id: "node_audio",
    type: "audioGeneration",
    position: { x: 420, y: 100 },
  });
  return updateWorkflowNodeConfig(
    {
      ...withAudio,
      edges: [
        {
          id: "edge_prompt_audio",
          sourceNodeId: "node_prompt",
          sourcePortId: "text",
          targetNodeId: "node_audio",
          targetPortId: "prompt",
        },
      ],
    },
    "node_audio",
    input.config,
  );
}
