import { afterEach, describe, expect, it } from "vitest";
import {
  createTeraxNativeToolDefinitions,
  resetNativeToolExecutorForTests,
  setNativeToolExecutorForTests,
} from "./native-tools.js";

describe("createTeraxNativeToolDefinitions", () => {
  afterEach(() => {
    resetNativeToolExecutorForTests();
  });

  it("forwards the session workspace environment to Rust native tool requests", async () => {
    const calls = [];
    setNativeToolExecutorForTests(async (request) => {
      calls.push(request);
      return { content: [{ type: "text", text: "ok" }], details: null };
    });

    const bash = createTeraxNativeToolDefinitions(null, {
      id: "pi-wsl",
      cwd: "/workspace",
      workspaceEnv: { kind: "wsl", distro: "Ubuntu-24.04" },
    }).find((tool) => tool.name === "bash");

    await bash.execute("call-1", { command: "pwd" });

    expect(calls).toEqual([
      expect.objectContaining({
        sessionId: "pi-wsl",
        toolCallId: "call-1",
        toolName: "bash",
        cwd: "/workspace",
        workspaceEnv: { kind: "wsl", distro: "Ubuntu-24.04" },
      }),
    ]);
  });
});
