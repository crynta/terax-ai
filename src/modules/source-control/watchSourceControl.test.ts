import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("@/modules/git", () => ({ subscribeGitChanges: mocks.subscribe }));

import { watchSourceControl } from "./watchSourceControl";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("source control watch refresh", () => {
  let changed: () => void;
  let stop: () => void;
  const release = vi.fn();
  const refresh = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    refresh.mockResolvedValue(undefined);
    mocks.subscribe.mockImplementation(async (_repo, handler) => {
      changed = handler;
      return release;
    });
    stop = () => {};
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("refreshes after registration, coalesces bursts and stays idle without changes", async () => {
    stop = watchSourceControl("/repo", refresh, () => undefined);
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.subscribe).toHaveBeenCalledWith("/repo", expect.any(Function));
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) changed();
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not postpone refresh forever during continuous events", async () => {
    stop = watchSourceControl("/repo", refresh, () => undefined);
    await vi.advanceTimersByTimeAsync(200);
    for (let i = 0; i < 20; i++) {
      changed();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(refresh).toHaveBeenCalledTimes(6);
  });

  it("waits for an older status request and refreshes once after it", async () => {
    const old = deferred<void>();
    stop = watchSourceControl("/repo", refresh, () => old.promise);
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).not.toHaveBeenCalled();
    old.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("retains one follow-up when changes arrive during a refresh", async () => {
    const status = deferred<void>();
    refresh.mockReturnValueOnce(status.promise);
    stop = watchSourceControl("/repo", refresh, () => undefined);
    await vi.advanceTimersByTimeAsync(200);
    for (let i = 0; i < 100; i++) changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    status.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("cancels queued work and releases the watch on hide, context change or unmount", async () => {
    stop = watchSourceControl("/repo", refresh, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    stop();
    changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    stop = () => {};
  });

  it("releases a watch that finishes registering after cleanup", async () => {
    const registration = deferred<() => void>();
    mocks.subscribe.mockReturnValueOnce(registration.promise);
    stop = watchSourceControl("/repo", refresh, () => undefined);
    stop();
    registration.resolve(release);
    await vi.advanceTimersByTimeAsync(1000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh after disposal while awaiting an older request", async () => {
    const old = deferred<void>();
    stop = watchSourceControl("/repo", refresh, () => old.promise);
    await vi.advanceTimersByTimeAsync(200);
    stop();
    old.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves fallback refresh available after watch registration fails", async () => {
    mocks.subscribe.mockRejectedValueOnce(new Error("watch unavailable"));
    stop = watchSourceControl("/repo", refresh, () => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("allows a later event to retry after refresh fails", async () => {
    refresh.mockRejectedValueOnce(new Error("status failed"));
    stop = watchSourceControl("/repo", refresh, () => undefined);
    await vi.advanceTimersByTimeAsync(200);
    changed();
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("allows a later event after an older request rejects", async () => {
    const current = vi
      .fn<() => Promise<void> | undefined>()
      .mockRejectedValueOnce(new Error("old request failed"))
      .mockReturnValue(undefined);
    stop = watchSourceControl("/repo", refresh, current);
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).not.toHaveBeenCalled();
    changed();
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
