import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
const native = vi.hoisted(() => ({
  listen: vi.fn(),
  handlers: new Map<string, Handler>(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

async function load() {
  vi.resetModules();
  return import("./agentEvents");
}

beforeEach(() => {
  native.handlers.clear();
  native.unlisten.mockReset();
  native.listen.mockReset();
  native.listen.mockImplementation(async (name: string, cb: Handler) => {
    native.handlers.set(name, cb);
    return native.unlisten;
  });
});

const valid = {
  paneId: 2,
  ptyId: 9,
  agent: "claude",
  kind: "permission-request",
  sessionId: "s-1",
  cwd: "/repo",
  message: "Run tests",
  tool: { name: "Bash", inputPreview: "npm test", id: "t1" },
  permission: {
    requestId: "d-1",
    tool: "Bash",
    inputPreview: "npm test",
    suggestions: [{ label: "Always allow" }, { nope: true }],
  },
  subagent: { id: "a", type: "reviewer", state: "running" },
  at: 1700000000000,
};

describe("parseAgentHookEvent", () => {
  it("accepts the native payload and keeps its structure", async () => {
    const { parseAgentHookEvent } = await load();
    const event = parseAgentHookEvent(valid);
    expect(event).toMatchObject({
      paneId: 2,
      ptyId: 9,
      agent: "claude",
      kind: "permission-request",
      sessionId: "s-1",
      tool: { name: "Bash", inputPreview: "npm test", id: "t1" },
      permission: {
        requestId: "d-1",
        tool: "Bash",
        suggestions: [{ label: "Always allow" }],
      },
      subagent: { id: "a", type: "reviewer", state: "running" },
      at: 1700000000000,
    });
  });

  it("rejects payloads that would corrupt the registry", async () => {
    const { parseAgentHookEvent } = await load();
    const bad: unknown[] = [
      null,
      "x",
      [],
      {},
      { ...valid, paneId: "2" },
      { ...valid, ptyId: -1 },
      { ...valid, ptyId: 1.5 },
      { ...valid, agent: 5 },
      { ...valid, kind: "explode" },
      { ...valid, at: Number.NaN },
      { ...valid, at: "now" },
    ];
    for (const payload of bad) {
      expect(parseAgentHookEvent(payload), JSON.stringify(payload)).toBeNull();
    }
  });

  it("drops malformed optional parts instead of failing the event", async () => {
    const { parseAgentHookEvent } = await load();
    const event = parseAgentHookEvent({
      ...valid,
      sessionId: 4,
      tool: { inputPreview: "x" },
      permission: "no",
      subagent: [],
    });
    expect(event).not.toBeNull();
    expect(event?.sessionId).toBeUndefined();
    expect(event?.tool).toBeUndefined();
    expect(event?.permission).toBeUndefined();
    expect(event?.subagent).toBeUndefined();
  });
});

describe("parseTerminalNotification", () => {
  it("validates kind and ids and defaults the body", async () => {
    const { parseTerminalNotification } = await load();
    expect(
      parseTerminalNotification({
        ptyId: 3,
        title: "T",
        body: "B",
        kind: "osc9",
      }),
    ).toEqual({ ptyId: 3, title: "T", body: "B", kind: "osc9" });
    expect(parseTerminalNotification({ ptyId: 3, kind: "bell" })).toEqual({
      ptyId: 3,
      title: undefined,
      body: "",
      kind: "bell",
    });
    expect(parseTerminalNotification({ ptyId: 3, kind: "osc1" })).toBeNull();
    expect(parseTerminalNotification({ ptyId: "3", kind: "bell" })).toBeNull();
    expect(parseTerminalNotification(null)).toBeNull();
  });
});

describe("event fan-out", () => {
  it("attaches one native listener for every subscriber and releases it with the last", async () => {
    const mod = await load();
    const a = vi.fn();
    const b = vi.fn();
    const offA = mod.subscribeAgentEvents(a);
    const offB = mod.subscribeAgentEvents(b);
    await mod.agentEventsReady();
    expect(native.listen).toHaveBeenCalledTimes(1);
    expect(native.listen).toHaveBeenCalledWith(
      "terax:agent-event",
      expect.any(Function),
    );

    native.handlers.get("terax:agent-event")?.({ payload: valid });
    native.handlers.get("terax:agent-event")?.({ payload: { bogus: true } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    expect(native.unlisten).not.toHaveBeenCalled();
    offB();
    await Promise.resolve();
    await Promise.resolve();
    expect(native.unlisten).toHaveBeenCalledTimes(1);

    mod.subscribeAgentEvents(a);
    expect(native.listen).toHaveBeenCalledTimes(2);
  });

  it("survives a throwing handler", async () => {
    const mod = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const good = vi.fn();
    mod.subscribeAgentEvents(() => {
      throw new Error("boom");
    });
    mod.subscribeAgentEvents(good);
    await mod.agentEventsReady();
    native.handlers.get("terax:agent-event")?.({ payload: valid });
    expect(good).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reattaches after a failed listen", async () => {
    const mod = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    native.listen.mockRejectedValueOnce(new Error("denied"));
    mod.subscribeAgentEvents(vi.fn());
    await expect(mod.agentEventsReady()).rejects.toThrow("denied");
    await expect(mod.agentEventsReady()).rejects.toThrow("denied");
    mod.subscribeAgentEvents(vi.fn());
    await expect(mod.agentEventsReady()).resolves.toBeUndefined();
    expect(native.listen).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("serves terminal notifications from their own listener", async () => {
    const mod = await load();
    const handler = vi.fn();
    mod.subscribeTerminalNotifications(handler);
    await Promise.resolve();
    expect(native.listen).toHaveBeenCalledWith(
      "terax:terminal-notification",
      expect.any(Function),
    );
    native.handlers.get("terax:terminal-notification")?.({
      payload: { ptyId: 1, kind: "bell" },
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ ptyId: 1, kind: "bell", body: "" }),
    );
  });
});

describe("model adapters", () => {
  it("wraps events for the reducer", async () => {
    const mod = await load();
    const event = mod.parseAgentHookEvent(valid);
    if (!event) throw new Error("expected an event");
    expect(mod.hookEventToModelEvent(event)).toEqual({ type: "hook", event });
    expect(
      mod.signalToModelEvent({ id: 4, kind: "started", agent: "codex" }, 77),
    ).toEqual({
      type: "signal",
      signal: { id: 4, kind: "started", agent: "codex" },
      at: 77,
    });
  });
});
