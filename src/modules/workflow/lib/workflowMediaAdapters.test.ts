import { describe, expect, it } from "vitest";
import { listWorkflowProviderAdapters } from "./providerAdapter";
import { registerDefaultWorkflowMediaAdapters } from "./workflowMediaAdapters";

describe("workflow media adapter registration", () => {
  it("registers the default OpenAI media adapters once", () => {
    const cleanupOne = registerDefaultWorkflowMediaAdapters({
      getOpenAIApiKey: () => "sk-test",
    });
    const cleanupTwo = registerDefaultWorkflowMediaAdapters({
      getOpenAIApiKey: () => "sk-test-2",
    });

    try {
      expect(
        listWorkflowProviderAdapters().filter((adapter) =>
          ["openai-image", "openai-audio", "openai-video"].includes(adapter.id),
        ),
      ).toHaveLength(3);
      expect(
        listWorkflowProviderAdapters().filter(
          (adapter) => adapter.id === "openai-audio",
        ),
      ).toHaveLength(1);
      expect(
        listWorkflowProviderAdapters().filter(
          (adapter) => adapter.id === "openai-video",
        ),
      ).toHaveLength(1);
    } finally {
      cleanupTwo();
      cleanupOne();
    }

    expect(
      listWorkflowProviderAdapters().filter((adapter) =>
        ["openai-image", "openai-audio", "openai-video"].includes(adapter.id),
      ),
    ).toHaveLength(0);
  });
});
