import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptPage } from "./transcript";
import { followTranscript } from "./transcriptClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const page = (
  nextOffset: number,
  uuids: string[] = [],
  startOffset = 0,
): TranscriptPage => ({
  entries: uuids.map((uuid) => ({
    kind: "user",
    uuid,
    blocks: [{ type: "text", text: uuid }],
  })),
  startOffset,
  nextOffset,
  size: nextOffset,
  reset: false,
});

describe("followTranscript", () => {
  afterEach(() => vi.useRealTimers());

  it("reads the tail, then continues from the last offset only while active", async () => {
    vi.useFakeTimers();
    let active = true;
    const read = vi
      .fn()
      .mockResolvedValueOnce(page(100, ["a"], 40))
      .mockResolvedValueOnce(page(150, ["b"]))
      .mockResolvedValue(page(150));
    const onChange = vi.fn();
    const follower = followTranscript("id", {
      read,
      onChange,
      isActive: () => active,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenNthCalledWith(1, "id", {});
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenNthCalledWith(2, "id", { offset: 100 });
    expect(onChange).toHaveBeenCalledTimes(2);

    active = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(2);

    follower.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenNthCalledWith(3, "id", { offset: 150 });
    expect(follower.buffer.entries.map((e) => e.uuid)).toEqual(["a", "b"]);

    follower.stop();
    active = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("pages backwards from the earliest loaded offset", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(page(300, ["b"], 200))
      .mockResolvedValueOnce(page(200, ["a"], 0));
    const onChange = vi.fn();
    const follower = followTranscript("id", {
      read,
      onChange,
      isActive: () => false,
    });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await expect(follower.loadEarlier()).resolves.toBe(true);
    expect(read).toHaveBeenLastCalledWith("id", { before: 200 });
    expect(follower.buffer.entries.map((e) => e.uuid)).toEqual(["a", "b"]);
    await expect(follower.loadEarlier()).resolves.toBe(false);
    follower.stop();
  });
});
