import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import type { ModelCapabilities, ModelInfo } from "../config";

const OPENROUTER_MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text";
const CATALOG_TTL_MS = 5 * 60_000;

type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: number[];
};

export type OpenRouterModel = {
  id: string;
  canonical_slug?: string | null;
  name?: string | null;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
    modality?: string | null;
  } | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
  } | null;
  supported_parameters?: string[] | null;
  expiration_date?: string | null;
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
  } | null;
};

export type OpenRouterModelInfo = ModelInfo & {
  openrouterModelId: string;
  contextLength: number;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  supportsTools: boolean;
  batchOnly: boolean;
};

export type OpenRouterCatalogStatus = "idle" | "loading" | "ready" | "error";

export type OpenRouterCatalogSnapshot = {
  models: readonly OpenRouterModelInfo[];
  status: OpenRouterCatalogStatus;
  error: string | null;
  loadedAt: number | null;
};

export function isOpenRouterModelInfo(
  model: ModelInfo,
): model is OpenRouterModelInfo {
  return model.provider === "openrouter" && "openrouterModelId" in model;
}

const EMPTY_SNAPSHOT: OpenRouterCatalogSnapshot = {
  models: [],
  status: "idle",
  error: null,
  loadedAt: null,
};

let snapshot = EMPTY_SNAPSHOT;
let request: Promise<void> | null = null;
const knownBatchOnlyIds = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: OpenRouterCatalogSnapshot): void {
  snapshot = next;
  notify();
}

function decodeBody(body: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(body));
}

function responseError(status: number, body: string): Error {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    const message = parsed.error?.message;
    if (message) return new Error(message);
  } catch {
    // Fall through to the status-based message.
  }
  return new Error(`OpenRouter model catalog request failed (${status}).`);
}

function pricePerMillion(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null;
}

function capabilitiesForModel(model: OpenRouterModel): ModelCapabilities {
  const parameters = new Set(model.supported_parameters ?? []);
  const promptPrice = pricePerMillion(model.pricing?.prompt);
  const completionPrice = pricePerMillion(model.pricing?.completion);
  const averagePrice =
    promptPrice != null && completionPrice != null
      ? (promptPrice + completionPrice) / 2
      : null;
  const cost: ModelCapabilities["cost"] =
    averagePrice == null
      ? 3
      : averagePrice <= 0.5
        ? 5
        : averagePrice <= 2
          ? 4
          : averagePrice <= 8
            ? 3
            : averagePrice <= 25
              ? 2
              : 1;

  return {
    intelligence: parameters.has("reasoning") ? 4 : 3,
    speed: 3,
    cost,
  };
}

function isBatchOnlyModel(model: OpenRouterModel): boolean {
  const parameters = model.supported_parameters ?? [];
  return parameters.some((parameter) => parameter.toLowerCase() === "batch");
}

export function toOpenRouterModelInfo(
  model: OpenRouterModel,
): OpenRouterModelInfo | null {
  const id = model.id.trim();
  if (!id) return null;
  const parameters = new Set(model.supported_parameters ?? []);
  const batchOnly =
    isBatchOnlyModel(model) || knownBatchOnlyIds.has(model.id.trim());
  const inputs = model.architecture?.input_modalities ?? [];
  const tags = [
    ...(inputs.includes("image") ? (["vision"] as const) : []),
    ...(parameters.has("reasoning") ? (["reasoning"] as const) : []),
    ...(parameters.has("tools") ? (["tools"] as const) : []),
  ];

  return {
    id,
    provider: "openrouter",
    label: model.name?.trim() || id,
    hint: batchOnly
      ? "Batch only"
      : parameters.has("tools")
        ? "Tools"
        : "OpenRouter",
    description: model.description?.trim() || id,
    capabilities: capabilitiesForModel(model),
    tags,
    supportsTemperature: parameters.has("temperature"),
    openrouterModelId: id,
    contextLength: model.context_length ?? 128_000,
    inputPricePerMillion: pricePerMillion(model.pricing?.prompt),
    outputPricePerMillion: pricePerMillion(model.pricing?.completion),
    supportsTools: parameters.has("tools"),
    batchOnly,
  };
}

export function parseOpenRouterModels(body: string): OpenRouterModelInfo[] {
  const parsed = JSON.parse(body) as { data?: unknown };
  if (!Array.isArray(parsed.data)) {
    throw new Error("OpenRouter returned an invalid model catalog.");
  }
  return parsed.data
    .filter((model): model is OpenRouterModel => {
      if (!model || typeof model !== "object") return false;
      const id = (model as { id?: unknown }).id;
      return typeof id === "string";
    })
    .map(toOpenRouterModelInfo)
    .filter((model): model is OpenRouterModelInfo => model !== null);
}

export async function fetchOpenRouterModels(
  apiKey: string,
): Promise<OpenRouterModelInfo[]> {
  const response = await invoke<HttpResponse>("ai_http_request", {
    url: OPENROUTER_MODELS_URL,
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://terax.ai",
      "X-OpenRouter-Title": "Terax",
    },
  });
  const body = decodeBody(response.body);
  if (response.status < 200 || response.status >= 300) {
    throw responseError(response.status, body);
  }
  return parseOpenRouterModels(body);
}

export function useOpenRouterCatalog(
  apiKey: string | null | undefined,
): OpenRouterCatalogSnapshot {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );

  useEffect(() => {
    if (!apiKey) {
      if (snapshot.status !== "idle" || snapshot.models.length > 0) {
        setSnapshot(EMPTY_SNAPSHOT);
      }
      return;
    }
    void loadOpenRouterCatalog(apiKey);
  }, [apiKey]);

  return current;
}

export async function loadOpenRouterCatalog(
  apiKey: string,
  force = false,
): Promise<void> {
  if (!apiKey.trim()) return;
  if (
    !force &&
    snapshot.status === "ready" &&
    snapshot.loadedAt != null &&
    Date.now() - snapshot.loadedAt < CATALOG_TTL_MS
  ) {
    return;
  }
  if (request) return request;

  setSnapshot({ ...snapshot, status: "loading", error: null });
  request = fetchOpenRouterModels(apiKey)
    .then((models) => {
      setSnapshot({
        models,
        status: "ready",
        error: null,
        loadedAt: Date.now(),
      });
    })
    .catch((error) => {
      setSnapshot({
        ...snapshot,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      request = null;
    });
  return request;
}

export function markOpenRouterModelBatchOnly(modelId: string): void {
  if (!modelId.trim()) return;
  knownBatchOnlyIds.add(modelId);
  const models = snapshot.models.map((model) =>
    model.openrouterModelId === modelId
      ? { ...model, batchOnly: true, hint: "Batch only" }
      : model,
  );
  if (models.some((model, index) => model !== snapshot.models[index])) {
    setSnapshot({ ...snapshot, models });
  }
}

export function getOpenRouterModelContextLimit(
  modelId: string | undefined,
): number | undefined {
  if (!modelId) return undefined;
  return snapshot.models.find((model) => model.openrouterModelId === modelId)
    ?.contextLength;
}
