import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFsRefreshScheduler,
  FS_REFRESH_DEBOUNCE_MS,
  FS_REFRESH_MIN_INTERVAL_MS,
} from "./fsRefreshScheduler";

function harness() {
  let hidden = false;
  let lastRefreshAt = 0;
  let inflight: Promise<void> | null = null;
  let release: (() => void) | null = null;
  const reads: number[] = [];

  // Status reads stay open until the test releases them, like a slow git.
  const startRead = () => {
    reads.push(Date.now());
    inflight = new Promise<void>((resolve) => {
      release = () => {
        lastRefreshAt = Date.now();
        inflight = null;
        resolve();
      };
    });
    return inflight;
  };

  const scheduler = createFsRefreshScheduler({
    refresh: () => inflight ?? startRead(),
    isRefreshing: () => inflight !== null,
    lastRefreshAt: () => lastRefreshAt,
    isHidden: () => hidden,
  });

  return {
    scheduler,
    reads,
    startRead,
    setHidden: (value: boolean) => {
      hidden = value;
    },
    finishRead: async () => {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe("createFsRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => vi.useRealTimers());

  it("collapses a burst into one read", async () => {
    const h = harness();
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(100);
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    expect(h.reads).toHaveLength(1);
  });

  it("keeps reads at least the minimum interval apart", async () => {
    const h = harness();
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    await h.finishRead();
    const firstDone = Date.now();

    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    expect(h.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FS_REFRESH_MIN_INTERVAL_MS);
    expect(h.reads).toHaveLength(2);
    expect(h.reads[1] - firstDone).toBeGreaterThanOrEqual(
      FS_REFRESH_MIN_INTERVAL_MS,
    );
  });

  it("keeps a change seen while hidden and reads it after the window returns", async () => {
    const h = harness();
    // A read completes, then a change lands while the window is hidden.
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    await h.finishRead();
    h.setHidden(true);
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    expect(h.reads).toHaveLength(1);

    // Back well inside the minimum interval: the read is deferred, not lost.
    h.setHidden(false);
    h.scheduler.resume();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_MIN_INTERVAL_MS);
    expect(h.reads).toHaveLength(2);
  });

  it("follows up when a change lands during a read", async () => {
    const h = harness();
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    expect(h.reads).toHaveLength(1);

    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    expect(h.reads).toHaveLength(1);

    await h.finishRead();
    await vi.advanceTimersByTimeAsync(
      FS_REFRESH_DEBOUNCE_MS + FS_REFRESH_MIN_INTERVAL_MS,
    );
    expect(h.reads).toHaveLength(2);
  });

  it("does not trust a read that was already in flight before the change", async () => {
    const h = harness();
    vi.setSystemTime(20_000);
    // A focus-triggered read started before the file changed.
    void h.startRead();
    h.scheduler.notify();
    await vi.advanceTimersByTimeAsync(FS_REFRESH_DEBOUNCE_MS);
    await h.finishRead();
    expect(h.reads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      FS_REFRESH_DEBOUNCE_MS + FS_REFRESH_MIN_INTERVAL_MS,
    );
    expect(h.reads).toHaveLength(2);
    await h.finishRead();
    await vi.advanceTimersByTimeAsync(10 * FS_REFRESH_MIN_INTERVAL_MS);
    expect(h.reads).toHaveLength(2);
  });

  it("stops after dispose", async () => {
    const h = harness();
    h.scheduler.notify();
    h.scheduler.dispose();
    await vi.advanceTimersByTimeAsync(10 * FS_REFRESH_MIN_INTERVAL_MS);
    expect(h.reads).toHaveLength(0);
  });
});
