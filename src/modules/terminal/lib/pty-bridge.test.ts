import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channels: [] as Array<{ onmessage: (value: unknown) => void }>,
  invoke: vi.fn(),
  signal: null as
    | null
    | ((event: {
        payload: { id: number; kind: string; agent?: string };
      }) => void),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = (_value: unknown) => {};

    constructor() {
      mocks.channels.push(this);
    }
  },
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen.mockImplementation((_name, callback) => {
    mocks.signal = callback;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => null,
}));

import { tabAgentStatus, useAgentActivityStore } from "./agentActivity";
import { openPty } from "./pty-bridge";

describe("PTY output flow control", () => {
  it("subscribes before spawning and updates agent icons through exit and close", async () => {
    let subscribed!: () => void;
    mocks.listen.mockImplementationOnce((_name, callback) => {
      mocks.signal = callback;
      return new Promise<() => void>((resolve) => {
        subscribed = () => resolve(() => {});
      });
    });
    let nextId = 50;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "pty_open") {
        expect(mocks.signal).not.toBeNull();
        return Promise.resolve(nextId++);
      }
      return Promise.resolve();
    });
    const openingFirst = openPty(80, 24, { onData: vi.fn() });
    const openingSecond = openPty(80, 24, { onData: vi.fn() });
    expect(mocks.invoke).not.toHaveBeenCalled();
    subscribed();
    const [first, second] = await Promise.all([openingFirst, openingSecond]);
    expect(mocks.listen).toHaveBeenCalledTimes(1);
    const status = (id: number) => {
      const { phases, agents } = useAgentActivityStore.getState();
      return tabAgentStatus(phases, agents, [id]);
    };
    for (const [id, agent] of [
      [first.id, "claude"],
      [second.id, "codex"],
    ] as const) {
      mocks.signal?.({ payload: { id, kind: "started", agent } });
      expect(status(id)).toEqual({ state: "working", agent });
    }
    mocks.signal?.({ payload: { id: first.id, kind: "attention" } });
    useAgentActivityStore.getState().acknowledgeAttention([first.id]);
    expect(status(first.id)).toEqual({ state: "idle", agent: "claude" });
    mocks.signal?.({ payload: { id: first.id, kind: "exited" } });
    expect(status(first.id)).toEqual({ state: null, agent: null });
    mocks.signal?.({ payload: { id: second.id, kind: "finished" } });
    await second.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(status(second.id)).toEqual({ state: null, agent: null });
    await first.close();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.channels.length = 0;
    mocks.invoke.mockReset();
  });

  it("acknowledges output that arrives before pty_open resolves", async () => {
    let resolveOpen: ((id: number) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "pty_open") {
        return new Promise<number>((resolve) => {
          resolveOpen = resolve;
        });
      }
      return Promise.resolve();
    });
    const onData = vi.fn();
    const opening = openPty(80, 24, { onData });
    const bytes = new Uint8Array([1, 2, 3]);

    mocks.channels[0].onmessage(bytes.buffer);
    await Promise.resolve();
    await Promise.resolve();
    expect(onData).toHaveBeenCalledWith(bytes);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "pty_ack_output",
      expect.anything(),
    );

    resolveOpen?.(41);
    await opening;

    expect(mocks.invoke).toHaveBeenCalledWith("pty_ack_output", {
      id: 41,
      bytes: 3,
    });
  });

  it("clears agent activity when the shell exit arrives before open resolves", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command !== "pty_open") return Promise.resolve();
      mocks.signal?.({ payload: { id: 60, kind: "started", agent: "codex" } });
      mocks.channels[1].onmessage(0);
      return Promise.resolve(60);
    });
    const onExit = vi.fn();
    await openPty(80, 24, { onData: vi.fn(), onExit });
    expect(onExit).toHaveBeenCalledWith(0);
    expect(useAgentActivityStore.getState().agents[60]).toBeUndefined();
    expect(useAgentActivityStore.getState().phases[60]).toBeUndefined();
  });

  it("waits for asynchronous parser completion before returning credit", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      command === "pty_open" ? Promise.resolve(7) : Promise.resolve(),
    );
    let finishDelivery: (() => void) | undefined;
    const session = await openPty(80, 24, {
      onData: () =>
        new Promise<void>((resolve) => {
          finishDelivery = resolve;
        }),
    });
    const bytes = new Uint8Array([4, 5]);

    mocks.channels[0].onmessage(bytes.buffer);
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "pty_ack_output",
      expect.anything(),
    );

    finishDelivery?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.invoke).toHaveBeenCalledWith("pty_ack_output", {
      id: session.id,
      bytes: 2,
    });
  });
});
