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

  it("rejects resume when the SDK session file is missing", async () => {
    const sessionDir = await mkdtemp(
      join(tmpdir(), "terax-pi-missing-session-"),
    );
    try {
      const missingFile = join(sessionDir, "missing.jsonl");
      const result = await request(65, "sessions.resume", {
        sessionId: "pi-missing",
        title: "Missing",
        cwd: process.cwd(),
        sessionDir,
        sdkSessionFile: missingFile,
      });

      expect(result.response).toEqual({
        jsonrpc: "2.0",
        id: 65,
        error: {
          code: -32009,
          message: expect.stringContaining("sdkSessionFile was not found"),
          data: {
            code: "PI_SESSION_FILE_NOT_FOUND",
            category: "not_found",
            retryable: false,
            remediation:
              "The saved Pi SDK session file is missing or no longer readable. Continue in a new Pi session.",
          },
        },
      });
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
        message:
          "sessions.send params.thinkingLevel must be one of off, minimal, low, medium, high, xhigh",
      },
    });
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

  it("returns a status event when stopping an already-stopped session", async () => {
    const created = await request(15, "sessions.create", {
      title: "Stop twice",
    });
    const sessionId = created.response.result.session.id;

    const firstStop = await request(16, "sessions.stop", { sessionId });
    expect(firstStop.response.result.session.status).toBe("stopped");

    const secondStop = await request(17, "sessions.stop", { sessionId });
    expect(secondStop.response).toMatchObject({
      jsonrpc: "2.0",
      id: 17,
      result: {
        session: { id: sessionId, status: "stopped" },
        events: [
          {
            type: "session.status",
            sessionId,
            payload: { status: "stopped" },
          },
        ],
      },
    });
    expect(secondStop.response.result.events).toHaveLength(1);
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
