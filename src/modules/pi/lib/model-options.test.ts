import { describe, expect, it } from "vitest";
import type { ProviderId } from "@/modules/ai/config";
import {
  getPiModelProviderGroups,
  getPiProfileModelGroups,
} from "@/modules/pi/lib/model-options";

describe("getPiProfileModelGroups", () => {
  it("groups refreshed Pi profile models by provider without exposing secrets", () => {
    const groups = getPiProfileModelGroups({
      profileAgentDir: "/Users/me/.pi/agent",
      loadError: null,
      models: [
        {
          provider: "openai-codex",
          providerLabel: "OpenAI Codex",
          id: "gpt-5.3-codex",
          label: "GPT-5.3 Codex",
          available: true,
          contextWindow: 400_000,
          maxTokens: 32_000,
          reasoning: true,
        },
        {
          provider: "anthropic",
          providerLabel: "Anthropic",
          id: "claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          available: false,
          contextWindow: 200_000,
          maxTokens: 64_000,
          reasoning: false,
        },
        {
          provider: "openai-codex",
          providerLabel: "OpenAI Codex",
          id: "gpt-5.4-codex-mini",
          label: "GPT-5.4 Codex Mini",
          available: true,
          contextWindow: null,
          maxTokens: null,
          reasoning: false,
        },
      ],
    });

    expect(groups).toEqual([
      {
        provider: "openai-codex",
        providerLabel: "OpenAI Codex",
        models: [
          expect.objectContaining({ id: "gpt-5.3-codex" }),
          expect.objectContaining({ id: "gpt-5.4-codex-mini" }),
        ],
      },
      {
        provider: "anthropic",
        providerLabel: "Anthropic",
        models: [expect.objectContaining({ id: "claude-sonnet-4-6" })],
      },
    ]);
    expect(JSON.stringify(groups)).not.toContain("sk-");
  });
});

describe("getPiModelProviderGroups", () => {
  it("includes unconfigured providers so Pi models are selectable before setup", () => {
    const groups = getPiModelProviderGroups(new Set<ProviderId>(["ollama"]));

    expect(groups.map((group) => group.provider.id)).toContain("anthropic");
    expect(groups.find((group) => group.provider.id === "anthropic"))
      .toMatchObject({ setupRequired: true });
    expect(groups.find((group) => group.provider.id === "ollama"))
      .toMatchObject({ setupRequired: false });
  });

  it("groups selectable Pi models by provider", () => {
    const groups = getPiModelProviderGroups(new Set<ProviderId>());
    const openai = groups.find((group) => group.provider.id === "openai");

    expect(openai?.models.map((model) => model.id)).toContain("gpt-5.4-mini");
    expect(groups.every((group) => group.models.length > 0)).toBe(true);
  });
});
