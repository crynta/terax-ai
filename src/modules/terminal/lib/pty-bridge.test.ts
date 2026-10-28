import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyFrame } from "@/modules/terminal/lib/ptyWire";
import { decodeRequest, encodeFrames } from "./ptyWireFixtures";

type Request = {
  url: string;
  acks: { id: number; bytes: number }[];
  signal?: AbortSignal | null;
  reply(frames?: PtyFrame[]): void;
};

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  signal: null as
    | null
    | ((event: {
        payload: { id: number; kind: string; agent?: string };
      }) => void),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string, protocol: string) =>
    `${protocol}://localhost/${path}`,
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

// The bridge owns a process-wide hub, so every test gets a fresh module graph.
async function load() {
  vi.resetModules();
  const [bridge, activity, presentation] = await Promise.all([
    import("./pty-bridge"),
    import("./agentActivity"),
    import("./ptyPresentation"),
  ]);
  return {
    openPty: bridge.openPty,
    tabAgentStatus: activity.tabAgentStatus,
    useAgentActivityStore: activity.useAgentActivityStore,
    setLeafPresentation: presentation.setLeafPresentation,
  };
}

const requests: Request[] = [];

function stubNative() {
  vi.stubGlobal(
    "fetch",
    (url: string, init: { body: Uint8Array; signal?: AbortSignal | null }) =>
      new Promise<Response>((resolve, reject) => {
        const request: Request = {
          url,
          acks: decodeRequest(init.body).acks,
          signal: init.signal,
          reply: (frames = []) => {
            const body = encodeFrames(frames);
            resolve({
              status: 200,
              arrayBuffer: async () => body.buffer.slice(0),
            } as Response);
          },
        };
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        requests.push(request);
      }),
  );
}

const polls = () => requests.filter((request) => request.url.endsWith("/poll"));
const heldPoll = () => {
  const open = polls().filter((poll) => !poll.signal?.aborted);
  return open[open.length - 1];
};
const flush = () => vi.advanceTimersByTimeAsync(0);

/** The arguments of the most recent pty_open call. */
function openArguments(): Record<string, unknown> {
  const call = mocks.invoke.mock.calls.find(([c]) => c === "pty_open");
  expect(call).toBeDefined();
  return call?.[1] as Record<string, unknown>;
}

function nativeInvoke(firstId = 41) {
  let nextId = firstId;
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "pty_stream_open")
      return Promise.resolve("00000000000000aa");
    if (command === "pty_open") return Promise.resolve(nextId++);
    return Promise.resolve();
  });
}

describe("PTY bridge over the multiplexed stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requests.length = 0;
    mocks.invoke.mockReset();
    stubNative();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes before spawning and updates agent icons through exit and close", async () => {
    const { openPty, tabAgentStatus, useAgentActivityStore } = await load();
    let subscribed!: () => void;
    mocks.listen.mockImplementationOnce((_name, callback) => {
      mocks.signal = callback;
      return new Promise<() => void>((resolve) => {
        subscribed = () => resolve(() => {});
      });
    });
    let nextId = 50;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "pty_stream_open")
        return Promise.resolve("00000000000000aa");
      if (command === "pty_open") {
        expect(mocks.signal).not.toBeNull();
        return Promise.resolve(nextId++);
      }
      return Promise.resolve();
    });
    const openingFirst = openPty(80, 24, { onData: vi.fn() });
    const openingSecond = openPty(80, 24, { onData: vi.fn() });
    await flush();
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
    expect(status(second.id)).toEqual({ state: null, agent: null });
    await first.close();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens the stream before pty_open and no longer passes output channels", async () => {
    const { openPty } = await load();
    nativeInvoke();
    await openPty(80, 24, { onData: vi.fn() }, "/work", true, "zsh", 9);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.indexOf("pty_stream_open")).toBeLessThan(
      commands.indexOf("pty_open"),
    );
    const open = openArguments();
    expect(open).toMatchObject({
      cols: 80,
      rows: 24,
      cwd: "/work",
      blocks: true,
      shell: "zsh",
      paneId: 9,
    });
    expect(open).not.toHaveProperty("onData");
    expect(open).not.toHaveProperty("onExit");
    expect(commands).not.toContain("pty_ack_output");
  });

  it("starts the output stream by announcing the terminal on the first poll", async () => {
    const { openPty } = await load();
    nativeInvoke();
    const onData = vi.fn();
    const session = await openPty(80, 24, { onData });
    await flush();
    expect(polls()).toHaveLength(1);
    expect(heldPoll().url).toBe("terax-pty://localhost/poll");
    expect(heldPoll().acks).toEqual([{ id: session.id, bytes: 0 }]);
    heldPoll().reply([
      {
        kind: "data",
        id: session.id,
        offset: 0,
        bytes: Uint8Array.of(1, 2, 3),
      },
    ]);
    await flush();
    expect(onData).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
    await session.close();
  });

  it("acknowledges parsed output on the next poll instead of invoking per chunk", async () => {
    const { openPty } = await load();
    nativeInvoke();
    const session = await openPty(80, 24, { onData: vi.fn() });
    await flush();
    heldPoll().reply([
      { kind: "data", id: session.id, offset: 0, bytes: Uint8Array.of(4, 5) },
    ]);
    await flush();
    heldPoll().reply();
    await flush();
    expect(heldPoll().acks).toEqual([{ id: session.id, bytes: 2 }]);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "pty_ack_output",
      expect.anything(),
    );
    await session.close();
  });

  it("waits for asynchronous parser completion before returning credit", async () => {
    const { openPty } = await load();
    nativeInvoke();
    let finishDelivery: (() => void) | undefined;
    const session = await openPty(80, 24, {
      onData: () =>
        new Promise<void>((resolve) => {
          finishDelivery = resolve;
        }),
    });
    await flush();
    heldPoll().reply([
      { kind: "data", id: session.id, offset: 0, bytes: Uint8Array.of(4, 5) },
    ]);
    await flush();
    heldPoll().reply();
    await flush();
    expect(heldPoll().acks).toEqual([]);
    finishDelivery?.();
    await flush();
    heldPoll().reply();
    await flush();
    expect(heldPoll().acks).toEqual([{ id: session.id, bytes: 2 }]);
    await session.close();
  });

  it("delivers the exit, clears agent activity, and releases the stream entry", async () => {
    const { openPty, useAgentActivityStore } = await load();
    nativeInvoke(60);
    const onExit = vi.fn();
    const session = await openPty(80, 24, { onData: vi.fn(), onExit });
    mocks.signal?.({ payload: { id: 60, kind: "started", agent: "codex" } });
    await flush();
    heldPoll().reply([{ kind: "exit", id: session.id, code: 0 }]);
    await flush();
    expect(onExit).toHaveBeenCalledWith(0);
    expect(useAgentActivityStore.getState().agents[60]).toBeUndefined();
    expect(useAgentActivityStore.getState().phases[60]).toBeUndefined();
    // The last terminal is gone: the held poll is released, nothing else runs.
    expect(polls().filter((poll) => !poll.signal?.aborted)).toHaveLength(1);
    await session.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts a terminal in the class its pane is in and reports later changes", async () => {
    const { openPty, setLeafPresentation } = await load();
    nativeInvoke(70);
    setLeafPresentation(31, false, false);
    await flush();
    const session = await openPty(
      80,
      24,
      { onData: vi.fn() },
      undefined,
      false,
      undefined,
      31,
    );
    const open = openArguments();
    expect(open.presentation).toBe("hidden");
    await flush();
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "pty_set_presentation",
      expect.anything(),
    );
    setLeafPresentation(31, true, true);
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith("pty_set_presentation", {
      ids: [session.id],
      class: "focused",
      seq: 1,
    });
    await session.close();
  });
});
