import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleJsonRpcLine, resetProtocolForTests } from "./protocol.js";
import {
  resetNativeToolExecutorForTests,
  setNativeToolExecutorForTests,
} from "./native-tools.js";
import {
  APPROVAL_TOOL_NAMES,
  ENABLED_TOOL_NAMES,
  formatPromptWithContext,
  mapAgentSessionEvent,
  setSessionEventSink,
  TOOL_MODE,
  toolRequiresApproval,
  validateToolSafety,
} from "./sessions.js";

async function request(id, method, params) {
  return handleJsonRpcLine(
    JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  );
}

async function waitFor(check, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for live session event");
}

let liveEvents = [];
let restoreStdout = () => {};

function suppressPiTerminalNotifications() {
  const originalWrite = process.stdout.write;
  process.stdout.write = function (chunk, encoding, callback) {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    if (text.includes("\u001b]777;notify;π;")) {
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    }
    return originalWrite.call(process.stdout, chunk, encoding, callback);
  };
  return () => {
    process.stdout.write = originalWrite;
  };
}

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

  it("enables only Rust-mediated workspace tools", () => {
    expect(TOOL_MODE).toBe("rust-mediated");
    expect(ENABLED_TOOL_NAMES).toEqual([
      "read",
      "ls",
      "grep",
      "find",
      "bash",
      "edit",
      "write",
    ]);
    expect(APPROVAL_TOOL_NAMES).toEqual(["bash", "edit", "write"]);
    expect(toolRequiresApproval("bash")).toBe(true);
    expect(toolRequiresApproval("edit")).toBe(true);
    expect(toolRequiresApproval("write")).toBe(true);
    expect(toolRequiresApproval("read")).toBe(false);
  });
});

describe("Pi host session protocol", () => {
  beforeEach(async () => {
    liveEvents = [];
    restoreStdout = suppressPiTerminalNotifications();
    process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX = "1";
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "hello from real Pi SDK";
    setSessionEventSink((event) => liveEvents.push(event));
    await resetProtocolForTests();
  });

  afterEach(async () => {
    await resetProtocolForTests();
    setSessionEventSink(null);
    resetNativeToolExecutorForTests();
    delete process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX;
    delete process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
    delete process.env.TERAX_PI_HOST_TEST_FAUX_REASONING;
    delete process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL;
    delete process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND;
    restoreStdout();
    restoreStdout = () => {};
  });

  it("lists no sessions before one is created", async () => {
    const result = await request(1, "sessions.list");

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { sessions: [], events: [] },
    });
  });

  it("creates real Pi AgentSessions with an explicit cwd", async () => {
    const cwd = process.cwd();
    const result = await request(2, "sessions.create", { title: "Plan", cwd });
    const sessionId = result.response.result.session.id;
    const eventId = result.response.result.events[0].id;

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        session: {
          id: expect.stringMatching(/^pi_/),
          title: "Plan",
          cwd,
          status: "idle",
          lastPrompt: null,
        },
        events: [
          {
            id: expect.stringMatching(/^evt_/),
            type: "session.created",
            sessionId,
            payload: {
              session: {
                id: sessionId,
                title: "Plan",
                cwd,
                status: "idle",
              },
            },
          },
        ],
      },
    });
    expect(eventId).toMatch(/^evt_/);
    expect(result.response.result.session.createdAt).toEqual(
      expect.any(String),
    );
  });

  it("resumes a persistent SDK session after the sidecar loses live state", async () => {
    const cwd = process.cwd();
    const sessionDir = await mkdtemp(join(tmpdir(), "terax-pi-session-"));
    try {
      const created = await request(60, "sessions.create", {
        title: "Persistent",
        cwd,
        sessionDir,
      });
      const sessionId = created.response.result.session.id;
      const sdkSessionFile = created.response.result.session.sdkSessionFile;

      expect(sdkSessionFile).toEqual(expect.stringContaining(sessionDir));

      await request(61, "sessions.send", {
        sessionId,
        prompt: "remember this",
      });
      await waitFor(() =>
        liveEvents.some(
          (event) =>
            event.sessionId === sessionId &&
            event.type === "session.status" &&
            event.payload.status === "idle",
        ),
      );
      expect((await stat(sdkSessionFile)).isFile()).toBe(true);

      await resetProtocolForTests();
      liveEvents = [];

      const resumed = await request(62, "sessions.resume", {
        sessionId,
        title: "Persistent",
        cwd,
        sessionDir,
        sdkSessionFile,
      });
      const list = await request(63, "sessions.list");
      const followUp = await request(64, "sessions.send", {
        sessionId,
        prompt: "continue",
      });

      expect(resumed.response.result.session).toMatchObject({
        id: sessionId,
        title: "Persistent",
        cwd,
        status: "idle",
        sdkSessionFile,
      });
      expect(resumed.response.result.events).toEqual([
        expect.objectContaining({
          type: "session.resumed",
          sessionId,
          payload: expect.objectContaining({
            session: expect.objectContaining({ id: sessionId, sdkSessionFile }),
            sessionId,
            sdkSessionFile,
          }),
        }),
      ]);
      expect(list.response.result.sessions).toEqual([
        expect.objectContaining({ id: sessionId, sdkSessionFile }),
      ]);
      expect(followUp.response.result.session.status).toBe("running");
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("renames sessions and emits a metadata event", async () => {
    const created = await request(33, "sessions.create", { title: "Draft" });
    const sessionId = created.response.result.session.id;

    const renamed = await request(34, "sessions.rename", {
      sessionId,
      title: "Reviewed plan",
    });
    const list = await request(35, "sessions.list");

    expect(renamed.response.result.session.title).toBe("Reviewed plan");
    expect(renamed.response.result.events).toEqual([
      expect.objectContaining({
        type: "session.renamed",
        sessionId,
        payload: { title: "Reviewed plan" },
      }),
    ]);
    expect(list.response.result.sessions[0].title).toBe("Reviewed plan");
  });

  it("rejects oversized session titles", async () => {
    const created = await request(39, "sessions.create", { title: "Draft" });
    const sessionId = created.response.result.session.id;

    const renamed = await request(40, "sessions.rename", {
      sessionId,
      title: "x".repeat(257),
    });

    expect(renamed.response).toMatchObject({
      jsonrpc: "2.0",
      id: 40,
      error: {
        code: -32602,
        message: "sessions.rename title must be at most 256 characters",
      },
    });
  });

  it("deletes sessions and removes them from live state", async () => {
    const created = await request(36, "sessions.create", {
      title: "Delete me",
    });
    const sessionId = created.response.result.session.id;

    const deleted = await request(37, "sessions.delete", { sessionId });
    const list = await request(38, "sessions.list");

    expect(deleted.response.result.events).toEqual([
      expect.objectContaining({
        type: "session.deleted",
        sessionId,
        payload: { sessionId },
      }),
    ]);
    expect(list.response.result.sessions).toEqual([]);
  });

  it("returns pending approval denials before deleting a session", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL = JSON.stringify({
      id: "call-delete",
      name: "bash",
      arguments: { command: "printf deleted" },
    });
    const created = await request(41, "sessions.create", {
      title: "Delete pending approval",
    });
    const sessionId = created.response.result.session.id;

    await request(42, "sessions.send", {
      sessionId,
      prompt: "run shell",
    });
    await waitFor(() =>
      liveEvents.some(
        (event) => event.type === "session.tool.approval.requested",
      ),
    );

    const deleted = await request(43, "sessions.delete", { sessionId });

    expect(deleted.response.result.events).toEqual([
      expect.objectContaining({
        type: "session.tool.approval.responded",
        sessionId,
        payload: expect.objectContaining({
          toolCallId: "call-delete",
          approved: false,
        }),
      }),
      expect.objectContaining({
        type: "session.deleted",
        sessionId,
        payload: { sessionId },
      }),
    ]);
  });

  it("does not reuse session or event ids after a protocol reset", async () => {
    const first = await request(31, "sessions.create", { title: "First" });
    const firstSessionId = first.response.result.session.id;
    const firstEventId = first.response.result.events[0].id;

    await resetProtocolForTests();

    const second = await request(32, "sessions.create", { title: "Second" });

    expect(second.response.result.session.id).not.toBe(firstSessionId);
    expect(second.response.result.events[0].id).not.toBe(firstEventId);
  });

  it("rejects malformed faux tool-call test fixtures without crashing", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL = "not-json";

    const result = await request(20, "sessions.create", { title: "Bad faux" });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 20,
      error: {
        code: -32602,
        message: "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL must be valid JSON",
      },
    });
  });

  it("rejects empty session cwd values", async () => {
    const result = await request(21, "sessions.create", {
      title: "Bad cwd",
      cwd: "   ",
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 21,
      error: {
        code: -32602,
        message: "sessions.create params.cwd must be a non-empty string",
      },
    });
  });

  it("derives default session titles from the first prompt", async () => {
    const created = await request(22, "sessions.create", {});
    const sessionId = created.response.result.session.id;
    const result = await request(23, "sessions.send", {
      sessionId,
      prompt: "Explain the payment flow in this workspace",
    });
    const list = await request(24, "sessions.list");

    expect(result.response.result.session.title).toBe(
      "Explain the payment flow in this workspace",
    );
    expect(list.response.result.sessions[0].title).toBe(
      "Explain the payment flow in this workspace",
    );
  });

  it("applies a thinking level to the current session before sending", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_REASONING = "true";
    const created = await request(93, "sessions.create", { title: "Think" });
    const sessionId = created.response.result.session.id;

    const result = await request(94, "sessions.send", {
      sessionId,
      prompt: "think harder",
      thinkingLevel: "high",
    });
    const list = await request(95, "sessions.list");

    expect(result.response.result.session.thinkingLevel).toBe("high");
    expect(result.response.result.events[0]).toMatchObject({
      type: "session.input",
      sessionId,
      payload: expect.objectContaining({ thinkingLevel: "high" }),
    });
    expect(list.response.result.sessions[0].thinkingLevel).toBe("high");
  });

  it("rejects unsupported send thinking levels", async () => {
    const created = await request(96, "sessions.create", { title: "Think" });
    const sessionId = created.response.result.session.id;

    const result = await request(97, "sessions.send", {
      sessionId,
      prompt: "think impossible",
      thinkingLevel: "extreme",
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 97,
      error: {
        code: -32602,
        message: "sessions.send params.thinkingLevel must be one of off, minimal, low, medium, high, xhigh",
      },
    });
  });

  it("rejects stale tool approval responses", async () => {
    const created = await request(48, "sessions.create", {
      title: "Stale approval",
    });
    const sessionId = created.response.result.session.id;

    const result = await request(49, "sessions.tool.respond", {
      sessionId,
      toolCallId: "missing-call",
      approved: true,
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 49,
      error: {
        code: -32008,
        message: "Pi tool approval not found: missing-call",
        data: {
          code: "PI_APPROVAL_NOT_FOUND",
          category: "not_found",
          retryable: false,
          remediation: expect.any(String),
        },
      },
    });
  });

  it("delegates read-only faux tool calls to the Rust native tool bridge without approval", async () => {
    const nativeToolCalls = [];
    setNativeToolExecutorForTests(async (request) => {
      nativeToolCalls.push(request);
      return {
        content: [{ type: "text", text: "read through Rust" }],
        details: { mediatedBy: "rust" },
      };
    });
    process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL = JSON.stringify({
      id: "call-read",
      name: "read",
      arguments: { path: "package.json" },
    });
    const created = await request(50, "sessions.create", {
      title: "Read tool",
    });
    const sessionId = created.response.result.session.id;

    const sent = await request(51, "sessions.send", {
      sessionId,
      prompt: "read package",
    });

    expect(sent.response.result.session.status).toBe("running");
    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    );
    expect(nativeToolCalls).toEqual([
      expect.objectContaining({
        sessionId,
        toolCallId: "call-read",
        toolName: "read",
        input: { path: "package.json" },
      }),
    ]);
    expect(
      liveEvents.some(
        (event) => event.type === "session.tool.approval.requested",
      ),
    ).toBe(false);
    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.tool.start",
          sessionId,
          payload: expect.objectContaining({
            toolCallId: "call-read",
            toolName: "read",
            input: { path: "package.json" },
          }),
        }),
        expect.objectContaining({
          type: "session.tool.result",
          sessionId,
          payload: expect.objectContaining({
            toolCallId: "call-read",
            toolName: "read",
            output: expect.objectContaining({
              content: "read through Rust",
              details: { mediatedBy: "rust" },
            }),
            isError: false,
          }),
        }),
      ]),
    );
  });

  it("requires approval before running shell faux tool calls", async () => {
    const nativeToolCalls = [];
    setNativeToolExecutorForTests(async (request) => {
      nativeToolCalls.push(request);
      return {
        content: [{ type: "text", text: "shell ran through Rust" }],
        details: { mediatedBy: "rust" },
      };
    });
    process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL = JSON.stringify({
      id: "call-bash",
      name: "bash",
      arguments: { command: "printf approved" },
    });
    const created = await request(52, "sessions.create", {
      title: "Shell approval",
    });
    const sessionId = created.response.result.session.id;

    await request(53, "sessions.send", {
      sessionId,
      prompt: "run shell",
    });
    await waitFor(() =>
      liveEvents.some(
        (event) => event.type === "session.tool.approval.requested",
      ),
    );

    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.tool.approval.requested",
          sessionId,
          payload: expect.objectContaining({
            approvalId: "call-bash",
            toolCallId: "call-bash",
            toolName: "bash",
            input: { command: "printf approved" },
          }),
        }),
      ]),
    );

    const responded = await request(54, "sessions.tool.respond", {
      sessionId,
      toolCallId: "call-bash",
      approved: true,
    });

    expect(responded.response.result.events).toEqual([
      expect.objectContaining({
        type: "session.tool.approval.responded",
        sessionId,
        payload: expect.objectContaining({
          toolCallId: "call-bash",
          approved: true,
        }),
      }),
    ]);
    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    );
    expect(nativeToolCalls).toEqual([
      expect.objectContaining({
        sessionId,
        toolCallId: "call-bash",
        toolName: "bash",
        input: { command: "printf approved" },
      }),
    ]);
    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.tool.result",
          sessionId,
          payload: expect.objectContaining({
            toolCallId: "call-bash",
            toolName: "bash",
            output: expect.objectContaining({
              content: "shell ran through Rust",
              details: { mediatedBy: "rust" },
            }),
            isError: false,
          }),
        }),
      ]),
    );
  });

  it("denies shell faux tool calls without executing them", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL = JSON.stringify({
      id: "call-deny",
      name: "bash",
      arguments: { command: "printf denied" },
    });
    const created = await request(55, "sessions.create", {
      title: "Shell denial",
    });
    const sessionId = created.response.result.session.id;

    await request(56, "sessions.send", {
      sessionId,
      prompt: "run shell",
    });
    await waitFor(() =>
      liveEvents.some(
        (event) => event.type === "session.tool.approval.requested",
      ),
    );

    const responded = await request(57, "sessions.tool.respond", {
      sessionId,
      toolCallId: "call-deny",
      approved: false,
    });

    expect(responded.response.result.events[0]).toMatchObject({
      type: "session.tool.approval.responded",
      sessionId,
      payload: expect.objectContaining({
        toolCallId: "call-deny",
        approved: false,
      }),
    });
    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.tool.result" &&
          event.payload.toolCallId === "call-deny",
      ),
    );
    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.tool.result",
          sessionId,
          payload: expect.objectContaining({
            toolCallId: "call-deny",
            toolName: "bash",
            isError: true,
          }),
        }),
      ]),
    );
  });

  it("tags regenerated sends as response branches", async () => {
    const created = await request(25, "sessions.create", { title: "Branches" });
    const sessionId = created.response.result.session.id;
    const first = await request(26, "sessions.send", {
      sessionId,
      prompt: "explain again",
    });
    const branchGroupId =
      first.response.result.events[0].payload.branch.groupId;

    expect(first.response.result.events[0].payload.branch).toEqual({
      groupId: expect.any(String),
      index: 0,
    });

    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    );
    liveEvents = [];

    const regenerated = await request(27, "sessions.send", {
      sessionId,
      prompt: "explain again",
      regenerateBranchGroupId: branchGroupId,
    });

    expect(regenerated.response.result.events[0].payload.branch).toEqual({
      groupId: branchGroupId,
      index: 1,
      regeneratedFromEventId: first.response.result.events[0].id,
    });
  });

  it("accepts fallback regenerate branch ids from older unbranched transcripts", async () => {
    const created = await request(28, "sessions.create", { title: "Fallback" });
    const sessionId = created.response.result.session.id;
    const regenerated = await request(29, "sessions.send", {
      sessionId,
      prompt: "explain again",
      regenerateBranchGroupId: "evt-old-input",
    });

    expect(regenerated.response.result.events[0].payload.branch).toEqual({
      groupId: "evt-old-input",
      index: 1,
      regeneratedFromEventId: "evt-old-input",
    });
  });

  it("runs prompts through the Pi SDK and returns output events", async () => {
    const cwd = process.cwd();
    const created = await request(3, "sessions.create", { title: "Run", cwd });
    const sessionId = created.response.result.session.id;
    const result = await request(4, "sessions.send", {
      sessionId,
      prompt: "hello Pi",
      context: {
        activeTerminalCwd: `${cwd}/src`,
        activeFile: `${cwd}/src/App.tsx`,
      },
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        accepted: true,
        session: {
          id: sessionId,
          status: "running",
          lastPrompt: "hello Pi",
        },
      },
    });
    expect(result.response.result.events).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^evt_/),
        type: "session.input",
        sessionId,
        payload: expect.objectContaining({
          text: "hello Pi",
          branch: expect.objectContaining({
            groupId: expect.any(String),
            index: 0,
          }),
          context: {
            workspaceRoot: cwd,
            activeTerminalCwd: `${cwd}/src`,
            activeFile: `${cwd}/src/App.tsx`,
          },
        }),
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^evt_/),
        type: "session.status",
        sessionId,
        payload: { status: "running" },
      }),
    ]);
    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    );
    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.output.delta",
          sessionId,
          payload: expect.objectContaining({ text: expect.any(String) }),
        }),
        expect.objectContaining({
          type: "session.output.text",
          sessionId,
          payload: expect.objectContaining({ text: "hello from real Pi SDK" }),
        }),
        expect.objectContaining({
          type: "session.status",
          sessionId,
          payload: { status: "idle" },
        }),
      ]),
    );
    expect(
      liveEvents
        .filter((event) => event.type === "session.output.delta")
        .map((event) => event.payload.text)
        .join(""),
    ).toBe("hello from real Pi SDK");
  });

  it("cancels active runs and keeps the session sendable", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "slow ".repeat(80);
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND = "1";
    const created = await request(5, "sessions.create", { title: "Cancel me" });
    const sessionId = created.response.result.session.id;
    await request(6, "sessions.send", { sessionId, prompt: "go" });
    const stop = await request(7, "sessions.stop", { sessionId });
    const list = await request(8, "sessions.list");

    expect(stop.response).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: {
        session: { id: sessionId, status: "idle" },
        events: [
          {
            type: "session.status",
            sessionId,
            payload: { status: "idle" },
          },
        ],
      },
    });
    expect(list.response.result.sessions).toEqual([
      expect.objectContaining({ id: sessionId, status: "idle" }),
    ]);

    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "follow-up ok";
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND = "1000";
    const followUp = await request(81, "sessions.send", {
      sessionId,
      prompt: "again",
    });
    expect(followUp.response.result.session.status).toBe("running");
  });

  it("rejects a second prompt while a session is already running", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "slow ".repeat(80);
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND = "1";
    const created = await request(9, "sessions.create", { title: "Busy" });
    const sessionId = created.response.result.session.id;
    const first = await request(10, "sessions.send", {
      sessionId,
      prompt: "go slowly",
    });

    expect(first.response.result.session.status).toBe("running");
    const second = await request(11, "sessions.send", {
      sessionId,
      prompt: "overlap",
    });

    expect(second.response).toMatchObject({
      jsonrpc: "2.0",
      id: 11,
      error: {
        code: -32007,
        message: `Pi session is already running: ${sessionId}`,
      },
    });
  });

  it("does not publish stale completion after cancelling a running session", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "slow ".repeat(80);
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND = "1";
    const created = await request(12, "sessions.create", { title: "Abort me" });
    const sessionId = created.response.result.session.id;
    const sent = await request(13, "sessions.send", {
      sessionId,
      prompt: "go slowly",
    });

    expect(sent.response.result.session.status).toBe("running");
    const stop = await request(14, "sessions.stop", { sessionId });
    expect(stop.response.result.session.status).toBe("idle");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      liveEvents.filter(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    ).toHaveLength(0);
  });

  it("rejects prompts over the resource limit", async () => {
    const created = await request(90, "sessions.create", { title: "Limits" });
    const sessionId = created.response.result.session.id;
    const result = await request(91, "sessions.send", {
      sessionId,
      prompt: "x".repeat(20_001),
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 91,
      error: {
        code: -32006,
        message: "sessions.send prompt must be at most 20000 characters",
      },
    });
  });

  it("rejects sends to missing sessions", async () => {
    const result = await request(92, "sessions.send", {
      sessionId: "missing",
      prompt: "hello",
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 92,
      error: { code: -32004, message: "Pi session not found: missing" },
    });
  });
});
