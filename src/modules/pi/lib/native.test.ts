import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { piNative } from "./native";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("piNative", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useWorkspaceEnvStore.getState().setEnv({ kind: "local" });
  });

  it("passes the explicit workspace cwd when creating Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionCreate("Plan", "/Users/me/project");

    expect(invoke).toHaveBeenCalledWith("pi_session_create", {
      title: "Plan",
      cwd: "/Users/me/project",
      providerConfig: null,
      workspace: { kind: "local" },
    });
  });

  it("passes validated turn context when sending Pi prompts", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });

    await piNative.sessionSend("pi-1", "Where am I?", {
      workspaceRoot: "/Users/me/project",
      activeTerminalCwd: "/Users/me/project/src",
      activeFile: "/Users/me/project/src/App.tsx",
      activeTerminalPrivate: true,
    });

    expect(invoke).toHaveBeenCalledWith("pi_session_send", {
      sessionId: "pi-1",
      prompt: "Where am I?",
      context: {
        workspaceRoot: "/Users/me/project",
        activeTerminalCwd: "/Users/me/project/src",
        activeFile: "/Users/me/project/src/App.tsx",
        activeTerminalPrivate: true,
      },
      regenerateBranchGroupId: null,
      workspace: { kind: "local" },
    });
  });

  it("passes branch metadata when regenerating a Pi response", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });

    await piNative.sessionSend(
      "pi-1",
      "Try again",
      { workspaceRoot: "/Users/me/project" },
      { regenerateBranchGroupId: "turn-1" },
    );

    expect(invoke).toHaveBeenCalledWith("pi_session_send", {
      sessionId: "pi-1",
      prompt: "Try again",
      context: { workspaceRoot: "/Users/me/project" },
      regenerateBranchGroupId: "turn-1",
      workspace: { kind: "local" },
    });
  });

  it("passes the selected thinking level when sending Pi prompts", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });

    await piNative.sessionSend("pi-1", "Think", null, {
      thinkingLevel: "high",
    });

    expect(invoke).toHaveBeenCalledWith("pi_session_send", {
      sessionId: "pi-1",
      prompt: "Think",
      context: null,
      regenerateBranchGroupId: null,
      thinkingLevel: "high",
      workspace: { kind: "local" },
    });
  });

  it("resumes Pi sessions in the current workspace environment", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionResume("pi-1", {
      authMode: "profile",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      sourceModelId: "claude-sonnet-4-5",
      thinkingLevel: "medium",
    });

    expect(invoke).toHaveBeenCalledWith("pi_session_resume", {
      sessionId: "pi-1",
      providerConfig: {
        authMode: "profile",
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        sourceModelId: "claude-sonnet-4-5",
        thinkingLevel: "medium",
      },
      workspace: { kind: "local" },
    });
  });

  it("renames Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionRename("pi-1", "Reviewed plan");

    expect(invoke).toHaveBeenCalledWith("pi_session_rename", {
      sessionId: "pi-1",
      title: "Reviewed plan",
    });
  });

  it("responds to Pi tool approvals", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionToolRespond("pi-1", "tool-call-1", false);

    expect(invoke).toHaveBeenCalledWith("pi_session_tool_respond", {
      sessionId: "pi-1",
      toolCallId: "tool-call-1",
      approved: false,
    });
  });

  it("deletes Pi sessions", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ session: null, events: [] });

    await piNative.sessionDelete("pi-1");

    expect(invoke).toHaveBeenCalledWith("pi_session_delete", {
      sessionId: "pi-1",
    });
  });

  it("requests the Pi profile model catalog", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ models: [] });

    await piNative.modelsList();

    expect(invoke).toHaveBeenCalledWith("pi_models_list");
  });

  it("requests the local CLI agent detection catalog for the current workspace", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ agents: [] });
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });

    await piNative.localAgentsStatus();

    expect(invoke).toHaveBeenCalledWith("pi_local_agents_status", {
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });
});
