import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIPBOARD_READ_TIMEOUT_MS,
  ClipboardInputQueue,
} from "@/modules/terminal/ghostty/input/ClipboardInputQueue";

afterEach(() => vi.useRealTimers());

function harness() {
  const reads: { resolve(text: string): void; reject(error: Error): void }[] =
    [];
  const output: string[] = [];
  const error = vi.fn();
  const read = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        reads.push({ resolve, reject });
      }),
  );
  const queue: ClipboardInputQueue = new ClipboardInputQueue({
    read,
    error,
    paste: (text) => queue.send(new TextEncoder().encode(`[${text}]`)),
    send: (bytes) => {
      output.push(new TextDecoder().decode(bytes));
      return true;
    },
  });
  return {
    queue,
    reads,
    output,
    error,
    read,
    type: (text: string) => queue.send(new TextEncoder().encode(text)),
  };
}

describe("clipboard input ordering", () => {
  it("lets an interrupt cancel a pending paste without delivering its late result", async () => {
    const h = harness();
    try {
      h.queue.paste();
      h.type("\r");
      h.queue.cancel();
      h.type("\x03");
      expect(h.output).toEqual(["\x03"]);
      h.reads[0].resolve("cancelled command");
      await Promise.resolve();
      expect(h.output).toEqual(["\x03"]);
      expect(h.error).not.toHaveBeenCalled();
    } finally {
      h.queue.dispose();
    }
  });

  it("drops deferred Enter when the terminal rejects the pasted bytes", async () => {
    let complete = (_text: string) => {};
    const send = vi.fn((_bytes: Uint8Array) => false);
    const queue: ClipboardInputQueue = new ClipboardInputQueue({
      read: () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
      paste: (text) => queue.send(new TextEncoder().encode(text)),
      send,
      error: vi.fn(),
    });
    try {
      queue.paste();
      queue.send(Uint8Array.of(13));
      complete("rejected paste");
      await Promise.resolve();
      expect(send).toHaveBeenCalledOnce();
      expect(new TextDecoder().decode(send.mock.calls[0][0])).toBe(
        "rejected paste",
      );
    } finally {
      queue.dispose();
    }
  });

  it("delivers paste, typing, another paste and Enter in their original order", async () => {
    const h = harness();
    try {
      h.queue.paste();
      h.type("x");
      h.queue.paste();
      h.type("\r");
      expect(h.output).toEqual([]);
      expect(h.read).toHaveBeenCalledOnce();
      h.reads[0].resolve("first");
      await Promise.resolve();
      expect(h.output).toEqual(["[first]", "x"]);
      expect(h.read).toHaveBeenCalledTimes(2);
      h.reads[1].resolve("second");
      await Promise.resolve();
      expect(h.output).toEqual(["[first]", "x", "[second]", "\r"]);
    } finally {
      h.queue.dispose();
    }
  });

  it("does not execute deferred Enter after a failed paste", async () => {
    const h = harness();
    try {
      h.queue.paste();
      h.type("\r");
      h.reads[0].reject(new Error("clipboard busy"));
      await Promise.resolve();
      expect(h.error).toHaveBeenCalledOnce();
      expect(h.output).toEqual([]);
      h.type("x");
      expect(h.output).toEqual(["x"]);
    } finally {
      h.queue.dispose();
    }
  });

  it("restores typing after a read timeout without starting more stuck clipboard calls", async () => {
    vi.useFakeTimers();
    const h = harness();
    try {
      h.queue.paste();
      h.type("\r");
      await vi.advanceTimersByTimeAsync(CLIPBOARD_READ_TIMEOUT_MS);
      expect(h.error).toHaveBeenCalledOnce();
      expect(h.output).toEqual([]);
      h.type("x");
      h.queue.paste();
      expect(h.output).toEqual(["x"]);
      expect(h.read).toHaveBeenCalledOnce();
      h.reads[0].resolve("late");
      await Promise.resolve();
      expect(h.output).toEqual(["x"]);
      h.queue.paste();
      expect(h.read).toHaveBeenCalledTimes(2);
    } finally {
      h.queue.dispose();
    }
  });

  it.each(["bytes", "operations"])(
    "bounds deferred %s and drops the paste if that bound is exceeded",
    async (kind) => {
      const h = harness();
      try {
        h.queue.paste();
        if (kind === "bytes") {
          h.queue.send(new Uint8Array(256 * 1024));
          h.queue.send(Uint8Array.of(3));
        } else for (let index = 0; index <= 256; index++) h.queue.paste();
        expect(h.error).toHaveBeenCalledOnce();
        h.reads[0].resolve("cancelled");
        await Promise.resolve();
        expect(h.output).toEqual([]);
        expect(h.read).toHaveBeenCalledOnce();
      } finally {
        h.queue.dispose();
      }
    },
  );

  it.each([false, true])(
    "ignores late clipboard completion after disposal (reject=%s)",
    async (reject) => {
      vi.useFakeTimers();
      const h = harness();
      h.queue.paste();
      h.type("\r");
      h.queue.dispose();
      if (reject) h.reads[0].reject(new Error("closed"));
      else h.reads[0].resolve("late");
      await vi.advanceTimersByTimeAsync(CLIPBOARD_READ_TIMEOUT_MS * 2);
      expect(h.output).toEqual([]);
      expect(h.error).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
