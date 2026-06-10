import { describe, expect, it } from "vitest";
import {
  computeTurnDiff,
  turnDiffSummaryLabel,
  EMPTY_TURN_DIFF,
} from "./turn-diff";
import type { PiSessionEvent } from "./types";
import { PI_SESSION_EVENT } from "./types";

function event(
  type: string,
  overrides?: Partial<PiSessionEvent>,
): PiSessionEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    type,
    sessionId: "test-session",
    createdAt: new Date().toISOString(),
    payload: {},
    ...overrides,
  };
}

describe("computeTurnDiff", () => {
  it("returns empty diff for no events", () => {
    const diff = computeTurnDiff([], null, null);
    expect(diff).toEqual(EMPTY_TURN_DIFF);
  });

  it("extracts file reads from tool events", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: {
          toolName: "read",
          toolCallId: "tc1",
          input: { path: "/src/main.ts" },
        },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: {
          toolName: "read",
          toolCallId: "tc1",
          output: { content: "file contents" },
        },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toEqual({
      path: "/src/main.ts",
      action: "read",
    });
  });

  it("extracts file edits", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: {
          toolName: "edit_file",
          toolCallId: "tc2",
          input: { file_path: "/src/utils.ts" },
        },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: {
          toolName: "edit_file",
          toolCallId: "tc2",
        },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.action).toBe("edited");
    expect(diff.files[0]!.path).toBe("/src/utils.ts");
  });

  it("deduplicates file paths (last action wins)", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: { toolName: "read", toolCallId: "tc1", input: { path: "/src/app.ts" } },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: { toolName: "read", toolCallId: "tc1" },
      }),
      event(PI_SESSION_EVENT.ToolStart, {
        payload: { toolName: "edit_file", toolCallId: "tc2", input: { file_path: "/src/app.ts" } },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: { toolName: "edit_file", toolCallId: "tc2" },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.files).toHaveLength(1);
    // edited > read in priority
    expect(diff.files[0]!.action).toBe("edited");
  });

  it("extracts shell commands", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: { toolName: "bash_run", toolCallId: "tc3", input: { command: "npm test" } },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: { toolName: "bash_run", toolCallId: "tc3" },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.commands).toHaveLength(1);
    expect(diff.commands[0]).toEqual({
      command: "npm test",
      exitCode: 0,
      durationMs: null,
    });
  });

  it("marks failed commands", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: { toolName: "bash_run", toolCallId: "tc4", input: { command: "exit 1" } },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: { toolName: "bash_run", toolCallId: "tc4", isError: true },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.commands[0]!.exitCode).toBe(1);
  });

  it("extracts MCP tool calls", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: { toolName: "mcp__github__search", toolCallId: "tc5" },
      }),
      event(PI_SESSION_EVENT.ToolResult, {
        payload: { toolName: "mcp__github__search", toolCallId: "tc5" },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.files).toHaveLength(0);
    expect(diff.commands).toHaveLength(0);
    expect(diff.toolCalls).toHaveLength(1);
    expect(diff.toolCalls[0]).toEqual({ toolName: "mcp__github__search", success: true });
  });

  it("extracts usage event", () => {
    const events = [
      event(PI_SESSION_EVENT.Usage, {
        payload: {
          inputTokens: 500,
          outputTokens: 200,
          cachedInputTokens: 100,
        },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.usage).not.toBeNull();
    expect(diff.usage!.inputTokens).toBe(500);
    expect(diff.usage!.outputTokens).toBe(200);
    expect(diff.usage!.cachedInputTokens).toBe(100);
  });

  it("respects fromEventId range", () => {
    const input1 = event(PI_SESSION_EVENT.Input, { id: "input1" });
    const input2 = event(PI_SESSION_EVENT.Input, { id: "input2" });
    const tool = event(PI_SESSION_EVENT.ToolStart, {
      payload: { toolName: "read", toolCallId: "tc1", input: { path: "/a.ts" } },
    });

    const diff = computeTurnDiff([input1, input2, tool], "input2", null);
    // Should only include the tool event (after input2)
    expect(diff.files).toHaveLength(1);
  });

  it("respects untilEventId range", () => {
    const tool1 = event(PI_SESSION_EVENT.ToolStart, {
      id: "t1",
      payload: { toolName: "read", toolCallId: "tc1", input: { path: "/a.ts" } },
    });
    const tool2 = event(PI_SESSION_EVENT.ToolStart, {
      id: "t2",
      payload: { toolName: "read", toolCallId: "tc2", input: { path: "/b.ts" } },
    });

    const diff = computeTurnDiff([tool1, tool2], null, "t2");
    // Should only include tool1 (exclusive upper bound)
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe("/a.ts");
  });

  it("handles unmatched tool starts (started but no result)", () => {
    const events = [
      event(PI_SESSION_EVENT.ToolStart, {
        payload: { toolName: "bash_run", toolCallId: "tc99", input: { command: "sleep 10" } },
      }),
    ];
    const diff = computeTurnDiff(events, null, null);
    expect(diff.commands).toHaveLength(1);
    expect(diff.commands[0]!.exitCode).toBeNull();
  });
});

describe("turnDiffSummaryLabel", () => {
  it("returns null for empty diff", () => {
    expect(turnDiffSummaryLabel(EMPTY_TURN_DIFF)).toBeNull();
  });

  it("summarizes files and commands", () => {
    const label = turnDiffSummaryLabel({
      ...EMPTY_TURN_DIFF,
      files: [{ path: "/a.ts", action: "read" }, { path: "/b.ts", action: "edited" }],
      commands: [{ command: "ls", exitCode: 0, durationMs: null }],
    });
    expect(label).toBe("2 files · 1 cmd");
  });

  it("includes tokens", () => {
    const label = turnDiffSummaryLabel({
      ...EMPTY_TURN_DIFF,
      usage: { inputTokens: 5000, outputTokens: 1500, cachedInputTokens: null },
    });
    expect(label).toBe("7K tokens");
  });
});
