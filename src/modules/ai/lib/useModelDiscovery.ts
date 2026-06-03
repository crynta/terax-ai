import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDiscoveryCacheKey,
  type DiscoveredModel,
  type DiscoveryProvider,
  type ModelDiscoveryError,
} from "./modelDiscovery";
import { createModelDiscoveryCache } from "./modelDiscoveryCache";
import {
  discoverModels,
  type ModelDiscoveryRequest,
} from "./modelDiscoveryClient";

const DISCOVERY_CACHE_TTL_MS = 60_000;
const discoveryCache = createModelDiscoveryCache({ ttlMs: DISCOVERY_CACHE_TTL_MS });

export type ModelDiscoveryStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error";

export type UseModelDiscoveryInput = {
  provider: DiscoveryProvider;
  endpointId?: string;
  baseURL: string;
  apiKey?: string | null;
  enabled?: boolean;
  request?: ModelDiscoveryRequest;
};

export type UseModelDiscoveryResult = {
  models: DiscoveredModel[];
  status: ModelDiscoveryStatus;
  error: ModelDiscoveryError | null;
  refresh: (options?: { force?: boolean }) => Promise<void>;
};

export function useModelDiscovery({
  provider,
  endpointId,
  baseURL,
  apiKey,
  enabled = true,
  request,
}: UseModelDiscoveryInput): UseModelDiscoveryResult {
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [status, setStatus] = useState<ModelDiscoveryStatus>("idle");
  const [error, setError] = useState<ModelDiscoveryError | null>(null);
  const requestSeq = useRef(0);
  const previousApiKey = useRef(apiKey ?? null);

  const cacheKey = useMemo(
    () =>
      buildDiscoveryCacheKey({
        provider,
        endpointId,
        baseURL,
        hasAuth: !!apiKey?.trim(),
      }),
    [apiKey, baseURL, endpointId, provider],
  );

  useEffect(() => {
    requestSeq.current += 1;
    setModels([]);
    setStatus("idle");
    setError(null);
  }, [cacheKey]);

  useEffect(() => {
    if (previousApiKey.current === (apiKey ?? null)) return;
    previousApiKey.current = apiKey ?? null;
    requestSeq.current += 1;
    setModels([]);
    setStatus("idle");
    setError(null);
    discoveryCache.invalidate(cacheKey);
  }, [apiKey, cacheKey]);

  const refresh = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!enabled || !baseURL.trim()) {
        setModels([]);
        setStatus("idle");
        setError(null);
        return;
      }

      const seq = ++requestSeq.current;
      setStatus("loading");
      setError(null);

      const result = await discoveryCache.get(
        cacheKey,
        () => discoverModels({ baseURL, apiKey }, request),
        { refresh: options.force === true },
      );
      if (seq !== requestSeq.current) return;

      if (result.ok) {
        setModels(result.models);
        setStatus(result.models.length > 0 ? "success" : "empty");
        setError(null);
      } else {
        setModels([]);
        setStatus("error");
        setError(result.error);
      }
    },
    [apiKey, baseURL, cacheKey, enabled, request],
  );

  return { models, status, error, refresh };
}
