import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
const native = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  handler: undefined as Handler | undefined,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

async function load() {
  vi.resetModules();
  return import("./agentDecisions");
}

const event = {
  paneId: 1,
  ptyId: 2,
  agent: "codex",
  kind: "stop",
  at: 5,
};

beforeEach(() => {
  native.handler = undefined;
  native.listen.mockReset();
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(true);
  native.listen.mockImplementation(async (_name: string, cb: Handler) => {
    native.handler = cb;
    return () => undefined;
  });
});

describe("resolveAgentDecision", () => {
  it("sends the request id and decision to the native broker", async () => {
    const { resolveAgentDecision } = await load();
    await expect(
      resolveAgentDecision("d-1", { behavior: "allow", remember: 0 }),
    ).resolves.toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("agent_decision_respond", {
      requestId: "d-1",
      decision: { behavior: "allow", remember: 0 },
    });
  });

  it("reports a request that already ended", async () => {
    native.invoke.mockResolvedValue(false);
    const { resolveAgentDecision } = await load();
    await expect(
      resolveAgentDecision("d-9", { behavior: "ask" }),
    ).resolves.toBe(false);
  });
});

describe("connectAgentEvents", () => {
  it("dispatches model events and declares decision support only after attaching", async () => {
    const { connectAgentEvents } = await load();
    const dispatch = vi.fn();
    const stop = connectAgentEvents(dispatch, { decisions: true });
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("agent_decisions_ready", {
        ready: true,
      }),
    );
    expect(native.handler).toBeDefined();

    native.handler?.({ payload: event });
    expect(dispatch).toHaveBeenCalledWith({
      type: "hook",
      event: expect.objectContaining({ kind: "stop", ptyId: 2 }),
    });

    stop();
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenLastCalledWith("agent_decisions_ready", {
        ready: false,
      }),
    );
  });

  it("never touches decision readiness when decisions are off", async () => {
    const { connectAgentEvents } = await load();
    const stop = connectAgentEvents(vi.fn(), { decisions: false });
    await Promise.resolve();
    stop();
    await Promise.resolve();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("does not declare support when disposed before the listener attached", async () => {
    let attach: (value: () => undefined) => void = () => undefined;
    native.listen.mockImplementation(
      () =>
        new Promise((resolve) => {
          attach = resolve;
        }),
    );
    const { connectAgentEvents } = await load();
    const stop = connectAgentEvents(vi.fn(), { decisions: true });
    stop();
    attach(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Never announced, so there is nothing to withdraw either.
    expect(native.invoke).not.toHaveBeenCalled();
  });
});

describe("decision readiness across connections", () => {
  const ready = (value: boolean) =>
    native.invoke.mock.calls.filter(
      ([name, args]) =>
        name === "agent_decisions_ready" &&
        (args as { ready: boolean }).ready === value,
    ).length;

  it("announces once and withdraws only when the last connection leaves", async () => {
    const { connectAgentEvents } = await load();
    const first = connectAgentEvents(vi.fn(), { decisions: true });
    const second = connectAgentEvents(vi.fn(), { decisions: true });
    await vi.waitFor(() => expect(ready(true)).toBe(1));
    await Promise.resolve();
    expect(ready(true)).toBe(1);

    first();
    await Promise.resolve();
    await Promise.resolve();
    expect(ready(false)).toBe(0);

    second();
    await vi.waitFor(() => expect(ready(false)).toBe(1));
  });

  it("makes cleanup idempotent", async () => {
    const { connectAgentEvents } = await load();
    const only = connectAgentEvents(vi.fn(), { decisions: true });
    const other = connectAgentEvents(vi.fn(), { decisions: true });
    await vi.waitFor(() => expect(ready(true)).toBe(1));
    only();
    only();
    only();
    await Promise.resolve();
    await Promise.resolve();
    expect(ready(false)).toBe(0);
    other();
    await vi.waitFor(() => expect(ready(false)).toBe(1));
  });

  it("does not count a connection disposed before it attached", async () => {
    const { connectAgentEvents } = await load();
    const active = connectAgentEvents(vi.fn(), { decisions: true });
    await vi.waitFor(() => expect(ready(true)).toBe(1));
    connectAgentEvents(vi.fn(), { decisions: true })();
    await Promise.resolve();
    await Promise.resolve();
    expect(ready(false)).toBe(0);
    active();
    await vi.waitFor(() => expect(ready(false)).toBe(1));
  });

  it("never announces decisions when the listener could not attach", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    native.listen.mockRejectedValue(new Error("denied"));
    const { connectAgentEvents } = await load();
    const stop = connectAgentEvents(vi.fn(), { decisions: true });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    stop();
    await Promise.resolve();
    expect(ready(true)).toBe(0);
    expect(ready(false)).toBe(0);
    spy.mockRestore();
  });
});
