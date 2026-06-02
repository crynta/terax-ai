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
      workspace: { kind: "local" },
    });
  });
});
