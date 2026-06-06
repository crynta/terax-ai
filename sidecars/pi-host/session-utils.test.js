import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPROVAL_TOOL_NAMES,
  approvalToolNamesForSession,
  enabledToolNamesForSession,
  ENABLED_TOOL_NAMES,
  formatPromptWithContext,
  mapAgentSessionEvent,
  setSessionEventSink,
  TOOL_MODE,
  toolRequiresApproval,
  validateToolSafety,
} from "./sessions.js";

let liveEvents = [];

describe("formatPromptWithContext", () => {
  it("prepends Terax env context without changing the user prompt", () => {
    expect(
      formatPromptWithContext({ cwd: "/Users/me/project" }, "Where am I?", {
        activeTerminalCwd: "/Users/me/project/src",
        activeFile: "/Users/me/project/src/App.tsx",
        activeTerminalPrivate: true,
      }),
    ).toBe(
      `<env>\nworkspace_root: /Users/me/project\nactive_terminal_cwd: /Users/me/project/src\nactive_file: /Users/me/project/src/App.tsx\nactive_terminal_mode: private\n</env>\n\nWhere am I?`,
    );
  });
});

describe("mapAgentSessionEvent", () => {
  beforeEach(() => {
    liveEvents = [];
    setSessionEventSink((event) => liveEvents.push(event));
  });

  afterEach(() => {
    setSessionEventSink(null);
  });

  it("suppresses assistant events after the active run is cancelled", () => {
    mapAgentSessionEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "stale" },
      },
      {
        id: "pi-1",
        status: "running",
        activeRunId: 3,
        cancelledRunId: 3,
        agentGeneration: 1,
      },
      1,
    );

    expect(liveEvents).toEqual([]);
  });

  it("suppresses assistant events from old agent subscriptions", () => {
    mapAgentSessionEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_end", content: "stale" },
      },
      {
        id: "pi-1",
        status: "running",
        activeRunId: 4,
        cancelledRunId: null,
        agentGeneration: 2,
      },
      1,
    );

    expect(liveEvents).toEqual([]);
  });

  it("publishes progress events for agent lifecycle updates", () => {
    mapAgentSessionEvent(
      { type: "turn_start" },
      {
        id: "pi-1",
        status: "running",
        activeRunId: 1,
        cancelledRunId: null,
        agentGeneration: 1,
        activeBranch: { groupId: "turn-1", index: 0 },
      },
      1,
    );

    expect(liveEvents).toEqual([
      expect.objectContaining({
        type: "session.progress",
        payload: {
          text: "Preparing model request…",
          branch: { groupId: "turn-1", index: 0 },
        },
      }),
    ]);
  });

  it("publishes streamed reasoning events from assistant thinking parts", () => {
    const session = {
      id: "pi-1",
      status: "running",
      activeRunId: 1,
      cancelledRunId: null,
      agentGeneration: 1,
      activeBranch: { groupId: "turn-1", index: 0 },
    };

    mapAgentSessionEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "plan" },
      },
      session,
      1,
    );
    mapAgentSessionEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_end", content: "plan done" },
      },
      session,
      1,
    );

    expect(liveEvents).toEqual([
      expect.objectContaining({
        type: "session.reasoning.delta",
        payload: {
          text: "plan",
          branch: { groupId: "turn-1", index: 0 },
        },
      }),
      expect.objectContaining({
        type: "session.reasoning.text",
        payload: {
          text: "plan done",
          branch: { groupId: "turn-1", index: 0 },
        },
      }),
    ]);
  });

  it("publishes tool timeline events with active branch metadata", () => {
    const session = {
      id: "pi-1",
      status: "running",
      activeRunId: 1,
      cancelledRunId: null,
      agentGeneration: 1,
      activeBranch: { groupId: "turn-1", index: 0 },
      toolInputs: new Map(),
    };

    mapAgentSessionEvent(
      {
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "package.json" },
      },
      session,
      1,
    );
    mapAgentSessionEvent(
      {
        type: "tool_execution_update",
        toolCallId: "call-1",
        toolName: "read",
        partialResult: { content: [{ type: "text", text: "partial" }] },
      },
      session,
      1,
    );
    mapAgentSessionEvent(
      {
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "read",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      },
      session,
      1,
    );

    expect(liveEvents).toEqual([
      expect.objectContaining({
        type: "session.tool.start",
        payload: expect.objectContaining({
          toolCallId: "call-1",
          toolName: "read",
          input: { path: "package.json" },
          branch: { groupId: "turn-1", index: 0 },
        }),
      }),
      expect.objectContaining({
        type: "session.tool.update",
        payload: expect.objectContaining({
          toolCallId: "call-1",
          output: { content: "partial", details: null },
          branch: { groupId: "turn-1", index: 0 },
        }),
      }),
      expect.objectContaining({
        type: "session.tool.result",
        payload: expect.objectContaining({
          toolCallId: "call-1",
          output: { content: "done", details: null },
          isError: false,
          branch: { groupId: "turn-1", index: 0 },
        }),
      }),
    ]);
  });
});

describe("Pi tool safety policy", () => {
  const session = { cwd: process.cwd() };

  it("keeps file tools inside the workspace", () => {
    expect(validateToolSafety(session, "read", { path: "package.json" })).toBe(
      null,
    );
    expect(validateToolSafety(session, "read", { path: "../secret.txt" })).toBe(
      `read can only access files inside the workspace: ${process.cwd()}`,
    );
  });

  it("blocks sensitive paths before execution", () => {
    expect(validateToolSafety(session, "read", { path: ".env" })).toBe(
      "read refused sensitive path: .env",
    );
    expect(validateToolSafety(session, "write", { path: "tokens.json" })).toBe(
      "write refused sensitive path: tokens.json",
    );
  });

  it("derives workspace preflight from the Rust capability manifest", () => {
    const manifestSession = {
      ...session,
      capabilityManifest: {
        version: 1,
        tools: [
          {
            name: "manifest_read",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
            scopes: ["workspace"],
            kind: "file-read",
            approval: "auto",
            modelVisible: true,
          },
        ],
      },
    };

    expect(
      validateToolSafety(manifestSession, "manifest_read", {
        path: "../secret.txt",
      }),
    ).toBe(`manifest_read can only access files inside the workspace: ${process.cwd()}`);
  });

  it("enables Rust-mediated workspace and artifact tools", () => {
    expect(TOOL_MODE).toBe("rust-mediated");
    expect(ENABLED_TOOL_NAMES).toEqual([
      "read",
      "ls",
      "grep",
      "find",
      "bash",
      "edit",
      "write",
      "create_artifact",
      "edit_artifact",
      "read_artifact",
      "list_artifacts",
    ]);
    expect(APPROVAL_TOOL_NAMES).toEqual(["bash", "edit", "write"]);
    expect(toolRequiresApproval("bash")).toBe(true);
    expect(toolRequiresApproval("edit")).toBe(true);
    expect(toolRequiresApproval("write")).toBe(true);
    expect(toolRequiresApproval("read")).toBe(false);
    expect(toolRequiresApproval("create_artifact")).toBe(false);
  });

  it("derives enabled and approval lists from a session capability manifest", () => {
    const manifestSession = {
      capabilityManifest: {
        version: 1,
        tools: [
          { name: "read", approval: "auto", modelVisible: true },
          { name: "mcp__files__read", approval: "ask", modelVisible: true },
          { name: "hidden", approval: "deny", modelVisible: false },
        ],
      },
    };

    expect(enabledToolNamesForSession(manifestSession)).toEqual([
      "read",
      "mcp__files__read",
    ]);
    expect(approvalToolNamesForSession(manifestSession)).toEqual([
      "mcp__files__read",
    ]);
    expect(toolRequiresApproval("mcp__files__read", manifestSession)).toBe(
      true,
    );
  });
});

