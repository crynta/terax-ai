import { createProxyFetch } from "./proxyFetch";

const discoveryFetch = createProxyFetch({ allowPrivateNetwork: true });

export type DiscoveredModel = {
  id: string;
};

/**
 * GET `${baseURL}/models` against an OpenAI-compatible endpoint and return
 * the model ids it advertises. Aggregators like Vibe Proxy, OpenRouter,
 * LiteLLM, vLLM, LM Studio and Ollama all implement this endpoint.
 *
 * Goes through the Rust HTTP proxy (`ai_http_stream`) so it works under
 * the production bundle's CORS / Mixed-Content / Private-Network policies.
 */
export async function fetchOpenAICompatibleModels(
  baseURL: string,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL is required");

  const url = `${trimmed}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const resp = await discoveryFetch(url, {
    method: "GET",
    headers,
    signal,
  });

  if (!resp.ok) {
    const detail = await safeReadShortBody(resp);
    throw new Error(
      `HTTP ${resp.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const text = await resp.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Response was not valid JSON");
  }

  // OpenAI's canonical shape: `{ object: "list", data: [{ id, ... }] }`.
  // Be lenient — some proxies wrap or omit the envelope.
  const data = extractModelArray(json);
  if (!data) {
    throw new Error("Unexpected response shape — no `data` array of models");
  }

  const seen = new Set<string>();
  const out: DiscoveredModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const trimmedId = id.trim();
    if (!trimmedId || seen.has(trimmedId)) continue;
    seen.add(trimmedId);
    out.push({ id: trimmedId });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function extractModelArray(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.models)) return obj.models;
  }
  return null;
}

async function safeReadShortBody(resp: Response): Promise<string | null> {
  try {
    const text = await resp.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
  } catch {
    return null;
  }
}
