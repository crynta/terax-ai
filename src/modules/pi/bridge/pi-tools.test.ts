/**
 * Behavioral tests for the Pi agent tool boundary.
 *
 * The security property under test: every agent-initiated tool call is routed
 * through the Rust verified executor (`pi_agent_tool_execute`), and a user
 * approval is recorded as a single-use grant via `pi_approval_grant`. The
 * webview approval card is UX; Rust enforces policy and the grant (proven by the
 * Rust unit tests in `agent_tools.rs`). These tests lock the IPC contract and
 * tool-name mapping the executor depends on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

import { executeAgentTool, grantAgentTool } from "./pi-tools";

describe("executeAgentTool", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  });

  it("routes through pi_agent_tool_execute with the camelCase request envelope", async () => {
    await executeAgentTool({
      sessionId: "s1",
      toolCallId: "c1",
      toolName: "write",
      cwd: "/work",
      input: { path: "a.txt", content: "x" },
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [command, payload] = mockInvoke.mock.calls[0];
    expect(command).toBe("pi_agent_tool_execute");
    // Keys must match the Rust serde(rename_all = "camelCase") contract on
    // NativeToolRequest, or the executor rejects the call.
    expect(payload).toEqual({
      request: {
        sessionId: "s1",
        toolCallId: "c1",
        toolName: "write",
        cwd: "/work",
        workspaceEnv: { kind: "local" },
        input: { path: "a.txt", content: "x" },
      },
    });
  });

  it("propagates the native result unchanged", async () => {
    mockInvoke.mockResolvedValue({
      content: [{ type: "text", text: "wrote" }],
      details: { mediatedBy: "Terax Rust" },
    });
    const result = await executeAgentTool({
      sessionId: "s1",
      toolCallId: "c1",
      toolName: "read",
      cwd: "/work",
      input: { path: "a.txt" },
    });
    expect(result.content[0].text).toBe("wrote");
  });
});

describe("grantAgentTool", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("records a single-use grant keyed by session, call, and native tool name", async () => {
    await grantAgentTool("s1", "c1", "write");
    expect(mockInvoke).toHaveBeenCalledWith("pi_approval_grant", {
      sessionId: "s1",
      toolCallId: "c1",
      toolName: "write",
    });
  });
});
