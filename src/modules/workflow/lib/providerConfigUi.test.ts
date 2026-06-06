import { describe, expect, it } from "vitest";
import {
  workflowDiscoveredProviderModelsFromAiConfig,
  workflowProviderCredentialStatus,
  workflowProviderModelOptions,
  workflowProviderOptionsForNode,
  workflowProviderSettingsForNode,
} from "./providerConfigUi";
import { createWorkflowNode } from "./schema";

describe("workflow provider config UI metadata", () => {
  it("returns node-specific provider and model suggestions", () => {
    expect(workflowProviderOptionsForNode("imageGeneration")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openai", label: "OpenAI" }),
        expect.objectContaining({ id: "placeholder", label: "Placeholder" }),
      ]),
    );
    expect(
      workflowProviderModelOptions(
        createWorkflowNode({
          id: "node_image",
          type: "imageGeneration",
          position: { x: 0, y: 0 },
        }),
        "openai",
      ),
    ).toContain("gpt-image-2");
    expect(
      workflowProviderModelOptions(
        createWorkflowNode({
          id: "node_video",
          type: "videoGeneration",
          position: { x: 0, y: 0 },
        }),
        "openai",
      ),
    ).toContain("sora-2");
  });

  it("uses known provider defaults for generation nodes", () => {
    for (const type of [
      "imageGeneration",
      "videoGeneration",
      "audioGeneration",
    ] as const) {
      const node = createWorkflowNode({
        id: `node_${type}`,
        type,
        position: { x: 0, y: 0 },
      });
      expect(
        workflowProviderOptionsForNode(type).some(
          (option) => option.id === node.config.provider,
        ),
      ).toBe(true);
      expect(workflowProviderModelOptions(node)).toContain(node.config.model);
    }
  });

  it("adds configured model providers to generation provider options", () => {
    const discovered = workflowDiscoveredProviderModelsFromAiConfig({
      apiKeys: { google: "google-key", groq: "groq-key" },
      customEndpoints: [
        {
          id: "local-openai",
          name: "Local OpenAI",
          baseURL: "http://localhost:1234/v1",
          modelId: "local-image-router",
          contextLimit: 128_000,
        },
      ],
    });

    expect(discovered.google).toEqual(
      expect.arrayContaining(["gemini-2.5-flash"]),
    );
    expect(discovered.groq).toEqual(
      expect.arrayContaining(["openai/gpt-oss-20b"]),
    );
    expect(discovered["openai-compatible"]).toEqual(
      expect.arrayContaining(["local-image-router"]),
    );
    expect(
      workflowProviderOptionsForNode("imageGeneration", discovered),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "google", label: "Google" }),
        expect.objectContaining({ id: "groq", label: "Groq" }),
        expect.objectContaining({
          id: "openai-compatible",
          label: "OpenAI Compatible",
        }),
      ]),
    );
  });

  it("merges discovered models and exposes per-provider settings", () => {
    const node = createWorkflowNode({
      id: "node_image",
      type: "imageGeneration",
      position: { x: 0, y: 0 },
    });

    expect(
      workflowProviderModelOptions(node, "openai", {
        openai: ["custom-image-model", "gpt-image-2"],
      }),
    ).toEqual(["gpt-image-2", "gpt-image-1", "custom-image-model"]);
    expect(
      workflowProviderSettingsForNode("imageGeneration", "openai"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "size", label: "Size", kind: "select" }),
        expect.objectContaining({
          key: "quality",
          label: "Quality",
          kind: "select",
        }),
      ]),
    );
  });

  it("classifies provider credential state without exposing key values", () => {
    expect(workflowProviderCredentialStatus("openai", { openai: "" })).toEqual({
      label: "OpenAI key missing",
      providerLabel: "OpenAI",
      status: "missing",
    });
    expect(
      workflowProviderCredentialStatus("openai", { openai: "sk-test-secret" }),
    ).toEqual({
      label: "OpenAI key configured",
      providerLabel: "OpenAI",
      status: "configured",
    });
    expect(workflowProviderCredentialStatus("placeholder", {})).toEqual({
      label: "No key required",
      providerLabel: "Placeholder",
      status: "not-required",
    });
    expect(
      workflowProviderCredentialStatus("google", { google: "key" }),
    ).toEqual({
      label: "Google key configured",
      providerLabel: "Google",
      status: "configured",
    });
  });
});
