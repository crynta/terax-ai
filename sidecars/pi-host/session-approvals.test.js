import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetNativeToolExecutorForTests,
  setNativeToolExecutorForTests,
} from "./native-tools.js";
import { handleJsonRpcLine, resetProtocolForTests } from "./protocol.js";
import { setSessionEventSink } from "./sessions.js";

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

describe("Pi host session approval protocol", () => {
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

  it("requires approval before running manifest MCP tool calls", async () => {
    const nativeToolCalls = [];
    setNativeToolExecutorForTests(async (request) => {
      nativeToolCalls.push(request);
      return {
        content: [{ type: "text", text: "mcp ran through Rust" }],
        details: { mediatedBy: "rust", mcp: true },
      };
    });
    process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL = JSON.stringify({
      id: "call-mcp",
      name: "mcp__echo__say",
      arguments: { text: "hello" },
    });
    const created = await request(85, "sessions.create", {
      title: "MCP approval",
      capabilityManifest: {
        version: 1,
        tools: [
          {
            name: "mcp__echo__say",
            label: "Echo: say",
            description: "Call an external MCP echo tool through Rust.",
            promptSnippet: "Call MCP echo through Terax Rust after approval",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
            approval: "ask",
            modelVisible: true,
          },
        ],
      },
    });
    const sessionId = created.response.result.session.id;

    await request(86, "sessions.send", {
      sessionId,
      prompt: "call mcp",
    });
    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.tool.approval.requested" &&
          event.payload.toolName === "mcp__echo__say",
      ),
    );

    await request(87, "sessions.tool.respond", {
      sessionId,
      toolCallId: "call-mcp",
      approved: true,
    });
    await waitFor(() =>
      liveEvents.some(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    );

    expect(nativeToolCalls).toEqual([
      expect.objectContaining({
        sessionId,
        toolCallId: "call-mcp",
        toolName: "mcp__echo__say",
        input: { text: "hello" },
      }),
    ]);
    expect(liveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.tool.result",
          sessionId,
          payload: expect.objectContaining({
            toolCallId: "call-mcp",
            toolName: "mcp__echo__say",
            output: expect.objectContaining({
              content: "mcp ran through Rust",
              details: { mediatedBy: "rust", mcp: true },
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

});
