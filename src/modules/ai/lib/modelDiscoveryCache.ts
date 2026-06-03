import type { ModelDiscoveryResult } from "./modelDiscovery";

type CacheEntry = {
  value: ModelDiscoveryResult;
  expiresAt: number;
};

type PendingEntry = Promise<ModelDiscoveryResult>;

type CacheOptions = {
  ttlMs: number;
  now?: () => number;
};

type GetOptions = {
  refresh?: boolean;
};

export type ModelDiscoveryCache = {
  get: (
    key: string,
    load: () => Promise<ModelDiscoveryResult>,
    options?: GetOptions,
  ) => Promise<ModelDiscoveryResult>;
  invalidate: (key: string) => void;
};

export function createModelDiscoveryCache(
  options: CacheOptions,
): ModelDiscoveryCache {
  const now = options.now ?? Date.now;
  const values = new Map<string, CacheEntry>();
  const pending = new Map<string, PendingEntry>();

  return {
    get(key, load, getOptions = {}) {
      const cached = values.get(key);
      if (!getOptions.refresh && cached && cached.expiresAt > now()) {
        return Promise.resolve(cached.value);
      }

      const active = pending.get(key);
      if (!getOptions.refresh && active) return active;

      const request = load()
        .then((value) => {
          if (pending.get(key) === request) {
            if (value.ok) {
              values.set(key, { value, expiresAt: now() + options.ttlMs });
            } else {
              values.delete(key);
            }
            pending.delete(key);
          }
          return value;
        })
        .catch((error: unknown) => {
          if (pending.get(key) === request) pending.delete(key);
          throw error;
        });
      pending.set(key, request);
      return request;
    },
    invalidate(key) {
      values.delete(key);
      pending.delete(key);
    },
  };
}
