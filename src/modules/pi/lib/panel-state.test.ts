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

function buildState(overrides: Partial<Parameters<typeof buildPiPanelState>[0]> = {}) {
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
      contextUsage: null,
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

    const state = buildState({ provider: invalidProvider, workspaceRoot: null });

    expect(state.composer.canCreateSession).toBe(false);
    expect(state.composer.selectedModel).toBeNull();
    expect(state.diagnostics.view.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(["workspace-missing", "provider-unavailable"]),
    );
  });
});
