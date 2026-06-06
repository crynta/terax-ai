import { describe, expect, it } from "vitest";
import type { ProviderId } from "@/modules/ai/config";
import {
  countHiddenPiProfileModels,
  countHiddenPiProviderModels,
  getPiModelProviderGroups,
  getPiProfileModelGroups,
} from "@/modules/pi/lib/model-options";

const profileCatalog = {
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
};

describe("getPiProfileModelGroups", () => {
  it("groups only available Pi profile models by provider", () => {
    const groups = getPiProfileModelGroups(profileCatalog);

    expect(groups).toEqual([
      {
        provider: "openai-codex",
        providerLabel: "OpenAI Codex",
        models: [
          expect.objectContaining({ id: "gpt-5.3-codex" }),
          expect.objectContaining({ id: "gpt-5.4-codex-mini" }),
        ],
      },
    ]);
    expect(JSON.stringify(groups)).not.toContain("sk-");
  });

  it("can include unavailable Pi profile models when requested", () => {
    const groups = getPiProfileModelGroups(profileCatalog, {
      showUnavailable: true,
    });

    expect(groups.map((group) => group.provider)).toEqual([
      "openai-codex",
      "anthropic",
    ]);
    expect(
      groups.find((group) => group.provider === "anthropic")?.models,
    ).toEqual([
      expect.objectContaining({ id: "claude-sonnet-4-6", available: false }),
    ]);
    expect(
      countHiddenPiProfileModels(profileCatalog, { showUnavailable: true }),
    ).toBe(0);
  });

  it("searches Pi profile models before grouping and hidden counts", () => {
    const groups = getPiProfileModelGroups(profileCatalog, { query: "mini" });

    expect(groups).toEqual([
      {
        provider: "openai-codex",
        providerLabel: "OpenAI Codex",
        models: [expect.objectContaining({ id: "gpt-5.4-codex-mini" })],
      },
    ]);
    expect(
      countHiddenPiProfileModels(profileCatalog, { query: "claude" }),
    ).toBe(1);
  });

  it("counts unavailable Pi profile models hidden from the picker", () => {
    expect(countHiddenPiProfileModels(profileCatalog)).toBe(1);
  });
});

describe("getPiModelProviderGroups", () => {
  it("includes only configured Terax providers", () => {
    const groups = getPiModelProviderGroups(new Set<ProviderId>(["ollama"]));

    expect(groups.map((group) => group.provider.id)).toEqual(["ollama"]);
    expect(groups.every((group) => group.setupRequired === false)).toBe(true);
  });

  it("can include unavailable Terax providers when requested", () => {
    const groups = getPiModelProviderGroups(new Set<ProviderId>(["ollama"]), {
      query: "claude",
      showUnavailable: true,
    });
    const anthropic = groups.find((group) => group.provider.id === "anthropic");

    expect(anthropic).toMatchObject({ setupRequired: true });
    expect(anthropic?.models.length).toBeGreaterThan(0);
    expect(
      countHiddenPiProviderModels(new Set<ProviderId>(["ollama"]), {
        query: "claude",
        showUnavailable: true,
      }),
    ).toBe(0);
  });

  it("searches Terax models before grouping and hidden counts", () => {
    const groups = getPiModelProviderGroups(new Set<ProviderId>(["openai"]), {
      query: "mini",
    });
    const openai = groups.find((group) => group.provider.id === "openai");

    expect(groups.map((group) => group.provider.id)).toEqual(["openai"]);
    expect(openai?.models.map((model) => model.id)).toContain("gpt-5.4-mini");
    expect(
      countHiddenPiProviderModels(new Set<ProviderId>(["openai"]), {
        query: "claude",
      }),
    ).toBeGreaterThan(0);
  });

  it("counts models hidden because their Terax provider is not configured", () => {
    const hiddenCount = countHiddenPiProviderModels(
      new Set<ProviderId>(["ollama"]),
    );

    expect(hiddenCount).toBeGreaterThan(0);
  });

  it("groups selectable Pi models by configured provider", () => {
    const groups = getPiModelProviderGroups(new Set<ProviderId>(["openai"]));
    const openai = groups.find((group) => group.provider.id === "openai");

    expect(openai?.models.map((model) => model.id)).toContain("gpt-5.4-mini");
    expect(groups.every((group) => group.models.length > 0)).toBe(true);
  });
});
