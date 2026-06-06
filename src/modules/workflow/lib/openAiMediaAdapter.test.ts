import { describe, expect, it } from "vitest";
import { executeWorkflowStep, executeWorkflowStepAsync } from "./execution";
import { createOpenAIImageWorkflowProviderAdapter } from "./openAiMediaAdapter";
import { registerWorkflowProviderAdapter } from "./providerAdapter";
import {
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";

describe("OpenAI workflow image provider adapter", () => {
  it("calls the OpenAI Images API and returns a generated image artifact", async () => {
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: "ZmFrZS1wbmc=",
              revised_prompt: "A cinematic robot pianist",
            },
          ],
          output_format: "png",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    };
    const unregister = registerWorkflowProviderAdapter(
      createOpenAIImageWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => "sk-test-secret",
      }),
    );

    try {
      const configured = updateWorkflowNodeConfig(
        createStarterWorkflowDocument({ id: "wf_openai", title: "OpenAI" }),
        "node_image",
        {
          model: "gpt-image-2",
          provider: "openai",
          quality: "high",
          size: "1024x1024",
        },
      );
      const promptReady = executeWorkflowStep(configured);
      const progressMessages: string[] = [];

      const finished = await executeWorkflowStepAsync(promptReady, {
        onProgress: (document) => {
          const imageNode = document.nodes.find(
            (node) => node.id === "node_image",
          );
          if (imageNode?.runtimeState.message) {
            progressMessages.push(imageNode.runtimeState.message);
          }
        },
      });

      expect(fetchCalls).toHaveLength(1);
      expect(String(fetchCalls[0].input)).toBe(
        "https://api.openai.com/v1/images/generations",
      );
      expect(fetchCalls[0].init?.method).toBe("POST");
      expect(fetchCalls[0].init?.headers).toMatchObject({
        Authorization: "Bearer sk-test-secret",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
        model: "gpt-image-2",
        prompt: "A cinematic robot pianist in a neon studio",
        quality: "high",
        size: "1024x1024",
      });
      expect(progressMessages).toEqual([
        "Requesting OpenAI image",
        "OpenAI image received",
      ]);

      const artifact = finished.artifacts.find(
        (candidate) => candidate.nodeId === "node_image",
      );
      expect(artifact).toMatchObject({
        id: "wf_openai:node_image:image",
        type: "image",
        preview: "data:image/png;base64,ZmFrZS1wbmc=",
        value: {
          adapterId: "openai-image",
          model: "gpt-image-2",
          provider: "openai",
          revisedPrompt: "A cinematic robot pianist",
        },
      });
      expect(JSON.stringify(artifact?.value)).not.toContain("sk-test-secret");
      expect(
        finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
      ).toMatchObject({
        status: "completed",
        artifactIds: ["wf_openai:node_image:image"],
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
      createOpenAIImageWorkflowProviderAdapter({
        fetch: fetchImpl,
        getApiKey: () => null,
      }),
    );

    try {
      const configured = updateWorkflowNodeConfig(
        createStarterWorkflowDocument({
          id: "wf_missing_key",
          title: "OpenAI",
        }),
        "node_image",
        { provider: "openai" },
      );
      const promptReady = executeWorkflowStep(configured);
      const finished = await executeWorkflowStepAsync(promptReady, {
        now: () => "2026-06-05T00:00:00.000Z",
      });

      expect(
        finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
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
