import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleJsonRpcLine, resetProtocolForTests } from "./protocol.js";
import { formatPromptWithContext, setSessionEventSink } from "./sessions.js";

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

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        session: {
          id: "pi-1",
          title: "Plan",
          cwd,
          status: "idle",
          lastPrompt: null,
        },
        events: [
          {
            id: "evt-1",
            type: "session.created",
            sessionId: "pi-1",
            payload: {
              session: {
                id: "pi-1",
                title: "Plan",
                cwd,
                status: "idle",
              },
            },
          },
        ],
      },
    });
    expect(result.response.result.session.createdAt).toEqual(
      expect.any(String),
    );
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

  it("runs prompts through the Pi SDK and returns output events", async () => {
    const cwd = process.cwd();
    await request(3, "sessions.create", { title: "Run", cwd });
    const result = await request(4, "sessions.send", {
      sessionId: "pi-1",
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
          id: "pi-1",
          status: "running",
          lastPrompt: "hello Pi",
        },
      },
    });
    expect(result.response.result.events).toEqual([
      expect.objectContaining({
        id: "evt-2",
        type: "session.input",
        sessionId: "pi-1",
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
        id: "evt-3",
        type: "session.status",
        sessionId: "pi-1",
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
          sessionId: "pi-1",
          payload: expect.objectContaining({ text: expect.any(String) }),
        }),
        expect.objectContaining({
          type: "session.output.text",
          sessionId: "pi-1",
          payload: { text: "hello from real Pi SDK" },
        }),
        expect.objectContaining({
          type: "session.status",
          sessionId: "pi-1",
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

  it("stops sessions and keeps them visible in the list", async () => {
    await request(5, "sessions.create", { title: "Stop me" });
    await request(6, "sessions.send", { sessionId: "pi-1", prompt: "go" });
    const stop = await request(7, "sessions.stop", { sessionId: "pi-1" });
    const list = await request(8, "sessions.list");

    expect(stop.response).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: {
        session: { id: "pi-1", status: "stopped" },
        events: [
          {
            type: "session.status",
            sessionId: "pi-1",
            payload: { status: "stopped" },
          },
        ],
      },
    });
    expect(list.response.result.sessions).toEqual([
      expect.objectContaining({ id: "pi-1", status: "stopped" }),
    ]);
  });

  it("rejects a second prompt while a session is already running", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "slow ".repeat(80);
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND = "1";
    await request(9, "sessions.create", { title: "Busy" });
    const first = await request(10, "sessions.send", {
      sessionId: "pi-1",
      prompt: "go slowly",
    });

    expect(first.response.result.session.status).toBe("running");
    const second = await request(11, "sessions.send", {
      sessionId: "pi-1",
      prompt: "overlap",
    });

    expect(second.response).toEqual({
      jsonrpc: "2.0",
      id: 11,
      error: { code: -32007, message: "Pi session is already running: pi-1" },
    });
  });

  it("aborts active Pi runs when stopping a running session", async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "slow ".repeat(80);
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND = "1";
    await request(12, "sessions.create", { title: "Abort me" });
    const sent = await request(13, "sessions.send", {
      sessionId: "pi-1",
      prompt: "go slowly",
    });

    expect(sent.response.result.session.status).toBe("running");
    const stop = await request(14, "sessions.stop", { sessionId: "pi-1" });
    expect(stop.response.result.session.status).toBe("stopped");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      liveEvents.some(
        (event) =>
          event.type === "session.status" && event.payload.status === "idle",
      ),
    ).toBe(false);
  });

  it("rejects prompts over the resource limit", async () => {
    await request(12, "sessions.create", { title: "Limits" });
    const result = await request(13, "sessions.send", {
      sessionId: "pi-1",
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
