import { describe, expect, it, vi } from "vitest";
import { BoundedPtyWriter } from "@/modules/terminal/lib/BoundedPtyWriter";

describe("BoundedPtyWriter", () => {
  it("splits a paste into ordered writes of at most 64 KiB", async () => {
    const onError = vi.fn();
    const writer = new BoundedPtyWriter(onError);
    const payload = Uint8Array.from(
      { length: 200_000 },
      (_, index) => index % 251,
    );
    const writes: Uint8Array[] = [];
    writer.attach({
      write: async (bytes) => {
        writes.push(bytes.slice());
      },
    });
    expect(writer.enqueue(payload)).toBe(true);
    await vi.waitFor(() => expect(writer.pendingBytes).toBe(0));
    expect(writes.map((bytes) => bytes.byteLength)).toEqual([
      65_536, 65_536, 65_536, 3_392,
    ]);
    expect(Uint8Array.from(writes.flatMap((bytes) => [...bytes]))).toEqual(
      payload,
    );
    expect(onError).not.toHaveBeenCalled();
    writer.dispose();
  });

  it("counts in-flight input toward the limit and rejects a paste atomically", async () => {
    const onError = vi.fn();
    const writer = new BoundedPtyWriter(onError);
    let complete = () => {};
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    writer.attach({ write });
    expect(writer.enqueue(new Uint8Array(65_536))).toBe(true);
    expect(writer.enqueue(new Uint8Array(196_608))).toBe(true);
    expect(writer.pendingBytes).toBe(262_144);
    expect(writer.enqueue(Uint8Array.of(3))).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(writer.pendingBytes).toBe(262_144);
    writer.dispose();
    complete();
    await Promise.resolve();
    expect(write).toHaveBeenCalledOnce();
    expect(writer.pendingBytes).toBe(0);
  });

  it("rejects oversized input without retaining or sending its prefix", () => {
    const onError = vi.fn();
    const writer = new BoundedPtyWriter(onError);
    const write = vi.fn(async () => {});
    writer.attach({ write });
    expect(writer.enqueue(new Uint8Array(262_145))).toBe(false);
    expect(writer.pendingBytes).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain("buffer is full");
    writer.dispose();
  });

  it("coalesces queued input without changing byte order", async () => {
    const writer = new BoundedPtyWriter(vi.fn());
    const first = new Uint8Array(40_000).fill(1);
    const second = new Uint8Array(40_000).fill(2);
    writer.enqueue(first);
    writer.enqueue(second);
    const write = vi.fn(async (_bytes: Uint8Array) => {});
    writer.attach({ write });
    await vi.waitFor(() => expect(writer.pendingBytes).toBe(0));
    expect(write.mock.calls.map(([bytes]) => bytes.length)).toEqual([
      65_536, 14_464,
    ]);
    expect([...write.mock.calls[0][0], ...write.mock.calls[1][0]]).toEqual([
      ...first,
      ...second,
    ]);
    writer.dispose();
  });

  it("stops after a failed write instead of sending the tail of a broken paste", async () => {
    const onError = vi.fn();
    const writer = new BoundedPtyWriter(onError);
    const write = vi.fn(async () => {
      throw new Error("pipe closed");
    });
    writer.attach({ write });
    writer.enqueue(new Uint8Array(100_000));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(write).toHaveBeenCalledOnce();
    expect(writer.pendingBytes).toBe(0);
    expect(writer.enqueue(Uint8Array.of(3))).toBe(false);
    writer.dispose();
  });

  it("does not report write failures after disposal", async () => {
    const onError = vi.fn();
    const writer = new BoundedPtyWriter(onError);
    let fail = (_error: Error) => {};
    writer.attach({
      write: () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    });
    writer.enqueue(Uint8Array.of(1));
    writer.dispose();
    fail(new Error("closed"));
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(writer.pendingBytes).toBe(0);
  });
});
