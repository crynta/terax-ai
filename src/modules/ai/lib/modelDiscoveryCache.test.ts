import { describe, expect, it } from "vitest";
import type { ModelDiscoveryResult } from "./modelDiscovery";
import { createModelDiscoveryCache } from "./modelDiscoveryCache";

const first: ModelDiscoveryResult = { ok: true, models: [{ id: "first" }] };
const second: ModelDiscoveryResult = { ok: true, models: [{ id: "second" }] };
const third: ModelDiscoveryResult = { ok: true, models: [{ id: "third" }] };

describe("createModelDiscoveryCache", () => {
  it("reuses a fresh cached discovery result", async () => {
    let calls = 0;
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => 10 });

    const a = await cache.get("endpoint", async () => {
      calls += 1;
      return first;
    });
    const b = await cache.get("endpoint", async () => {
      calls += 1;
      return second;
    });

    expect(a).toBe(first);
    expect(b).toBe(first);
    expect(calls).toBe(1);
  });

  it("deduplicates in-flight discovery requests", async () => {
    let calls = 0;
    let resolveRequest!: (value: ModelDiscoveryResult) => void;
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => 10 });

    const request = async () => {
      calls += 1;
      return new Promise<ModelDiscoveryResult>((done) => {
        resolveRequest = done;
      });
    };

    const a = cache.get("endpoint", request);
    const b = cache.get("endpoint", request);
    resolveRequest(first);

    await expect(a).resolves.toBe(first);
    await expect(b).resolves.toBe(first);
    expect(calls).toBe(1);
  });

  it("refetches expired cached discovery results", async () => {
    let now = 10;
    let calls = 0;
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => now });

    await cache.get("endpoint", async () => {
      calls += 1;
      return first;
    });
    now = 1011;
    const result = await cache.get("endpoint", async () => {
      calls += 1;
      return second;
    });

    expect(result).toBe(second);
    expect(calls).toBe(2);
  });

  it("does not cache failed discovery results", async () => {
    let calls = 0;
    const failed: ModelDiscoveryResult = {
      ok: false,
      error: { kind: "network-error", message: "Could not reach." },
    };
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => 10 });

    const a = await cache.get("endpoint", async () => {
      calls += 1;
      return failed;
    });
    const b = await cache.get("endpoint", async () => {
      calls += 1;
      return first;
    });

    expect(a).toBe(failed);
    expect(b).toBe(first);
    expect(calls).toBe(2);
  });

  it("bypasses cache on refresh", async () => {
    let calls = 0;
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => 10 });

    await cache.get("endpoint", async () => {
      calls += 1;
      return first;
    });
    const refreshed = await cache.get(
      "endpoint",
      async () => {
        calls += 1;
        return second;
      },
      { refresh: true },
    );

    expect(refreshed).toBe(second);
    expect(calls).toBe(2);
  });

  it("keeps a forced refresh from being overwritten by an older in-flight request", async () => {
    let resolveOld!: (value: ModelDiscoveryResult) => void;
    let resolveNew!: (value: ModelDiscoveryResult) => void;
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => 10 });

    const oldRequest = cache.get(
      "endpoint",
      async () =>
        new Promise<ModelDiscoveryResult>((done) => {
          resolveOld = done;
        }),
    );
    const newRequest = cache.get(
      "endpoint",
      async () =>
        new Promise<ModelDiscoveryResult>((done) => {
          resolveNew = done;
        }),
      { refresh: true },
    );

    resolveNew(second);
    await expect(newRequest).resolves.toBe(second);
    resolveOld(first);
    await expect(oldRequest).resolves.toBe(first);

    const cached = await cache.get("endpoint", async () => third);
    expect(cached).toBe(second);
  });

  it("invalidates matching keys", async () => {
    let calls = 0;
    const cache = createModelDiscoveryCache({ ttlMs: 1000, now: () => 10 });

    await cache.get("endpoint", async () => {
      calls += 1;
      return first;
    });
    cache.invalidate("endpoint");
    const result = await cache.get("endpoint", async () => {
      calls += 1;
      return second;
    });

    expect(result).toBe(second);
    expect(calls).toBe(2);
  });
});
