import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleJsonRpcLine, resetProtocolForTests } from "./protocol.js";

async function request(id, method, params) {
  return handleJsonRpcLine(
    JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  );
}

describe("Pi host session protocol", () => {
  beforeEach(async () => {
    process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE = "hello from real Pi SDK";
    await resetProtocolForTests();
  });

  afterEach(async () => {
    await resetProtocolForTests();
    delete process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
  });

  it("lists no sessions before one is created", async () => {
    const result = await request(1, "sessions.list");

    expect(result.response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { sessions: [] },
    });
  });

  it("creates real Pi AgentSessions and emits a typed created event", async () => {
    const result = await request(2, "sessions.create", { title: "Plan" });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        session: {
          id: "pi-1",
          title: "Plan",
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

  it("runs prompts through the Pi SDK and returns output events", async () => {
    await request(3, "sessions.create", { title: "Run" });
    const result = await request(4, "sessions.send", {
      sessionId: "pi-1",
      prompt: "hello Pi",
    });

    expect(result.response).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        accepted: true,
        session: {
          id: "pi-1",
          status: "idle",
          lastPrompt: "hello Pi",
        },
      },
    });
    expect(result.response.result.events.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: "evt-2",
        type: "session.input",
        sessionId: "pi-1",
        payload: { text: "hello Pi" },
      }),
      expect.objectContaining({
        id: "evt-3",
        type: "session.status",
        sessionId: "pi-1",
        payload: { status: "running" },
      }),
    ]);
    expect(result.response.result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session.output.delta",
          sessionId: "pi-1",
          payload: expect.objectContaining({ text: expect.any(String) }),
        }),
        expect.objectContaining({
          type: "session.status",
          sessionId: "pi-1",
          payload: { status: "idle" },
        }),
      ]),
    );
    expect(
      result.response.result.events
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
