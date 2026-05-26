import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExistenceCache } from "./existenceCache";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("existenceCache", () => {
  it("calls the probe once per path and caches the result", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe);

    await expect(cache.exists("/a")).resolves.toBe(true);
    await expect(cache.exists("/a")).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("re-probes a positive entry after positive TTL elapses", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe);

    await cache.exists("/a");
    vi.advanceTimersByTime(31_000);
    await cache.exists("/a");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("re-probes a negative entry after the shorter negative TTL", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const cache = createExistenceCache(probe);

    await cache.exists("/missing");
    vi.advanceTimersByTime(6_000);
    await cache.exists("/missing");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("invalidates an entry explicitly", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe);

    await cache.exists("/a");
    cache.invalidate("/a");
    await cache.exists("/a");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("evicts the least-recently-used entry past capacity", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe, { capacity: 2 });

    await cache.exists("/a");
    await cache.exists("/b");
    await cache.exists("/c"); // evicts /a
    await cache.exists("/a"); // re-probe after eviction
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("coalesces concurrent probes of the same path", async () => {
    let resolve!: (v: boolean) => void;
    const probe = vi.fn(
      () => new Promise<boolean>((r) => { resolve = r; }),
    );
    const cache = createExistenceCache(probe);

    const p1 = cache.exists("/slow");
    const p2 = cache.exists("/slow");
    expect(probe).toHaveBeenCalledTimes(1);
    resolve(true);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
  });
});
