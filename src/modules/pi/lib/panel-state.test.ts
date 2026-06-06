import { describe, expect, it } from "vitest";
import type { PiProviderResolution } from "@/modules/pi/lib/provider";
import type { PiSession } from "@/modules/pi/lib/sessions";
import { buildPiPanelState } from "./panel-state";

const provider: PiProviderResolution = {
  ok: true,
  provider: "anthropic",
  providerLabel: "Anthropic",
  modelLabel: "Claude",
  config: {
    authMode: "terax",
    provider: "anthropic",
    modelId: "claude-test",
    sourceModelId: "claude-test",
  },
};

function session(id: string, status: PiSession["status"]): PiSession {
  return {
    id,
    title: id,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastPrompt: null,
  };
}

function buildState(
  overrides: Partial<Parameters<typeof buildPiPanelState>[0]> = {},
) {
  return buildPiPanelState({
    activeCwd: null,
    activeFile: null,
    activeTerminalPrivate: false,
    diagnostics: null,
    diagnosticsError: null,
    historyError: null,
    isBusy: false,
    prompt: "Explain this workspace",
    provider,
    providerKeyStatus: { configured: true, required: true, supported: true },
    runtimeState: { phase: "ready", detail: null },
    selectedSessionId: "pi-session",
    sessionEvents: [],
    sessions: [session("pi-session", "idle")],
    workspaceRoot: "/repo",
    ...overrides,
  });
}

describe("buildPiPanelState", () => {
  it("centralizes send/create state for a ready idle session", () => {
    const state = buildState();

    expect(state.runtime.ready).toBe(true);
    expect(state.sessions.selected?.id).toBe("pi-session");
    expect(state.composer).toMatchObject({
      canCreateSession: true,
      canSend: true,
      canStop: false,
      contextUsage: expect.objectContaining({ contextWindow: 128_000 }),
      running: false,
      sendDisabledReason: null,
      thinkingLevel: null,
      queuedPrompts: [],
      selectedModel: {
        providerLabel: "Anthropic",
        modelLabel: "Claude",
      },
    });
  });

  it("estimates composer context usage from selected conversation history", () => {
    const sessionEvents = [
      {
        id: "evt-1",
        type: "session.input",
        sessionId: "pi-session",
        createdAt: "2026-01-01T00:00:01.000Z",
        payload: { text: "Summarize this file for me" },
      },
      {
        id: "evt-2",
        type: "session.output.text",
        sessionId: "pi-session",
        createdAt: "2026-01-01T00:00:02.000Z",
        payload: { text: "This file renders the Pi panel." },
      },
    ];

    const state = buildState({
      activeCwd: "/repo/src",
      activeFile: "/repo/src/App.tsx",
      prompt: "x".repeat(500),
      sessionEvents,
    });

    expect(state.composer.contextUsage).toEqual({
      tokens: expect.any(Number),
      contextWindow: 128_000,
      percent: expect.any(Number),
    });
    expect(state.composer.contextUsage?.tokens).toBeGreaterThan(0);
    expect(state.composer.contextUsage?.percent).toBeGreaterThan(0);
  });

  it("does not count unsent draft text as used model context", () => {
    const sessionEvents = [
      {
        id: "evt-1",
        type: "session.input",
        sessionId: "pi-session",
        createdAt: "2026-01-01T00:00:01.000Z",
        payload: { text: "What changed?" },
      },
      {
        id: "evt-2",
        type: "session.output.text",
        sessionId: "pi-session",
        createdAt: "2026-01-01T00:00:02.000Z",
        payload: { text: "The sidebar changed." },
      },
    ];

    const shortDraft = buildState({ prompt: "short", sessionEvents }).composer
      .contextUsage;
    const longDraft = buildState({ prompt: "x".repeat(1_000), sessionEvents })
      .composer.contextUsage;

    expect(shortDraft?.tokens).toBeGreaterThan(0);
    expect(longDraft?.tokens).toBe(shortDraft?.tokens);
  });

  it("keeps context estimation safe for circular runtime tool input", () => {
    const input: Record<string, unknown> = { path: "package.json" };
    input.self = input;

    const state = buildState({
      sessionEvents: [
        {
          id: "evt-1",
          type: "session.tool.start",
          sessionId: "pi-session",
          createdAt: "2026-01-01T00:00:01.000Z",
          payload: {
            toolCallId: "call-1",
            toolName: "read",
            input,
          },
        },
      ],
    });

    expect(state.composer.contextUsage?.tokens).toBeGreaterThan(0);
  });

  it("does not inflate context usage with structured tool metadata", () => {
    const state = buildState({
      sessionEvents: [
        {
          id: "evt-1",
          type: "session.input",
          sessionId: "pi-session",
          createdAt: "2026-01-01T00:00:01.000Z",
          payload: { text: "Read the package metadata" },
        },
        {
          id: "evt-2",
          type: "session.tool.result",
          sessionId: "pi-session",
          createdAt: "2026-01-01T00:00:02.000Z",
          payload: {
            toolCallId: "call-1",
            toolName: "read",
            output: {
              content: '{"name":"terax"}',
              details: { rawListing: "x".repeat(40_000) },
            },
            isError: false,
          },
        },
      ],
    });

    expect(state.composer.contextUsage?.tokens).toBeLessThan(1_000);
  });

  it("uses custom provider context limits for composer context usage", () => {
    const state = buildState({
      provider: {
        ok: true,
        provider: "openai-compatible",
        providerLabel: "OpenAI Compatible",
        modelLabel: "Local API",
        config: {
          authMode: "terax",
          provider: "openai-compatible",
          modelId: "local-model",
          sourceModelId: "openai-compatible-custom",
          contextLimit: 32_000,
        },
      },
      prompt: "Explain the logs",
    });

    expect(state.composer.contextUsage?.contextWindow).toBe(32_000);
  });

  it("offers thinking levels for known reasoning models", () => {
    const state = buildState({
      provider: {
        ok: true,
        provider: "openai",
        providerLabel: "OpenAI",
        modelLabel: "GPT-5.5",
        config: {
          authMode: "terax",
          provider: "openai",
          modelId: "gpt-5.5",
          sourceModelId: "gpt-5.5",
        },
      },
      thinkingLevel: "high",
    });

    expect(state.composer.availableThinkingLevels).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(state.composer.thinkingLevel).toBe("high");
  });

  it("uses the selected session thinking level when there is no local override", () => {
    const state = buildState({
      provider: {
        ok: true,
        provider: "openai",
        providerLabel: "OpenAI",
        modelLabel: "GPT-5.5",
        config: {
          authMode: "terax",
          provider: "openai",
          modelId: "gpt-5.5",
          sourceModelId: "gpt-5.5",
        },
      },
      sessions: [
        {
          ...session("pi-session", "idle"),
          thinkingLevel: "high",
        } as PiSession,
      ],
      thinkingLevel: null,
    });

    expect(state.composer.thinkingLevel).toBe("high");
  });

  it("offers thinking levels for known reasoning profile models", () => {
    const state = buildState({
      provider: {
        ok: true,
        provider: "openai-codex",
        providerLabel: "OpenAI Codex",
        modelLabel: "GPT-5.5",
        config: {
          authMode: "profile",
          provider: "openai-codex",
          modelId: "gpt-5.5",
          sourceModelId: "pi-profile:openai-codex:gpt-5.5",
        },
      },
      thinkingLevel: "high",
    });

    expect(state.composer.availableThinkingLevels).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(state.composer.thinkingLevel).toBe("high");
  });

  it("hides thinking levels for non-reasoning models", () => {
    const state = buildState({
      provider: {
        ok: true,
        provider: "openai",
        providerLabel: "OpenAI",
        modelLabel: "GPT-5.4 mini",
        config: {
          authMode: "terax",
          provider: "openai",
          modelId: "gpt-5.4-mini",
          sourceModelId: "gpt-5.4-mini",
        },
      },
      thinkingLevel: "high",
    });

    expect(state.composer.availableThinkingLevels).toEqual([]);
    expect(state.composer.thinkingLevel).toBeNull();
  });

  it("explains why the composer cannot send when runtime is stopped", () => {
    const state = buildState({
      runtimeState: { phase: "disconnected", detail: null },
    });

    expect(state.runtime.ready).toBe(false);
    expect(state.composer.canSend).toBe(false);
    expect(state.composer.canCreateSession).toBe(false);
    expect(state.composer.sendDisabledReason).toBe("Start Pi to send prompts.");
  });

  it("blocks sends for running sessions while keeping stop available", () => {
    const state = buildState({
      sessions: [session("pi-session", "running")],
    });

    expect(state.composer.running).toBe(true);
    expect(state.composer.canSend).toBe(false);
    expect(state.composer.canStop).toBe(true);
    expect(state.composer.sendDisabledReason).toBe(
      "Pi is responding. Stop it before sending another prompt.",
    );
  });

  it("requires a valid provider and workspace before creating sessions", () => {
    const invalidProvider: PiProviderResolution = {
      ok: false,
      provider: "anthropic",
      providerLabel: "Anthropic",
      modelLabel: "Claude",
      error: "Choose a model.",
      config: null,
    };

    const state = buildState({
      provider: invalidProvider,
      workspaceRoot: null,
    });

    expect(state.composer.canCreateSession).toBe(false);
    expect(state.composer.selectedModel).toBeNull();
    expect(state.diagnostics.view.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(["workspace-missing", "provider-unavailable"]),
    );
  });
});
