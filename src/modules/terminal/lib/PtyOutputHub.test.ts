import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACK_ONLY_BYTES,
  PtyOutputHub,
  type PtyStreamResponse,
  type PtyStreamTransport,
} from "@/modules/terminal/lib/PtyOutputHub";
import {
  PtyOutputReceiver,
  type PtyOutputStatus,
} from "@/modules/terminal/lib/PtyOutputReceiver";
import {
  MAX_ACKS_PER_REQUEST,
  type PtyAck,
  type PtyFrame,
  tokenBytes,
} from "@/modules/terminal/lib/ptyWire";
import { decodeRequest, encodeFrames } from "./ptyWireFixtures";

type Call = {
  acks: PtyAck[];
  token: string;
  signal?: AbortSignal;
  settled: boolean;
  respond(frames?: PtyFrame[], status?: number): void;
  reply(response: PtyStreamResponse): void;
  fail(error?: Error): void;
};

class FakeTransport implements PtyStreamTransport {
  tokens = ["00000000000000aa", "00000000000000bb"];
  opens = 0;
  polls: Call[] = [];
  acks: Call[] = [];

  async open() {
    return tokenBytes(
      this.tokens[Math.min(this.opens++, this.tokens.length - 1)],
    );
  }

  poll(body: Uint8Array, signal: AbortSignal) {
    return this.call(this.polls, body, signal);
  }

  ack(body: Uint8Array) {
    return this.call(this.acks, body);
  }

  private call(into: Call[], body: Uint8Array, signal?: AbortSignal) {
    return new Promise<PtyStreamResponse>((resolve, reject) => {
      const request = decodeRequest(body);
      const call: Call = {
        ...request,
        signal,
        settled: false,
        reply: (response) => {
          call.settled = true;
          resolve(response);
        },
        respond: (frames = [], status = 200) =>
          call.reply({ status, body: encodeFrames(frames) }),
        fail: (error = new Error("transport down")) => {
          call.settled = true;
          reject(error);
        },
      };
      signal?.addEventListener("abort", () => {
        call.settled = true;
        reject(new DOMException("aborted", "AbortError"));
      });
      into.push(call);
    });
  }

  /** The poll native is currently holding. */
  get held(): Call {
    const open = this.polls.filter((call) => !call.settled);
    expect(open).toHaveLength(1);
    return open[0];
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const bytes = (length: number, fill = 7) => new Uint8Array(length).fill(fill);

type Terminal = {
  id: number;
  receiver: PtyOutputReceiver;
  parse: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn<(status: PtyOutputStatus) => void>>;
  exits: number[];
};

function open(
  hub: PtyOutputHub,
  id: number,
  parse: (bytes: Uint8Array) => void | Promise<void> = () => {},
): Terminal {
  const parser = vi.fn(parse);
  const status = vi.fn<(status: PtyOutputStatus) => void>();
  const exits: number[] = [];
  let handle: ReturnType<PtyOutputHub["register"]> | null = null;
  const receiver = new PtyOutputReceiver(
    parser,
    (processed) => handle?.progress(processed),
    status,
  );
  handle = hub.register(id, receiver, (code) => exits.push(code));
  receiver.start();
  return { id, receiver, parse: parser, status, exits };
}

describe("PtyOutputHub", () => {
  let transport: FakeTransport;
  let hub: PtyOutputHub;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    transport = new FakeTransport();
    hub = new PtyOutputHub(transport);
  });

  afterEach(() => {
    hub.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens the stream once and keeps exactly one poll outstanding", async () => {
    await Promise.all([hub.ensureStream(), hub.ensureStream()]);
    await hub.ensureStream();
    expect(transport.opens).toBe(1);
    open(hub, 1);
    open(hub, 2);
    await flush();
    expect(transport.polls).toHaveLength(1);
    expect(transport.held.token).toBe("00000000000000aa");
    // Both terminals announced themselves in the first request.
    expect(transport.held.acks).toEqual([
      { id: 1, bytes: 0 },
      { id: 2, bytes: 0 },
    ]);
    expect(transport.acks).toHaveLength(0);
  });

  it("announces a terminal opened while a poll is held with one ack-only request", async () => {
    await hub.ensureStream();
    open(hub, 1);
    await flush();
    open(hub, 2);
    open(hub, 3);
    await flush();
    expect(transport.polls).toHaveLength(1);
    expect(transport.acks).toHaveLength(1);
    expect(transport.acks[0].acks).toEqual([
      { id: 2, bytes: 0 },
      { id: 3, bytes: 0 },
    ]);
    transport.acks[0].respond();
    await flush();
    // The announcement is confirmed: nothing is re-sent.
    expect(transport.acks).toHaveLength(1);
  });

  it("demultiplexes frames to their terminals and validates stream offsets", async () => {
    await hub.ensureStream();
    const a = open(hub, 1);
    const b = open(hub, 2);
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: Uint8Array.of(1, 2) },
      { kind: "data", id: 2, offset: 0, bytes: Uint8Array.of(9) },
      { kind: "data", id: 1, offset: 2, bytes: Uint8Array.of(3) },
      { kind: "data", id: 99, offset: 0, bytes: Uint8Array.of(4) },
    ]);
    await flush();
    expect(a.parse.mock.calls.map(([chunk]) => [...chunk])).toEqual([
      [1, 2],
      [3],
    ]);
    expect(b.parse.mock.calls.map(([chunk]) => [...chunk])).toEqual([[9]]);
    expect(hub.diagnostics().frames).toBe(4);
  });

  it("issues the next poll before parsing the response", async () => {
    await hub.ensureStream();
    const seen: number[] = [];
    open(hub, 1, () => {
      seen.push(transport.polls.length);
    });
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: Uint8Array.of(1) },
    ]);
    await flush();
    // The second poll was already in flight when the first byte was parsed.
    expect(seen).toEqual([2]);
    expect(transport.polls).toHaveLength(2);
  });

  it("batches every terminal's progress into the next poll as cumulative offsets", async () => {
    await hub.ensureStream();
    open(hub, 1);
    open(hub, 2);
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: bytes(100) },
      { kind: "data", id: 2, offset: 0, bytes: bytes(10) },
    ]);
    await flush();
    // Small progress waits for a poll instead of costing its own request.
    expect(transport.acks).toHaveLength(0);
    transport.held.respond([
      { kind: "data", id: 1, offset: 100, bytes: bytes(50) },
    ]);
    await flush();
    expect(transport.polls).toHaveLength(3);
    // The poll was issued before this response was parsed, so it carries the
    // progress made on earlier responses, for both terminals at once.
    expect(transport.held.acks).toEqual([
      { id: 1, bytes: 100 },
      { id: 2, bytes: 10 },
    ]);
    transport.held.respond();
    await flush();
    expect(transport.held.acks).toEqual([{ id: 1, bytes: 150 }]);
    // Nothing new was parsed, so the following poll carries no duplicates.
    transport.held.respond();
    await flush();
    expect(transport.polls).toHaveLength(5);
    expect(transport.held.acks).toEqual([]);
    expect(transport.acks).toHaveLength(0);
  });

  it("sends an ack-only request only when unsent progress passes half the window", async () => {
    await hub.ensureStream();
    open(hub, 1);
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: bytes(ACK_ONLY_BYTES - 1) },
    ]);
    await flush();
    expect(transport.acks).toHaveLength(0);
    transport.held.respond([
      {
        kind: "data",
        id: 1,
        offset: ACK_ONLY_BYTES - 1,
        bytes: bytes(1),
      },
    ]);
    await flush();
    // The poll that was issued first carried the earlier progress; the last
    // byte is below the threshold again, so it still waits.
    expect(transport.acks).toHaveLength(0);
    transport.held.respond([
      {
        kind: "data",
        id: 1,
        offset: ACK_ONLY_BYTES,
        bytes: bytes(ACK_ONLY_BYTES),
      },
    ]);
    await flush();
    expect(transport.acks).toHaveLength(1);
    expect(transport.acks[0].acks).toEqual([
      { id: 1, bytes: 2 * ACK_ONLY_BYTES },
    ]);
  });

  it("acknowledges as soon as bytes are parsed once native says it is waiting", async () => {
    await hub.ensureStream();
    let finish!: () => void;
    open(
      hub,
      1,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: bytes(1000) },
    ]);
    await flush();
    transport.held.respond([{ kind: "sync", id: 1 }]);
    await flush();
    expect(transport.acks).toHaveLength(0); // nothing parsed yet
    finish();
    await flush();
    expect(transport.acks).toHaveLength(1);
    expect(transport.acks[0].acks).toEqual([{ id: 1, bytes: 1000 }]);
  });

  it("ignores a sync for a terminal whose progress was already sent", async () => {
    await hub.ensureStream();
    open(hub, 1);
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: bytes(10) },
    ]);
    await flush();
    transport.held.respond([{ kind: "sync", id: 1 }]);
    await flush();
    // The sync response itself prompted a poll that carries the progress.
    expect(transport.acks).toHaveLength(0);
    expect(transport.held.acks).toEqual([{ id: 1, bytes: 10 }]);
  });

  it("treats an empty response as a keepalive and polls again", async () => {
    await hub.ensureStream();
    const a = open(hub, 1);
    await flush();
    transport.held.respond();
    await flush();
    expect(transport.polls).toHaveLength(2);
    expect(hub.diagnostics().keepalives).toBe(1);
    expect(a.parse).not.toHaveBeenCalled();
  });

  it("delivers the exit code once and stops acknowledging that terminal", async () => {
    await hub.ensureStream();
    const a = open(hub, 1);
    const b = open(hub, 2);
    await flush();
    transport.held.respond([
      { kind: "data", id: 1, offset: 0, bytes: bytes(5) },
      { kind: "exit", id: 1, code: 3 },
      { kind: "data", id: 2, offset: 0, bytes: bytes(5) },
    ]);
    await flush();
    expect(a.exits).toEqual([3]);
    transport.held.respond([
      { kind: "data", id: 1, offset: 5, bytes: bytes(1) },
    ]);
    await flush();
    expect(a.parse).toHaveBeenCalledTimes(1); // frames after exit are ignored
    expect(transport.held.acks).toEqual([{ id: 2, bytes: 5 }]);
    expect(b.exits).toEqual([]);
  });

  it("stops polling when the last terminal closes and resumes for the next one", async () => {
    await hub.ensureStream();
    open(hub, 1);
    await flush();
    const first = transport.polls[0];
    hub.unregister(1);
    expect(first.signal?.aborted).toBe(true);
    await flush();
    expect(transport.polls).toHaveLength(1);
    open(hub, 2);
    await flush();
    expect(transport.polls).toHaveLength(2);
    expect(transport.held.acks).toEqual([{ id: 2, bytes: 0 }]);
    expect(hub.diagnostics().failures).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never puts more than 64 acknowledgements in one request", async () => {
    await hub.ensureStream();
    for (let id = 1; id <= MAX_ACKS_PER_REQUEST + 6; id++) open(hub, id);
    await flush();
    expect(transport.held.acks).toHaveLength(MAX_ACKS_PER_REQUEST);
    expect(transport.acks).toHaveLength(1);
    expect(transport.acks[0].acks.map((ack) => ack.id)).toEqual([
      65, 66, 67, 68, 69, 70,
    ]);
  });

  describe("failure handling", () => {
    it("retries a failed poll with capped backoff, reports it, and resends progress", async () => {
      await hub.ensureStream();
      const a = open(hub, 1);
      await flush();
      transport.held.respond([
        { kind: "data", id: 1, offset: 0, bytes: bytes(5) },
      ]);
      await flush();
      transport.held.respond([
        { kind: "data", id: 1, offset: 5, bytes: bytes(5) },
      ]);
      await flush();
      expect(transport.held.acks).toEqual([{ id: 1, bytes: 5 }]);
      transport.held.fail();
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("retrying");
      await vi.advanceTimersByTimeAsync(49);
      expect(transport.polls).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(transport.polls).toHaveLength(4);
      // The lost request's progress is sent again, cumulative and current.
      expect(transport.held.acks).toEqual([{ id: 1, bytes: 10 }]);
      transport.held.fail();
      await vi.advanceTimersByTimeAsync(99);
      expect(transport.polls).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(transport.polls).toHaveLength(5);
      for (let attempt = 0; attempt < 4; attempt++) {
        transport.held.fail();
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(a.status).toHaveBeenLastCalledWith("stalled");
      expect(hub.diagnostics().consecutiveFailures).toBeGreaterThanOrEqual(5);
      transport.held.respond();
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("running");
      expect(hub.diagnostics().consecutiveFailures).toBe(0);
    });

    it("lets the visible Retry skip the backoff", async () => {
      await hub.ensureStream();
      open(hub, 1);
      await flush();
      transport.held.fail();
      await flush();
      hub.retry();
      expect(transport.polls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(transport.polls).toHaveLength(2); // the old timer is gone
    });

    it("keeps unconfirmed progress when an ack-only request fails", async () => {
      await hub.ensureStream();
      open(hub, 1);
      await flush();
      transport.held.respond([
        { kind: "data", id: 1, offset: 0, bytes: bytes(ACK_ONLY_BYTES) },
      ]);
      await flush();
      expect(transport.acks).toHaveLength(1);
      transport.acks[0].fail();
      await flush();
      expect(transport.acks).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(50);
      expect(transport.acks).toHaveLength(2);
      expect(transport.acks[1].acks).toEqual([
        { id: 1, bytes: ACK_ONLY_BYTES },
      ]);
      transport.acks[1].respond();
      await flush();
      expect(transport.acks).toHaveLength(2);
    });

    it("isolates a stream gap to the terminal that suffered it", async () => {
      await hub.ensureStream();
      const a = open(hub, 1);
      const b = open(hub, 2);
      await flush();
      transport.held.respond([
        { kind: "data", id: 1, offset: 77, bytes: bytes(5) },
        { kind: "data", id: 2, offset: 0, bytes: bytes(8) },
      ]);
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("failed");
      expect(a.parse).not.toHaveBeenCalled();
      expect(b.status).not.toHaveBeenCalledWith("failed");
      transport.held.respond([
        { kind: "data", id: 2, offset: 8, bytes: bytes(2) },
        { kind: "data", id: 1, offset: 82, bytes: bytes(1) },
      ]);
      await flush();
      expect(b.parse).toHaveBeenCalledTimes(2);
      expect(transport.held.acks).toEqual([{ id: 2, bytes: 8 }]);
      transport.held.respond();
      await flush();
      expect(transport.held.acks).toEqual([{ id: 2, bytes: 10 }]);
    });

    it("stops acknowledging a terminal whose parser failed without touching the rest", async () => {
      await hub.ensureStream();
      const a = open(hub, 1, () => {
        throw new Error("parser failed");
      });
      const b = open(hub, 2);
      await flush();
      transport.held.respond([
        { kind: "data", id: 1, offset: 0, bytes: bytes(5) },
        { kind: "data", id: 2, offset: 0, bytes: bytes(6) },
      ]);
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("failed");
      transport.held.respond([
        { kind: "data", id: 2, offset: 6, bytes: bytes(1) },
      ]);
      await flush();
      expect(transport.held.acks).toEqual([{ id: 2, bytes: 6 }]);
      transport.held.respond();
      await flush();
      expect(transport.held.acks).toEqual([{ id: 2, bytes: 7 }]);
      expect(b.exits).toEqual([]);
    });

    it("fails only the named terminal on a native failure frame", async () => {
      await hub.ensureStream();
      const a = open(hub, 1);
      const b = open(hub, 2);
      await flush();
      transport.held.respond([
        {
          kind: "failed",
          id: 1,
          reason: "invalid output acknowledgement boundary",
        },
      ]);
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("failed");
      expect(b.status).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it("fails every terminal on a malformed response and keeps the hub reusable", async () => {
      await hub.ensureStream();
      const a = open(hub, 1);
      const b = open(hub, 2);
      await flush();
      transport.held.reply({ status: 200, body: Uint8Array.of(1, 2, 3) });
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("failed");
      expect(b.status).toHaveBeenLastCalledWith("failed");
      expect(transport.polls.filter((call) => !call.settled)).toHaveLength(0);
      // A terminal opened afterwards starts a fresh poll without the dead ones.
      const c = open(hub, 3);
      await flush();
      expect(transport.held.acks).toEqual([{ id: 3, bytes: 0 }]);
      expect(c.status).not.toHaveBeenCalledWith("failed");
    });

    it.each([403, 410])(
      "treats %i as a reset stream: fails terminals and reopens on demand",
      async (status) => {
        await hub.ensureStream();
        const a = open(hub, 1);
        await flush();
        transport.held.reply({ status, body: new Uint8Array(0) });
        await flush();
        expect(a.status).toHaveBeenLastCalledWith("failed");
        expect(transport.polls).toHaveLength(1);
        hub.unregister(1);
        await hub.ensureStream();
        expect(transport.opens).toBe(2);
        open(hub, 2);
        await flush();
        expect(transport.held.token).toBe("00000000000000bb");
      },
    );

    it("treats a superseded poll as a transient failure", async () => {
      await hub.ensureStream();
      const a = open(hub, 1);
      await flush();
      transport.held.reply({ status: 409, body: new Uint8Array(0) });
      await flush();
      expect(a.status).toHaveBeenLastCalledWith("retrying");
      await vi.advanceTimersByTimeAsync(50);
      expect(transport.polls).toHaveLength(2);
    });
  });

  it("drops everything on dispose without leaving timers behind", async () => {
    await hub.ensureStream();
    open(hub, 1);
    await flush();
    transport.held.fail();
    await flush();
    hub.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.polls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
