/**
 * LRU cache wrapping an async existence probe. Designed for the terminal
 * link-provider hot path: we may probe the same path many times per second
 * as the user scrolls and hovers, and want stale-while-valid semantics.
 *
 * Positive entries live longer than negatives because a file appearing
 * is more common than one vanishing in a terminal session, and the
 * worst-case for a stale positive (one missed underline) is far less
 * disruptive than the worst-case for a stale negative (perpetually
 * un-clickable file the user just created).
 */
export interface ExistenceCacheOptions {
  capacity?: number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  /** Defaults to `Date.now`. Vitest can swap with `vi.useFakeTimers`. */
  now?: () => number;
}

export interface ExistenceCache {
  exists(path: string): Promise<boolean>;
  invalidate(path: string): void;
  clear(): void;
}

type Entry = { value: boolean; expiresAt: number };

const DEFAULTS = {
  capacity: 4096,
  positiveTtlMs: 30_000,
  negativeTtlMs: 5_000,
};

export function createExistenceCache(
  probe: (path: string) => Promise<boolean>,
  opts: ExistenceCacheOptions = {},
): ExistenceCache {
  const capacity = opts.capacity ?? DEFAULTS.capacity;
  const posTtl = opts.positiveTtlMs ?? DEFAULTS.positiveTtlMs;
  const negTtl = opts.negativeTtlMs ?? DEFAULTS.negativeTtlMs;
  const now = opts.now ?? Date.now;

  // Map preserves insertion order, so we can re-insert on hit to bump LRU
  // recency without a separate list. Eviction = drop the first key.
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<boolean>>();

  function bump(key: string, entry: Entry) {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > capacity) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    async exists(path) {
      const cached = entries.get(path);
      if (cached && cached.expiresAt > now()) {
        bump(path, cached);
        return cached.value;
      }

      const pending = inflight.get(path);
      if (pending) return pending;

      const probePromise = (async () => {
        try {
          const result = await probe(path);
          bump(path, {
            value: result,
            expiresAt: now() + (result ? posTtl : negTtl),
          });
          return result;
        } finally {
          inflight.delete(path);
        }
      })();
      inflight.set(path, probePromise);
      return probePromise;
    },

    invalidate(path) {
      entries.delete(path);
    },

    clear() {
      entries.clear();
    },
  };
}
