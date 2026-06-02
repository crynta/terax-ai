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
      workspace: { kind: "local" },
    });
  });
});
