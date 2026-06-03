import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleJsonRpcLine, resetProtocolForTests } from "./protocol.js";
import {
  formatPromptWithContext,
  mapAgentSessionEvent,
  setSessionEventSink,
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
});

describe("Pi host session protocol", () => {
  beforeEach(async () => {
    liveEvents = [];
    restoreStdout = suppressPiTerminalNotifications();
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "hello from real Pi SDK";
    setSessionEventSink((event) => liveEvents.push(event));
    await resetProtocolForTests();
  });

  afterEach(async () => {
    await resetProtocolForTests();
    setSessionEventSink(null);
    delete process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
    delete process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND;
    restoreStdout();
    restoreStdout = () => {};
  });

  it("lists no sessions before one is created", async () => {
    const result = await request(1, "sessions.list");

    expect(result.response).toEqual({
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

  it("does not reuse session or event ids after a protocol reset", async () => {
    const first = await request(31, "sessions.create", { title: "First" });
    const firstSessionId = first.response.result.session.id;
    const firstEventId = first.response.result.events[0].id;

    await resetProtocolForTests();

    const second = await request(32, "sessions.create", { title: "Second" });

    expect(second.response.result.session.id).not.toBe(firstSessionId);
    expect(second.response.result.events[0].id).not.toBe(firstEventId);
  });

  it("rejects empty session cwd values", async () => {
    const result = await request(21, "sessions.create", {
      title: "Bad cwd",
      cwd: "   ",
    });

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 21,
      error: {
        code: -32602,
        message: "sessions.create cwd must be a non-empty string",
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
        payload: {
          text: "hello Pi",
          context: {
            workspaceRoot: cwd,
            activeTerminalCwd: `${cwd}/src`,
            activeFile: `${cwd}/src/App.tsx`,
          },
        },
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
          payload: { text: "hello from real Pi SDK" },
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

    expect(second.response).toEqual({
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
    const created = await request(12, "sessions.create", { title: "Limits" });
    const sessionId = created.response.result.session.id;
    const result = await request(13, "sessions.send", {
      sessionId,
      prompt: "x".repeat(20_001),
    });

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 13,
      error: {
        code: -32006,
        message: "sessions.send prompt must be at most 20000 characters",
      },
    });
  });

  it("rejects sends to missing sessions", async () => {
    const result = await request(9, "sessions.send", {
      sessionId: "missing",
      prompt: "hello",
    });

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32004, message: "Pi session not found: missing" },
    });
  });
});
