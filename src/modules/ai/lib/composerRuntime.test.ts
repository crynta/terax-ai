import { describe, expect, it, vi } from "vitest";
import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import type {
  PiSession,
  PiSessionCreateResult,
  PiSessionSendResult,
  PiSessionStopResult,
} from "@/modules/pi/lib/sessions";
import {
  PI_COMPOSER_RUNTIME_STORAGE_KEY,
  createPiComposerRuntime,
  isPiComposerRuntimeEnabled,
  type PiComposerRuntimeDeps,
  type PiComposerSessionState,
} from "./composerRuntime";

function session(id: string): PiSession {
  return {
    id,
    title: "Quick ask",
    cwd: "/repo/src",
    status: "idle",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    lastPrompt: null,
  };
}

function deps(createdSession = session("pi-1")) {
  const createResult: PiSessionCreateResult = {
    session: createdSession,
    events: [],
  };
  const sendResult: PiSessionSendResult = {
    accepted: true,
    session: createdSession,
    events: [],
  };
  const stopResult: PiSessionStopResult = {
    session: { ...createdSession, status: "stopped" },
    events: [],
  };
  return {
    createSession: vi.fn(async () => createResult),
    publishEvents: vi.fn(async () => undefined),
    sendSession: vi.fn(async () => sendResult),
    stopSession: vi.fn(async () => stopResult),
  } satisfies PiComposerRuntimeDeps;
}

const providerConfig: PiProviderRuntimeConfig = {
  authMode: "terax",
  provider: "openai-compatible",
  modelId: "zai/glm-4.5",
  sourceModelId: "compat:zai",
  baseUrl: "https://z.ai/api/paas/v4",
  customEndpointId: "zai",
};

describe("isPiComposerRuntimeEnabled", () => {
  it("keeps chat as the default unless the localStorage gate selects Pi", () => {
    expect(isPiComposerRuntimeEnabled(null)).toBe(false);
    expect(isPiComposerRuntimeEnabled({ getItem: () => null })).toBe(false);
    expect(
      isPiComposerRuntimeEnabled({
        getItem: (key) =>
          key === PI_COMPOSER_RUNTIME_STORAGE_KEY ? "pi" : null,
      }),
    ).toBe(true);
  });
});

describe("createPiComposerRuntime", () => {
  it("creates a Pi session, sends selection text with prompt context, and reuses it", async () => {
    const runtimeDeps = deps();
    const state: PiComposerSessionState = { sessionId: null };
    const onActivateSession = vi.fn();
    const onSelectedSessionChange = vi.fn();
    const runtime = createPiComposerRuntime({
      deps: runtimeDeps,
      state,
      context: {
        workspaceRoot: "/repo",
        activeCwd: "/repo/src",
        activeFile: "/repo/src/App.tsx",
        activeTerminalPrivate: true,
      },
      providerConfig,
      providerReady: true,
      selectedSessionId: null,
      onActivateSession,
      onSelectedSessionChange,
    });

    await runtime.send([
      {
        type: "text",
        text: '<selection source="editor">\nconst value = 1;\n</selection>\n\nExplain this selection.',
      },
    ]);

    expect(runtimeDeps.createSession).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.createSession).toHaveBeenCalledWith(
      "Quick ask",
      "/repo/src",
      providerConfig,
    );
    expect(runtimeDeps.publishEvents).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.sendSession).toHaveBeenCalledWith(
      "pi-1",
      '<selection source="editor">\nconst value = 1;\n</selection>\n\nExplain this selection.',
      {
        workspaceRoot: "/repo",
        activeTerminalCwd: "/repo/src",
        activeFile: "/repo/src/App.tsx",
        activeTerminalPrivate: true,
      },
    );
    expect(onSelectedSessionChange).toHaveBeenCalledWith("pi-1");
    expect(onActivateSession).toHaveBeenCalledWith("pi-1");

    await runtime.send([{ type: "text", text: "Follow up" }]);

    expect(runtimeDeps.createSession).toHaveBeenCalledTimes(1);
    expect(runtimeDeps.sendSession).toHaveBeenLastCalledWith(
      "pi-1",
      "Follow up",
      {
        workspaceRoot: "/repo",
        activeTerminalCwd: "/repo/src",
        activeFile: "/repo/src/App.tsx",
        activeTerminalPrivate: true,
      },
    );
  });

  it("uses the selected Pi session and stops that session", async () => {
    const runtimeDeps = deps(session("selected-pi"));
    const runtime = createPiComposerRuntime({
      deps: runtimeDeps,
      state: { sessionId: null },
      context: {
        workspaceRoot: "/repo",
        activeCwd: "/repo",
        activeFile: null,
        activeTerminalPrivate: false,
      },
      providerConfig,
      providerReady: true,
      selectedSessionId: "selected-pi",
    });

    await runtime.send([{ type: "text", text: "Use current session" }]);
    await runtime.stop();

    expect(runtimeDeps.createSession).not.toHaveBeenCalled();
    expect(runtimeDeps.sendSession).toHaveBeenCalledWith(
      "selected-pi",
      "Use current session",
      {
        workspaceRoot: "/repo",
        activeTerminalCwd: "/repo",
        activeFile: null,
        activeTerminalPrivate: false,
      },
    );
    expect(runtimeDeps.stopSession).toHaveBeenCalledWith("selected-pi");
  });
});
