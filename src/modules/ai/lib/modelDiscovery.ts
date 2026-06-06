import type { ProviderId } from "../config";

export type DiscoveryProvider = ProviderId | "custom-endpoint";

export type DiscoveredModel = {
  id: string;
  ownedBy?: string;
  contextLimit?: number;
};

export type ModelDiscoveryErrorKind =
  | "missing-base-url"
  | "http-error"
  | "network-error"
  | "invalid-json"
  | "invalid-shape";

export type ModelDiscoveryError = {
  kind: ModelDiscoveryErrorKind;
  message: string;
  status?: number;
};

export type ModelDiscoveryResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; error: ModelDiscoveryError };

export type DiscoveryCacheKeyInput = {
  provider: DiscoveryProvider;
  endpointId?: string;
  baseURL: string;
  hasAuth: boolean;
};

export type DiscoveryHttpResponse = {
  status: number;
  body: number[];
};

export function normalizeDiscoveryBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, "");
}

export function buildModelsUrl(baseURL: string): string {
  const normalized = normalizeDiscoveryBaseURL(baseURL);
  if (!normalized) throw new Error("Base URL is required");
  return `${normalized}/models`;
}

export function buildDiscoveryHeaders(
  apiKey: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export function buildDiscoveryCacheKey(input: DiscoveryCacheKeyInput): string {
  const provider = input.provider;
  const endpointId = input.endpointId ?? "";
  const baseURL = normalizeDiscoveryBaseURL(input.baseURL);
  const auth = input.hasAuth ? "auth" : "no-auth";
  return `${provider}:${endpointId}:${baseURL}:${auth}`;
}

export function parseDiscoveredModels(payload: unknown): DiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenAI-compatible models list");
  }

  const byId = new Map<string, DiscoveredModel>();
  for (const item of payload.data) {
    if (!isRecord(item)) continue;
    const rawId = item.id;
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (!id) continue;

    const model = byId.get(id) ?? { id };
    const ownedBy = item.owned_by;
    if (!model.ownedBy && typeof ownedBy === "string" && ownedBy.trim()) {
      model.ownedBy = ownedBy.trim();
    }
    const contextLimit = firstPositiveInteger(
      item.max_model_len,
      item.max_context_length,
      item.context_length,
    );
    if (!model.contextLimit && contextLimit) model.contextLimit = contextLimit;
    byId.set(id, model);
  }

  return [...byId.values()].sort(
    (a, b) =>
      a.id.localeCompare(b.id, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

export function decodeModelDiscoveryResponse(
  response: DiscoveryHttpResponse,
): ModelDiscoveryResult {
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: {
        kind: "http-error",
        message: `Models request failed with HTTP ${response.status}.`,
        status: response.status,
      },
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBody(response.body));
  } catch {
    return {
      ok: false,
      error: {
        kind: "invalid-json",
        message: "The endpoint did not return valid JSON.",
      },
    };
  }

  try {
    return { ok: true, models: parseDiscoveredModels(payload) };
  } catch {
    return {
      ok: false,
      error: {
        kind: "invalid-shape",
        message:
          "The endpoint did not return an OpenAI-compatible models list.",
      },
    };
  }
}

function decodeBody(body: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(body));
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== "number") continue;
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
