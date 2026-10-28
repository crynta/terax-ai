import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyOutputReceiver } from "@/modules/terminal/lib/PtyOutputReceiver";
import {
  PTY_WINDOW_BYTES,
  PTY_WINDOW_CHUNKS,
} from "@/modules/terminal/lib/ptyWire";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function schedule(callback: () => void): () => void {
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

describe("PTY output delivery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("yields bulk parsing without granting partial-chunk credit or blocking another terminal", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const input = Uint8Array.from(
      { length: 128 * 1024 },
      (_, index) => index % 251,
    );
    const parsed: Uint8Array[] = [];
    const progress = vi.fn();
    const receiver = new PtyOutputReceiver(
      (bytes) => {
        parsed.push(bytes);
        now += 3;
      },
      progress,
      vi.fn(),
      schedule,
    );
    receiver.start();
    receiver.receive(input);
    expect(parsed).toHaveLength(2);
    await Promise.resolve();
    expect(progress).not.toHaveBeenCalled();
    const otherParse = vi.fn();
    const other = new PtyOutputReceiver(otherParse, vi.fn(), vi.fn());
    other.start();
    other.receive(Uint8Array.of(9));
    expect(otherParse).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(parsed.every((bytes) => bytes.length <= 32 * 1024)).toBe(true);
    expect(Buffer.concat(parsed)).toEqual(Buffer.from(input));
    expect(progress.mock.calls).toEqual([[input.length]]);
    expect(receiver.diagnostics().parseYields).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    receiver.dispose();
    other.dispose();
  });

  it("cancels a yielded parser on close without reporting its unfinished chunk", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const parse = vi.fn(() => {
      now += 5;
    });
    const progress = vi.fn();
    const receiver = new PtyOutputReceiver(parse, progress, vi.fn(), schedule);
    receiver.start();
    receiver.receive(new Uint8Array(128 * 1024));
    receiver.dispose();
    await vi.runAllTimersAsync();
    expect(parse).toHaveBeenCalledOnce();
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports scheduler failure without granting credit for unfinished output", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const progress = vi.fn();
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(
      () => {
        now += 5;
      },
      progress,
      status,
      () => {
        throw new Error("Task scheduling unavailable");
      },
    );
    receiver.start();
    receiver.receive(new Uint8Array(128 * 1024));
    await vi.runAllTimersAsync();
    expect(status).toHaveBeenLastCalledWith("failed");
    expect(progress).not.toHaveBeenCalled();
    receiver.dispose();
  });

  it("coalesces synchronous parsing into one cumulative report without an idle timer", async () => {
    const progress = vi.fn();
    const receiver = new PtyOutputReceiver(vi.fn(), progress, vi.fn());
    receiver.start();
    receiver.receive(Uint8Array.of(1, 2));
    receiver.receive(Uint8Array.of(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.mock.calls).toEqual([[3]]);
    expect(vi.getTimerCount()).toBe(0);
    expect(receiver.diagnostics().reportedBytes).toBe(3);
  });

  it("holds back progress for output parsed before the terminal started", async () => {
    const progress = vi.fn();
    const receiver = new PtyOutputReceiver(vi.fn(), progress, vi.fn());
    receiver.receive(Uint8Array.of(1, 2, 3));
    await vi.advanceTimersByTimeAsync(0);
    expect(progress).not.toHaveBeenCalled();
    receiver.start();
    expect(progress.mock.calls).toEqual([[3]]);
  });

  it("serializes asynchronous parsing and never reports an unparsed prefix", async () => {
    const first = deferred();
    const second = deferred();
    const parse = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const progress = vi.fn();
    const receiver = new PtyOutputReceiver(parse, progress, vi.fn());
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    receiver.receive(Uint8Array.of(2, 3));
    expect(parse).toHaveBeenCalledTimes(1);
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(progress).not.toHaveBeenCalled();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(parse).toHaveBeenCalledTimes(2);
    // Each report is a whole-chunk boundary, in order.
    expect(progress.mock.calls).toEqual([[1], [3]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a stalled parser after five seconds and recovers when it finishes", async () => {
    const parsing = deferred();
    const progress = vi.fn();
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(
      () => parsing.promise,
      progress,
      status,
    );
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenLastCalledWith("stalled");
    parsing.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith("running");
    expect(progress.mock.calls).toEqual([[1]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("merges the hub's transport health into the one visible status", () => {
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(vi.fn(), vi.fn(), status);
    receiver.setTransportStatus("retrying");
    receiver.setTransportStatus("retrying");
    receiver.setTransportStatus("stalled");
    receiver.setTransportStatus("ok");
    expect(status.mock.calls).toEqual([["retrying"], ["stalled"], ["running"]]);
    receiver.fail(new Error("native failure"));
    receiver.setTransportStatus("stalled");
    receiver.setTransportStatus("ok");
    expect(status).toHaveBeenLastCalledWith("failed");
    expect(receiver.hasFailed).toBe(true);
  });

  it.each([false, true])(
    "does not report progress after parser failure (async=%s)",
    async (async) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const progress = vi.fn();
      const status = vi.fn();
      const receiver = new PtyOutputReceiver(
        () => {
          const error = new Error("parser failed");
          if (async) return Promise.reject(error);
          throw error;
        },
        progress,
        status,
      );
      receiver.start();
      receiver.receive(Uint8Array.of(1));
      receiver.receive(Uint8Array.of(2));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(progress).not.toHaveBeenCalled();
      expect(status).toHaveBeenLastCalledWith("failed");
      expect(vi.getTimerCount()).toBe(0);
      receiver.dispose();
      log.mockRestore();
    },
  );

  it("keeps earlier progress when a later chunk fails to parse", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const progress = vi.fn();
    let calls = 0;
    const receiver = new PtyOutputReceiver(
      () => {
        if (++calls === 2) throw new Error("bad sequence");
      },
      progress,
      vi.fn(),
    );
    receiver.start();
    receiver.receive(Uint8Array.of(1, 2));
    await vi.advanceTimersByTimeAsync(0);
    receiver.receive(Uint8Array.of(3, 4, 5));
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.mock.calls).toEqual([[2]]);
    expect(receiver.hasFailed).toBe(true);
  });

  it("fails visibly when native exceeds the negotiated window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const never = deferred();
    const receiver = new PtyOutputReceiver(
      () => never.promise,
      vi.fn(),
      vi.fn(),
    );
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    receiver.receive(new Uint8Array(PTY_WINDOW_BYTES));
    expect(receiver.hasFailed).toBe(true);

    const chunks = new PtyOutputReceiver(() => never.promise, vi.fn(), vi.fn());
    chunks.start();
    for (let index = 0; index <= PTY_WINDOW_CHUNKS; index++)
      chunks.receive(Uint8Array.of(index));
    expect(chunks.hasFailed).toBe(true);

    const empty = new PtyOutputReceiver(vi.fn(), vi.fn(), vi.fn());
    empty.receive(new Uint8Array(0));
    expect(empty.hasFailed).toBe(true);
  });

  it("cleans up pending parsing on close", async () => {
    const parsed = deferred();
    const progress = vi.fn();
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(
      () => parsed.promise,
      progress,
      status,
    );
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(status).toHaveBeenLastCalledWith("stalled");
    receiver.dispose();
    parsed.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(receiver.diagnostics().pendingChunks).toBe(0);
  });
});
