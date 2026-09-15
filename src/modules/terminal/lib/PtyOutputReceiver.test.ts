import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyOutputReceiver } from "@/modules/terminal/lib/PtyOutputReceiver";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PTY output delivery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces synchronous parsing into cumulative credit without an idle timer", async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const receiver = new PtyOutputReceiver(vi.fn(), ack, vi.fn());
    receiver.start();
    receiver.receive(Uint8Array.of(1, 2));
    receiver.receive(Uint8Array.of(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(ack.mock.calls).toEqual([[3]]);
    expect(vi.getTimerCount()).toBe(0);
    expect(receiver.diagnostics().confirmedBytes).toBe(3);
  });

  it("retries lost acknowledgements with retained cumulative credit", async () => {
    const ack = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection failed"))
      .mockResolvedValue(undefined);
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(vi.fn(), ack, status);
    receiver.start();
    receiver.receive(Uint8Array.of(1, 2));
    await vi.advanceTimersByTimeAsync(0);
    receiver.receive(Uint8Array.of(3));
    await vi.advanceTimersByTimeAsync(50);
    expect(ack.mock.calls).toEqual([[2], [3]]);
    expect(status.mock.calls).toEqual([["retrying"], ["running"]]);
    expect(receiver.diagnostics().confirmedBytes).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes asynchronous parsing and never acknowledges an unparsed prefix", async () => {
    const first = deferred();
    const second = deferred();
    const parse = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const ack = vi.fn().mockResolvedValue(undefined);
    const receiver = new PtyOutputReceiver(parse, ack, vi.fn());
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    receiver.receive(Uint8Array.of(2, 3));
    expect(parse).toHaveBeenCalledTimes(1);
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ack).not.toHaveBeenCalled();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(receiver.diagnostics().confirmedBytes).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds hung IPC calls, reports the stall, and recovers from late replies", async () => {
    const first = deferred();
    const second = deferred();
    const ack = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(undefined);
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(vi.fn(), ack, status);
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(0);
    receiver.receive(Uint8Array.of(2));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ack.mock.calls).toEqual([[1], [2]]);
    expect(status).toHaveBeenLastCalledWith("stalled");
    expect(receiver.diagnostics().ackRequests).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    first.reject(new Error("late stale failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(receiver.diagnostics().confirmedBytes).toBe(2);
    expect(status).toHaveBeenLastCalledWith("running");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes persistent rejection observable while keeping retries bounded", async () => {
    const ack = vi.fn().mockRejectedValue(new Error("offline"));
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(vi.fn(), ack, status);
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ack.mock.calls.length).toBeLessThan(30);
    expect(status).toHaveBeenLastCalledWith("stalled");
    expect(receiver.diagnostics().processedBytes).toBe(1);
    expect(receiver.diagnostics().confirmedBytes).toBe(0);
    ack.mockResolvedValue(undefined);
    receiver.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith("running");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "does not return credit after parser failure (async=%s)",
    async (async) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const ack = vi.fn();
      const status = vi.fn();
      const receiver = new PtyOutputReceiver(
        () => {
          const error = new Error("parser failed");
          if (async) return Promise.reject(error);
          throw error;
        },
        ack,
        status,
      );
      receiver.start();
      receiver.receive(Uint8Array.of(1));
      receiver.receive(Uint8Array.of(2));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ack).not.toHaveBeenCalled();
      expect(status).toHaveBeenLastCalledWith("failed");
      expect(vi.getTimerCount()).toBe(0);
      receiver.dispose();
      log.mockRestore();
    },
  );

  it("cleans up pending parsing and retries on close", async () => {
    const parsed = deferred();
    const ack = vi.fn();
    const status = vi.fn();
    const receiver = new PtyOutputReceiver(() => parsed.promise, ack, status);
    receiver.start();
    receiver.receive(Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(status).toHaveBeenLastCalledWith("stalled");
    receiver.dispose();
    parsed.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ack).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(receiver.diagnostics().pendingChunks).toBe(0);
  });
});
